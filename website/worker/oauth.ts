export interface OAuthEnv {
  USERS_DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ANILIST_CLIENT_ID?: string;
  ANILIST_CLIENT_SECRET?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
}

type OAuthProvider = "google" | "anilist";

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
      anilist: providerConfigured(env, "anilist"),
    });
  }

  const startMatch = /^\/api\/auth\/oauth\/(google|anilist)\/start$/.exec(pathname);
  if (startMatch && request.method === "GET") {
    return startOAuth(request, env, startMatch[1] as OAuthProvider);
  }

  const callbackMatch = /^\/api\/auth\/oauth\/(google)\/callback$/.exec(pathname);
  if (callbackMatch && request.method === "GET") {
    return finishOAuth(request, env, callbackMatch[1] as OAuthProvider);
  }

  if (pathname === "/api/auth/oauth/exchange" && request.method === "POST") {
    return exchangeAppCode(request, env);
  }
  if (pathname === "/api/auth/oauth/anilist/session" && request.method === "POST") {
    return createAniListSession(request, env);
  }
  if (pathname === "/api/integrations/anilist/anime" && request.method === "GET") {
    return getAniListAnimeList(request, env);
  }
  const aniListUpdateMatch = /^\/api\/integrations\/anilist\/anime\/(\d+)$/.exec(pathname);
  if (aniListUpdateMatch && request.method === "PUT") {
    return updateAniListAnime(request, env, Number(aniListUpdateMatch[1]));
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

  if (provider === "anilist") {
    const authorizationUrl = new URL(config.authorizationUrl);
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("response_type", "token");
    return oauthRedirect(authorizationUrl.toString());
  }

  const now = unixNow();
  const state = randomToken(32);
  const pkceVerifier = null;
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
  if (provider === "google") authorizationUrl.searchParams.set("prompt", "select_account");
  return oauthRedirect(authorizationUrl.toString());
}

function oauthRedirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
    },
  });
}

