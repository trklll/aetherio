export interface OAuthEnv {
  USERS_DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  MAL_CLIENT_ID?: string;
  MAL_CLIENT_SECRET?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
}

type OAuthProvider = "google" | "discord" | "mal";

interface OAuthStateRow {
  provider: OAuthProvider;
  return_to: string;
  expires_at: number;
  pkce_verifier: string | null;
  link_user_id: string | null;
}

interface OAuthProfile {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  username?: string;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
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
      mal: providerConfigured(env, "mal"),
    });
  }

  const startMatch = /^\/api\/auth\/oauth\/(google|discord|mal)\/start$/.exec(pathname);
  if (startMatch && request.method === "GET") {
    return startOAuth(request, env, startMatch[1] as OAuthProvider);
  }

  const callbackMatch = /^\/api\/auth\/oauth\/(google|discord|mal)\/callback$/.exec(pathname);
  if (callbackMatch && request.method === "GET") {
    return finishOAuth(request, env, callbackMatch[1] as OAuthProvider);
  }

  if (pathname === "/api/auth/oauth/exchange" && request.method === "POST") {
    return exchangeAppCode(request, env);
  }
  if (pathname === "/api/integrations/mal/connect" && request.method === "POST") {
    const userId = await authenticatedUserId(request, env);
    if (!userId) return oauthJson({ error: "Sesión requerida." }, 401);
    const redirect = await startOAuth(request, env, "mal", userId);
    if (redirect.status !== 302) return redirect;
    const authorizationUrl = redirect.headers.get("Location");
    if (!authorizationUrl) return oauthJson({ error: "No se pudo iniciar la conexión con MyAnimeList." }, 500);
    return oauthJson({ authorizationUrl });
  }
  if (pathname === "/api/integrations/mal/anime" && request.method === "GET") {
    return getMalAnimeList(request, env);
  }
  const malUpdateMatch = /^\/api\/integrations\/mal\/anime\/(\d+)$/.exec(pathname);
  if (malUpdateMatch && request.method === "PUT") {
    return updateMalAnime(request, env, Number(malUpdateMatch[1]));
  }

  return null;
}

