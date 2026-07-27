export interface OAuthEnv {
  USERS_DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
}

type OAuthProvider = "google" | "discord";

interface OAuthStateRow {
  provider: OAuthProvider;
  return_to: string;
  expires_at: number;
}

interface OAuthProfile {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
}

const APP_RETURN_URL = "aetherio://auth/callback";
const STATE_LIFETIME_SECONDS = 10 * 60;
const CODE_LIFETIME_SECONDS = 2 * 60;
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

export async function handleOAuthRequest(
  request: Request,
  env: OAuthEnv,
  pathname: string,
) {
  if (pathname === "/api/auth/providers" && request.method === "GET") {
    return oauthJson({
      google: providerConfigured(env, "google"),
      discord: providerConfigured(env, "discord"),
    });
  }

  const startMatch = /^\/api\/auth\/oauth\/(google|discord)\/start$/.exec(pathname);
  if (startMatch && request.method === "GET") {
    return startOAuth(request, env, startMatch[1] as OAuthProvider);
  }

  const callbackMatch = /^\/api\/auth\/oauth\/(google|discord)\/callback$/.exec(pathname);
  if (callbackMatch && request.method === "GET") {
    return finishOAuth(request, env, callbackMatch[1] as OAuthProvider);
  }

  if (pathname === "/api/auth/oauth/exchange" && request.method === "POST") {
    return exchangeAppCode(request, env);
  }

  return null;
}