async function createAniListSession(request: Request, env: OAuthEnv) {
  let input: {
    accessToken?: unknown;
    viewer?: { id?: unknown; name?: unknown };
  };
  try {
    input = await request.json<typeof input>();
  } catch {
    return oauthJson({ error: "Credencial de AniList inválida." }, 400);
  }

  const accessToken = typeof input.accessToken === "string" ? input.accessToken.trim() : "";
  const viewerId = Number(input.viewer?.id);
  const viewerName = typeof input.viewer?.name === "string" ? input.viewer.name.trim() : "";
  if (accessToken.length < 100 || !Number.isInteger(viewerId) || viewerId <= 0 || !viewerName) {
    return oauthJson({ error: "AniList no devolvió una identidad válida." }, 400);
  }

  const claims = decodeJwtPayload(accessToken);
  if (!claims || typeof claims.exp !== "number" || claims.exp <= unixNow()) {
    return oauthJson({ error: "La autorización de AniList expiró o no es válida." }, 401);
  }
  if (claims.sub != null && Number(claims.sub) !== viewerId) {
    return oauthJson({ error: "La identidad de AniList no coincide con la autorización." }, 401);
  }

  const fingerprint = await sha256(accessToken);
  const linkedUserId = await authenticatedUserId(request, env);
  const profile: OAuthProfile = {
    id: `token:${fingerprint}`,
    email: `anilist-${fingerprint.slice(0, 24)}@anilist.aetherio.local`,
    displayName: viewerName,
    emailVerified: true,
    username: viewerName,
  };
  const user = await findOrCreateOAuthUser(
    env,
    "anilist",
    profile,
    null,
    linkedUserId,
  );
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
  _pkceVerifier: string | null,
): Promise<{ profile: OAuthProfile; tokens: OAuthTokens | null }> {
  const config = providerConfig(env, provider);
  if (!config) throw new Error("OAuth provider is not configured.");

  const callbackUrl = callbackFor(new URL(request.url).origin, provider);
  const tokenInput = {
    client_id: config.clientId,
    client_secret: config.clientSecret ?? "",
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl,
  };
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": provider === "anilist"
        ? "application/json"
        : "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "Aetherio/0.4",
    },
    body: provider === "anilist"
      ? JSON.stringify(tokenInput)
      : new URLSearchParams(tokenInput),
  });
  if (!tokenResponse.ok) {
    const detail = (await tokenResponse.text()).replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      `${provider} token exchange failed with ${tokenResponse.status}${detail ? `: ${detail}` : "."}`,
    );
  }
  const token = await tokenResponse.json<{
    access_token?: string;
    expires_in?: number;
  }>();
  if (!token.access_token) throw new Error(`${provider} did not return an access token.`);

  if (provider === "google") {
    const profileResponse = await fetch(config.profileUrl, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json",
        "User-Agent": "Aetherio-Auth",
      },
    });
    if (!profileResponse.ok) {
      throw new Error(`google profile request failed with ${profileResponse.status}.`);
    }
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

  const viewer = await aniListGraphql<{
    Viewer?: { id?: number; name?: string };
  }>(token.access_token, "query { Viewer { id name } }");
  const id = typeof viewer.Viewer?.id === "number" ? String(viewer.Viewer.id) : "";
  const username = viewer.Viewer?.name?.trim() || `anilist-${id}`;
  return {
    profile: {
      id,
      email: `${username.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}-${id}@anilist.aetherio.local`,
      displayName: username,
      emailVerified: true,
      username,
    },
    tokens: {
      accessToken: token.access_token,
      expiresAt: unixNow() + Math.max(60, token.expires_in ?? 365 * 24 * 60 * 60),
    },
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
    if (provider === "anilist" && tokens) {
      await saveAniListTokens(env, linked.id, profile, tokens);
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
  if (linkUserId && provider === "anilist") {
    statements.push(
      env.USERS_DB.prepare(
        "DELETE FROM oauth_accounts WHERE provider = 'anilist' AND user_id = ?",
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
      provider === "anilist" && tokens ? await encryptSecret(env, tokens.accessToken) : null,
      null,
      provider === "anilist" ? tokens?.expiresAt ?? null : null,
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

async function getAniListAnimeList(request: Request, env: OAuthEnv) {
  const userId = await authenticatedUserId(request, env);
  if (!userId) return oauthJson({ error: "Sesión requerida." }, 401);
  const account = await getAniListAccount(env, userId);
  if (!account) return oauthJson({ error: "Conecta AniList para sincronizar tu biblioteca." }, 404);

  const result = await aniListGraphql<{
    MediaListCollection?: {
      lists?: Array<{
        entries?: Array<{
          mediaId?: number;
          status?: string;
          score?: number;
          progress?: number;
          updatedAt?: number;
          media?: {
            id?: number;
            title?: { userPreferred?: string; romaji?: string; english?: string };
            episodes?: number;
            coverImage?: { extraLarge?: string; large?: string };
            startDate?: { year?: number };
          };
        }>;
      }>;
    };
  }>(
    account.accessToken,
    `query AetherioAnimeList($userId: Int!) {
      MediaListCollection(userId: $userId, type: ANIME) {
        lists {
          entries {
            mediaId
            status
            score(format: POINT_10)
            progress
            updatedAt
            media {
              id
              title { userPreferred romaji english }
              episodes
              coverImage { extraLarge large }
              startDate { year }
            }
          }
        }
      }
    }`,
    { userId: Number(account.providerUserId) },
  );

  const entries = (result.MediaListCollection?.lists ?? []).flatMap(list =>
    (list.entries ?? []).flatMap(entry => {
      const media = entry.media;
      const aniListId = media?.id ?? entry.mediaId;
      const status = fromAniListStatus(entry.status);
      const title = media?.title?.userPreferred || media?.title?.english || media?.title?.romaji;
      if (!aniListId || !status || !title) return [];
      return [{
        aniListId,
        title,
        originalTitle: media?.title?.romaji || title,
        status,
        score: entry.score ?? 0,
        watchedEpisodes: entry.progress ?? 0,
        totalEpisodes: media?.episodes ?? 0,
        poster: media?.coverImage?.extraLarge ?? media?.coverImage?.large,
        year: media?.startDate?.year,
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt * 1000).toISOString() : null,
      }];
    }),
  );

  return oauthJson({ entries, syncedAt: Date.now() });
}

async function updateAniListAnime(request: Request, env: OAuthEnv, aniListId: number) {
  const userId = await authenticatedUserId(request, env);
  if (!userId) return oauthJson({ error: "Sesión requerida." }, 401);
  const account = await getAniListAccount(env, userId);
  if (!account) return oauthJson({ error: "AniList no está conectado." }, 404);

  let input: { status?: unknown; watchedEpisodes?: unknown; score?: unknown };
  try {
    input = await request.json<typeof input>();
  } catch {
    return oauthJson({ error: "Actualización de AniList inválida." }, 400);
  }
  const status = typeof input.status === "string" ? toAniListStatus(input.status) : null;
  const watchedEpisodes = Number.isInteger(input.watchedEpisodes) && Number(input.watchedEpisodes) >= 0
    ? Number(input.watchedEpisodes)
    : null;
  const score = typeof input.score === "number" && Number.isFinite(input.score)
    && input.score >= 0 && input.score <= 10
    ? input.score
    : null;
  if (!status && watchedEpisodes === null && score === null) {
    return oauthJson({ error: "No hay cambios válidos para AniList." }, 400);
  }

  const result = await aniListGraphql<{
    SaveMediaListEntry?: { id?: number; status?: string; progress?: number; score?: number };
  }>(
    account.accessToken,
    `mutation AetherioUpdateAnime(
      $mediaId: Int!,
      $status: MediaListStatus,
      $progress: Int,
      $score: Float
    ) {
      SaveMediaListEntry(
        mediaId: $mediaId,
        status: $status,
        progress: $progress,
        score: $score
      ) {
        id
        status
        progress
        score(format: POINT_10)
      }
    }`,
    {
      mediaId: aniListId,
      status,
      progress: watchedEpisodes,
      score,
    },
  );
  return oauthJson(result.SaveMediaListEntry ?? {});
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

async function getAniListAccount(env: OAuthEnv, userId: string) {
  const account = await env.USERS_DB.prepare(
    `SELECT provider_user_id, access_token_ciphertext, token_expires_at
     FROM oauth_accounts WHERE provider = 'anilist' AND user_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{
      provider_user_id: string;
      access_token_ciphertext: string | null;
      token_expires_at: number | null;
    }>();
  if (!account?.access_token_ciphertext) return null;
  if ((account.token_expires_at ?? 0) <= unixNow() + 60) return null;
  return {
    providerUserId: account.provider_user_id,
    accessToken: await decryptSecret(env, account.access_token_ciphertext),
  };
}

async function saveAniListTokens(
  env: OAuthEnv,
  userId: string,
  profile: OAuthProfile,
  tokens: OAuthTokens,
) {
  await env.USERS_DB.prepare(
    `UPDATE oauth_accounts SET provider_username = ?, access_token_ciphertext = ?,
      refresh_token_ciphertext = ?, token_expires_at = ?, updated_at = ?
     WHERE provider = 'anilist' AND user_id = ?`,
  )
    .bind(
      profile.username ?? null,
      await encryptSecret(env, tokens.accessToken),
      null,
      tokens.expiresAt ?? null,
      unixNow(),
      userId,
    )
    .run();
}

async function aniListGraphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Aetherio/0.4",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json<{
    data?: T;
    errors?: Array<{ message?: string }>;
  }>();
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.[0]?.message || `AniList GraphQL failed with ${response.status}.`);
  }
  return payload.data;
}

function fromAniListStatus(status?: string) {
  const statuses: Record<string, string> = {
    CURRENT: "watching",
    REPEATING: "watching",
    COMPLETED: "completed",
    PAUSED: "on_hold",
    DROPPED: "dropped",
    PLANNING: "plan_to_watch",
  };
  return status ? statuses[status] ?? null : null;
}

function toAniListStatus(status: string) {
  const statuses: Record<string, string> = {
    watching: "CURRENT",
    completed: "COMPLETED",
    on_hold: "PAUSED",
    dropped: "DROPPED",
    plan_to_watch: "PLANNING",
  };
  return statuses[status] ?? null;
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

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
      exp?: number;
      sub?: string | number;
    };
  } catch {
    return null;
  }
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
  if (!env.ANILIST_CLIENT_ID) return null;
  return {
    clientId: env.ANILIST_CLIENT_ID,
    clientSecret: env.ANILIST_CLIENT_SECRET,
    authorizationUrl: "https://anilist.co/api/v2/oauth/authorize",
    tokenUrl: "https://anilist.co/api/v2/oauth/token",
    profileUrl: "https://graphql.anilist.co",
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
  return "AniList";
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