async function startOAuth(
  request: Request,
  env: OAuthEnv,
  provider: OAuthProvider,
  linkUserId: string | null = null,
) {
  const config = providerConfig(env, provider);
  if (!config) {
    return oauthPage(
      "Proveedor pendiente",
      `${providerLabel(provider)} todavía no tiene credenciales configuradas en Cloudflare.`,
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
  const pkceVerifier = provider === "mal" ? randomToken(72) : null;
  await env.USERS_DB.batch([
    env.USERS_DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(now),
    env.USERS_DB.prepare(
      `INSERT INTO oauth_states (
        state_hash, provider, return_to, created_at, expires_at, pkce_verifier, link_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      await sha256(state),
      provider,
      returnTo,
      now,
      now + STATE_LIFETIME_SECONDS,
      pkceVerifier,
      linkUserId,
    ),
  ]);

  const callbackUrl = callbackFor(requestUrl.origin, provider);
  const authorizationUrl = new URL(config.authorizationUrl);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  if (config.scope) authorizationUrl.searchParams.set("scope", config.scope);
  authorizationUrl.searchParams.set("state", state);
  if (provider === "mal") {
    authorizationUrl.searchParams.set("code_challenge", pkceVerifier!);
    authorizationUrl.searchParams.set("code_challenge_method", "plain");
  } else {
    authorizationUrl.searchParams.set("prompt", provider === "google" ? "select_account" : "consent");
  }
  return Response.redirect(authorizationUrl.toString(), 302);
}

async function finishOAuth(request: Request, env: OAuthEnv, provider: OAuthProvider) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state")?.trim();
  if (!state) return oauthPage("Solicitud inválida", "Falta el estado de seguridad OAuth.", 400);

  const stateHash = await sha256(state);
  const stored = await env.USERS_DB.prepare(
    `SELECT provider, return_to, expires_at, pkce_verifier, link_user_id
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
    const { profile, tokens } = await fetchOAuthProfile(request, env, provider, code, stored.pkce_verifier);
    if (!profile.email || !profile.emailVerified) {
      return redirectToApp(stored.return_to, { error: "email_not_verified" });
    }

    const user = await findOrCreateOAuthUser(
      env,
      provider,
      profile,
      tokens,
      stored.link_user_id,
    );
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
  pkceVerifier: string | null,
): Promise<{ profile: OAuthProfile; tokens: OAuthTokens | null }> {
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
  if (provider === "mal") {
    if (!pkceVerifier) throw new Error("MAL PKCE verifier is missing.");
    tokenBody.set("code_verifier", pkceVerifier);
  }
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
  const token = await tokenResponse.json<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>();
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
      profile: {
        id: profile.sub ?? "",
        email: profile.email?.trim().toLowerCase() ?? "",
        displayName: profile.name?.trim() || profile.email?.split("@")[0] || "Aetherio",
        emailVerified: profile.email_verified === true,
      },
      tokens: null,
    };
  }

  if (provider === "mal") {
    const profile = await profileResponse.json<{
      id?: number;
      name?: string;
    }>();
    const id = typeof profile.id === "number" ? String(profile.id) : "";
    const username = profile.name?.trim() || `mal-${id}`;
    return {
      profile: {
        id,
        email: `${username.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}-${id}@mal.aetherio.local`,
        displayName: username,
        emailVerified: true,
        username,
      },
      tokens: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: unixNow() + Math.max(60, token.expires_in ?? 3600),
      },
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
    profile: {
      id: profile.id ?? "",
      email: profile.email?.trim().toLowerCase() ?? "",
      displayName: profile.global_name?.trim() || profile.username?.trim() || "Aetherio",
      emailVerified: profile.verified === true,
    },
    tokens: null,
  };
}

async function findOrCreateOAuthUser(
  env: OAuthEnv,
  provider: OAuthProvider,
  profile: OAuthProfile,
  tokens: OAuthTokens | null,
  linkUserId: string | null,
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
  if (linked) {
    if (linkUserId && linked.id !== linkUserId) {
      throw new Error(`${provider} account is already linked to another Aetherio user.`);
    }
    if (provider === "mal" && tokens) {
      await saveMalTokens(env, linked.id, profile, tokens);
    }
    return linked;
  }

  const existing = await env.USERS_DB.prepare(
    linkUserId
      ? "SELECT id, email, display_name, created_at FROM users WHERE id = ?"
      : "SELECT id, email, display_name, created_at FROM users WHERE email = ?",
  )
    .bind(linkUserId ?? profile.email)
    .first<UserRow>();
  if (linkUserId && !existing) throw new Error("Aetherio account to link no longer exists.");

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
  if (linkUserId && provider === "mal") {
    statements.push(
      env.USERS_DB.prepare(
        "DELETE FROM oauth_accounts WHERE provider = 'mal' AND user_id = ?",
      ).bind(linkUserId),
    );
  }
  statements.push(
    env.USERS_DB.prepare(
      `INSERT INTO oauth_accounts (
        provider, provider_user_id, user_id, provider_email, provider_username,
        access_token_ciphertext, refresh_token_ciphertext, token_expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      provider,
      profile.id,
      user.id,
      profile.email,
      profile.username ?? null,
      provider === "mal" && tokens ? await encryptSecret(env, tokens.accessToken) : null,
      provider === "mal" && tokens?.refreshToken ? await encryptSecret(env, tokens.refreshToken) : null,
      provider === "mal" ? tokens?.expiresAt ?? null : null,
      now,
      now,
    ),
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

async function getMalAnimeList(request: Request, env: OAuthEnv) {
  const userId = await authenticatedUserId(request, env);
  if (!userId) return oauthJson({ error: "Sesión requerida." }, 401);
  const accessToken = await getMalAccessToken(env, userId);
  if (!accessToken) return oauthJson({ error: "Conecta MyAnimeList para sincronizar tu biblioteca." }, 404);

  const entries: unknown[] = [];
  let nextUrl: string | null = "https://api.myanimelist.net/v2/users/@me/animelist"
    + "?limit=1000&fields=list_status,num_episodes,main_picture,alternative_titles,start_date";

  for (let page = 0; nextUrl && page < 20; page += 1) {
    const parsed: URL = new URL(nextUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== "api.myanimelist.net") {
      throw new Error("MAL returned an unsafe paging URL.");
    }
    const response: Response = await fetch(parsed.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Aetherio/0.4",
      },
    });
    if (!response.ok) throw new Error(`MAL anime list failed with ${response.status}.`);
    const payload = await response.json() as {
      data?: Array<{
        node?: {
          id?: number;
          title?: string;
          num_episodes?: number;
          main_picture?: { medium?: string; large?: string };
          alternative_titles?: { en?: string; ja?: string };
          start_date?: string;
        };
        list_status?: {
          status?: string;
          score?: number;
          num_episodes_watched?: number;
          updated_at?: string;
        };
      }>;
      paging?: { next?: string };
    };
    for (const item of payload.data ?? []) {
      if (!item.node?.id || !item.node.title || !item.list_status?.status) continue;
      entries.push({
        malId: item.node.id,
        title: item.node.alternative_titles?.en || item.node.title,
        originalTitle: item.node.title,
        status: item.list_status.status,
        score: item.list_status.score ?? 0,
        watchedEpisodes: item.list_status.num_episodes_watched ?? 0,
        totalEpisodes: item.node.num_episodes ?? 0,
        poster: item.node.main_picture?.large ?? item.node.main_picture?.medium,
        year: item.node.start_date ? Number(item.node.start_date.slice(0, 4)) || undefined : undefined,
        updatedAt: item.list_status.updated_at ?? null,
      });
    }
    nextUrl = payload.paging?.next ?? null;
  }

  return oauthJson({ entries, syncedAt: Date.now() });
}

async function updateMalAnime(request: Request, env: OAuthEnv, malId: number) {
  const userId = await authenticatedUserId(request, env);
  if (!userId) return oauthJson({ error: "Sesión requerida." }, 401);
  const accessToken = await getMalAccessToken(env, userId);
  if (!accessToken) return oauthJson({ error: "MyAnimeList no está conectado." }, 404);

  let input: { status?: unknown; watchedEpisodes?: unknown; score?: unknown };
  try {
    input = await request.json<typeof input>();
  } catch {
    return oauthJson({ error: "Actualización MAL inválida." }, 400);
  }
  const allowedStatuses = new Set(["watching", "completed", "on_hold", "dropped", "plan_to_watch"]);
  const status = typeof input.status === "string" && allowedStatuses.has(input.status) ? input.status : null;
  const watchedEpisodes = Number.isInteger(input.watchedEpisodes) && Number(input.watchedEpisodes) >= 0
    ? Number(input.watchedEpisodes)
    : null;
  const score = Number.isInteger(input.score) && Number(input.score) >= 0 && Number(input.score) <= 10
    ? Number(input.score)
    : null;
  if (!status && watchedEpisodes === null && score === null) {
    return oauthJson({ error: "No hay cambios válidos para MyAnimeList." }, 400);
  }

  const body = new URLSearchParams();
  if (status) body.set("status", status);
  if (watchedEpisodes !== null) body.set("num_watched_episodes", String(watchedEpisodes));
  if (score !== null) body.set("score", String(score));
  const response = await fetch(`https://api.myanimelist.net/v2/anime/${malId}/my_list_status`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "Aetherio/0.4",
    },
    body,
  });
  if (!response.ok) throw new Error(`MAL list update failed with ${response.status}.`);
  return oauthJson(await response.json());
}

async function authenticatedUserId(request: Request, env: OAuthEnv) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!token) return null;
  const session = await env.USERS_DB.prepare(
    "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
  )
    .bind(await sha256(token), unixNow())
    .first<{ user_id: string }>();
  return session?.user_id ?? null;
}