async function startOAuth(request: Request, env: OAuthEnv, provider: OAuthProvider) {
  const config = providerConfig(env, provider);
  if (!config) {
    return oauthPage(
      "Proveedor pendiente",
      `${provider === "google" ? "Google" : "Discord"} todavía no tiene credenciales configuradas en Cloudflare.`,
      503,
    );
  }

  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("return_to") ?? APP_RETURN_URL;
  if (returnTo !== APP_RETURN_URL) {
    return oauthJson({ error: "Destino OAuth no permitido." }, 400);
  }

  const now = unixNow();
  const state = randomToken(32);
  await env.USERS_DB.batch([
    env.USERS_DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(now),
    env.USERS_DB.prepare(
      `INSERT INTO oauth_states (
        state_hash, provider, return_to, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(await sha256(state), provider, returnTo, now, now + STATE_LIFETIME_SECONDS),
  ]);

  const callbackUrl = callbackFor(requestUrl.origin, provider);
  const authorizationUrl = new URL(config.authorizationUrl);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", config.scope);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("prompt", provider === "google" ? "select_account" : "consent");
  return Response.redirect(authorizationUrl.toString(), 302);
}

async function finishOAuth(request: Request, env: OAuthEnv, provider: OAuthProvider) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state")?.trim();
  if (!state) return oauthPage("Solicitud inválida", "Falta el estado de seguridad OAuth.", 400);

  const stateHash = await sha256(state);
  const stored = await env.USERS_DB.prepare(
    `SELECT provider, return_to, expires_at
     FROM oauth_states WHERE state_hash = ?`,
  )
    .bind(stateHash)
    .first<OAuthStateRow>();

  await env.USERS_DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?")
    .bind(stateHash)
    .run();

  if (!stored || stored.provider !== provider || stored.expires_at <= unixNow()) {
    return oauthPage("Solicitud expirada", "Vuelve a Aetherio e intenta iniciar sesión otra vez.", 400);
  }

  const providerError = url.searchParams.get("error");
  if (providerError) {
    return redirectToApp(stored.return_to, { error: "access_denied" });
  }

  const code = url.searchParams.get("code")?.trim();
  if (!code) return redirectToApp(stored.return_to, { error: "missing_code" });

  try {
    const profile = await fetchOAuthProfile(request, env, provider, code);
    if (!profile.email || !profile.emailVerified) {
      return redirectToApp(stored.return_to, { error: "email_not_verified" });
    }

    const user = await findOrCreateOAuthUser(env, provider, profile);
    const appCode = randomToken(32);
    const now = unixNow();
    await env.USERS_DB.batch([
      env.USERS_DB.prepare("DELETE FROM oauth_codes WHERE expires_at <= ?").bind(now),
      env.USERS_DB.prepare(
        `INSERT INTO oauth_codes (
          code_hash, user_id, created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, NULL)`,
      ).bind(await sha256(appCode), user.id, now, now + CODE_LIFETIME_SECONDS),
    ]);

    return redirectToApp(stored.return_to, { code: appCode });
  } catch (error) {
    console.error("[AETHERIO:OAUTH]", provider, error);
    return redirectToApp(stored.return_to, { error: "provider_failed" });
  }
}

async function exchangeAppCode(request: Request, env: OAuthEnv) {
  let code = "";
  try {
    const body = await request.json() as { code?: unknown };
    code = typeof body.code === "string" ? body.code.trim() : "";
  } catch {
    return oauthJson({ error: "Código OAuth inválido." }, 400);
  }
  if (!code) return oauthJson({ error: "Código OAuth requerido." }, 400);

  const now = unixNow();
  const claimed = await env.USERS_DB.prepare(
    `UPDATE oauth_codes
     SET consumed_at = ?
     WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING user_id`,
  )
    .bind(now, await sha256(code), now)
    .first<{ user_id: string }>();

  if (!claimed) return oauthJson({ error: "El acceso OAuth expiró o ya fue utilizado." }, 401);

  const user = await env.USERS_DB.prepare(
    "SELECT id, email, display_name, created_at FROM users WHERE id = ?",
  )
    .bind(claimed.user_id)
    .first<UserRow>();
  if (!user) return oauthJson({ error: "La cuenta ya no existe." }, 404);

  const token = await createSession(env, user.id, request);
  return oauthJson({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      createdAt: user.created_at,
    },
  });
}

async function fetchOAuthProfile(
  request: Request,
  env: OAuthEnv,
  provider: OAuthProvider,
  code: string,
): Promise<OAuthProfile> {
  const config = providerConfig(env, provider);
  if (!config) throw new Error("OAuth provider is not configured.");

  const callbackUrl = callbackFor(new URL(request.url).origin, provider);
  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl,
  });
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: tokenBody,
  });
  if (!tokenResponse.ok) {
    throw new Error(`${provider} token exchange failed with ${tokenResponse.status}.`);
  }
  const token = await tokenResponse.json<{ access_token?: string }>();
  if (!token.access_token) throw new Error(`${provider} did not return an access token.`);

  const profileResponse = await fetch(config.profileUrl, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
      "User-Agent": "Aetherio-Auth",
    },
  });
  if (!profileResponse.ok) {
    throw new Error(`${provider} profile request failed with ${profileResponse.status}.`);
  }

  if (provider === "google") {
    const profile = await profileResponse.json<{
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    }>();
    return {
      id: profile.sub ?? "",
      email: profile.email?.trim().toLowerCase() ?? "",
      displayName: profile.name?.trim() || profile.email?.split("@")[0] || "Aetherio",
      emailVerified: profile.email_verified === true,
    };
  }

  const profile = await profileResponse.json<{
    id?: string;
    email?: string;
    verified?: boolean;
    global_name?: string | null;
    username?: string;
  }>();
  return {
    id: profile.id ?? "",
    email: profile.email?.trim().toLowerCase() ?? "",
    displayName: profile.global_name?.trim() || profile.username?.trim() || "Aetherio",
    emailVerified: profile.verified === true,
  };
}

async function findOrCreateOAuthUser(
  env: OAuthEnv,
  provider: OAuthProvider,
  profile: OAuthProfile,
) {
  if (!profile.id) throw new Error("OAuth profile does not contain an id.");

  const linked = await env.USERS_DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.created_at
     FROM oauth_accounts oa
     JOIN users u ON u.id = oa.user_id
     WHERE oa.provider = ? AND oa.provider_user_id = ?`,
  )
    .bind(provider, profile.id)
    .first<UserRow>();
  if (linked) return linked;

  const existing = await env.USERS_DB.prepare(
    "SELECT id, email, display_name, created_at FROM users WHERE email = ?",
  )
    .bind(profile.email)
    .first<UserRow>();

  const now = unixNow();
  const user = existing ?? {
    id: crypto.randomUUID(),
    email: profile.email,
    display_name: profile.displayName.slice(0, 50),
    created_at: now,
  };

  const statements: D1PreparedStatement[] = [];
  if (!existing) {
    statements.push(
      env.USERS_DB.prepare(
        `INSERT INTO users (
          id, email, display_name, password_hash, password_salt,
          password_iterations, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        user.id,
        user.email,
        user.display_name,
        randomToken(32),
        randomToken(16),
        1,
        now,
        now,
      ),
    );
  }
  statements.push(
    env.USERS_DB.prepare(
      `INSERT INTO oauth_accounts (
        provider, provider_user_id, user_id, provider_email, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(provider, profile.id, user.id, profile.email, now, now),
  );
  await env.USERS_DB.batch(statements);
  return user;
}

async function createSession(env: OAuthEnv, userId: string, request: Request) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = unixNow();
  await env.USERS_DB.prepare(
    `INSERT INTO sessions (
      token_hash, user_id, created_at, expires_at, last_seen_at, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      tokenHash,
      userId,
      now,
      now + SESSION_LIFETIME_SECONDS,
      now,
      request.headers.get("User-Agent")?.slice(0, 240) ?? null,
    )
    .run();
  return token;
}

function providerConfig(env: OAuthEnv, provider: OAuthProvider) {
  if (provider === "google") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      profileUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
    };
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return null;
  return {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    authorizationUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/v10/oauth2/token",
    profileUrl: "https://discord.com/api/v10/users/@me",
    scope: "identify email",
  };
}

function providerConfigured(env: OAuthEnv, provider: OAuthProvider) {
  return providerConfig(env, provider) !== null;
}

function callbackFor(origin: string, provider: OAuthProvider) {
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

function redirectToApp(returnTo: string, values: Record<string, string>) {
  const url = new URL(returnTo);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
    },
  });
}

function randomToken(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function oauthJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function oauthPage(title: string, message: string, status: number) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return new Response(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${safeTitle}</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#151515;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif}main{max-width:460px;margin:24px;padding:34px;border:1px solid #ffffff1a;border-radius:28px;background:#202020;box-shadow:0 30px 90px #0008}h1{margin:0 0 12px;font-size:34px;letter-spacing:-.04em}p{margin:0;color:#ffffff8a;line-height:1.6}</style><main><h1>${safeTitle}</h1><p>${safeMessage}</p></main></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