async function getMalAccessToken(env: OAuthEnv, userId: string) {
  const account = await env.USERS_DB.prepare(
    `SELECT access_token_ciphertext, refresh_token_ciphertext, token_expires_at
     FROM oauth_accounts WHERE provider = 'mal' AND user_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{
      access_token_ciphertext: string | null;
      refresh_token_ciphertext: string | null;
      token_expires_at: number | null;
    }>();
  if (!account?.access_token_ciphertext) return null;
  if ((account.token_expires_at ?? 0) > unixNow() + 60) {
    return decryptSecret(env, account.access_token_ciphertext);
  }
  if (!account.refresh_token_ciphertext) return null;

  const config = providerConfig(env, "mal");
  if (!config) return null;
  const refreshToken = await decryptSecret(env, account.refresh_token_ciphertext);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw new Error(`MAL token refresh failed with ${response.status}.`);
  const token = await response.json<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>();
  if (!token.access_token) throw new Error("MAL did not refresh the access token.");
  await env.USERS_DB.prepare(
    `UPDATE oauth_accounts SET access_token_ciphertext = ?, refresh_token_ciphertext = ?,
      token_expires_at = ?, updated_at = ? WHERE provider = 'mal' AND user_id = ?`,
  )
    .bind(
      await encryptSecret(env, token.access_token),
      await encryptSecret(env, token.refresh_token || refreshToken),
      unixNow() + Math.max(60, token.expires_in ?? 3600),
      unixNow(),
      userId,
    )
    .run();
  return token.access_token;
}

async function saveMalTokens(
  env: OAuthEnv,
  userId: string,
  profile: OAuthProfile,
  tokens: OAuthTokens,
) {
  await env.USERS_DB.prepare(
    `UPDATE oauth_accounts SET provider_username = ?, access_token_ciphertext = ?,
      refresh_token_ciphertext = ?, token_expires_at = ?, updated_at = ?
     WHERE provider = 'mal' AND user_id = ?`,
  )
    .bind(
      profile.username ?? null,
      await encryptSecret(env, tokens.accessToken),
      tokens.refreshToken ? await encryptSecret(env, tokens.refreshToken) : null,
      tokens.expiresAt ?? null,
      unixNow(),
      userId,
    )
    .run();
}

async function encryptSecret(env: OAuthEnv, value: string) {
  if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) throw new Error("OAuth encryption key is missing.");
  const key = await encryptionKey(env.OAUTH_TOKEN_ENCRYPTION_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  ));
  return bytesToBase64Url(new Uint8Array([...iv, ...encrypted]));
}

async function decryptSecret(env: OAuthEnv, value: string) {
  if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) throw new Error("OAuth encryption key is missing.");
  const packed = base64UrlToBytes(value);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(0, 12) },
    await encryptionKey(env.OAUTH_TOKEN_ENCRYPTION_KEY),
    packed.slice(12),
  );
  return new TextDecoder().decode(decrypted);
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
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
  if (provider === "discord") {
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
  if (!env.MAL_CLIENT_ID || !env.MAL_CLIENT_SECRET || !env.OAUTH_TOKEN_ENCRYPTION_KEY) return null;
  return {
    clientId: env.MAL_CLIENT_ID,
    clientSecret: env.MAL_CLIENT_SECRET,
    authorizationUrl: "https://myanimelist.net/v1/oauth2/authorize",
    tokenUrl: "https://myanimelist.net/v1/oauth2/token",
    profileUrl: "https://api.myanimelist.net/v2/users/@me",
    scope: "",
  };
}

function providerConfigured(env: OAuthEnv, provider: OAuthProvider) {
  return providerConfig(env, provider) !== null;
}

function callbackFor(origin: string, provider: OAuthProvider) {
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

function providerLabel(provider: OAuthProvider) {
  if (provider === "google") return "Google";
  if (provider === "discord") return "Discord";
  return "MyAnimeList";
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
