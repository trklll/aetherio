export interface AuthEnv {
  USERS_DB: D1Database;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  created_at: number;
}

interface SessionUserRow extends UserRow {
  expires_at: number;
}

const PASSWORD_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const encoder = new TextEncoder();

export async function handleAuthRequest(request: Request, env: AuthEnv, pathname: string) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    if (pathname === "/api/auth/register" && request.method === "POST") {
      return register(request, env);
    }
    if (pathname === "/api/auth/login" && request.method === "POST") {
      return login(request, env);
    }
    if (pathname === "/api/auth/me" && request.method === "GET") {
      return currentUser(request, env);
    }
    if (pathname === "/api/auth/logout" && request.method === "POST") {
      return logout(request, env);
    }
    return authJson({ error: "Ruta de autenticación no encontrada." }, 404);
  } catch (error) {
    console.error("[AETHERIO:AUTH]", error);
    return authJson({ error: "No se pudo completar la solicitud." }, 500);
  }
}

async function register(request: Request, env: AuthEnv) {
  const body = await readCredentials(request, true);
  if (body instanceof Response) return body;

  const existing = await env.USERS_DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(body.email)
    .first<{ id: string }>();
  if (existing) {
    return authJson({ error: "Ya existe una cuenta con ese correo." }, 409);
  }

  const now = unixNow();
  const userId = crypto.randomUUID();
  const salt = randomBase64(16);
  const passwordHash = await derivePassword(body.password, salt, PASSWORD_ITERATIONS);

  await env.USERS_DB.prepare(
    `INSERT INTO users (
      id, email, display_name, password_hash, password_salt,
      password_iterations, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      userId,
      body.email,
      body.displayName,
      passwordHash,
      salt,
      PASSWORD_ITERATIONS,
      now,
      now,
    )
    .run();

  const token = await createSession(env, userId, request);
  return authJson({
    token,
    user: { id: userId, email: body.email, displayName: body.displayName, createdAt: now },
  }, 201);
}

async function login(request: Request, env: AuthEnv) {
  const body = await readCredentials(request, false);
  if (body instanceof Response) return body;

  const identifier = await loginIdentifier(request, body.email);
  const cutoff = unixNow() - LOGIN_WINDOW_SECONDS;
  const attempts = await env.USERS_DB.prepare(
    "SELECT COUNT(*) AS count FROM login_attempts WHERE identifier = ? AND attempted_at >= ?",
  )
    .bind(identifier, cutoff)
    .first<{ count: number }>();

  if ((attempts?.count ?? 0) >= MAX_LOGIN_ATTEMPTS) {
    return authJson({ error: "Demasiados intentos. Espera 15 minutos antes de volver a intentar." }, 429);
  }

  const user = await env.USERS_DB.prepare(
    `SELECT id, email, display_name, password_hash, password_salt,
      password_iterations, created_at
     FROM users WHERE email = ?`,
  )
    .bind(body.email)
    .first<UserRow>();

  const valid = user
    ? await verifyPassword(body.password, user.password_salt, user.password_iterations, user.password_hash)
    : false;

  if (!user || !valid) {
    await env.USERS_DB.prepare(
      "INSERT INTO login_attempts (identifier, attempted_at) VALUES (?, ?)",
    )
      .bind(identifier, unixNow())
      .run();
    return authJson({ error: "Correo o contraseña incorrectos." }, 401);
  }

  await env.USERS_DB.batch([
    env.USERS_DB.prepare("DELETE FROM login_attempts WHERE identifier = ?").bind(identifier),
    env.USERS_DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(unixNow()),
  ]);

  const token = await createSession(env, user.id, request);
  return authJson({ token, user: publicUser(user) });
}

async function currentUser(request: Request, env: AuthEnv) {
  const token = bearerToken(request);
  if (!token) return authJson({ error: "Sesión requerida." }, 401);

  const tokenHash = await sha256(token);
  const now = unixNow();
  const user = await env.USERS_DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.password_hash, u.password_salt,
      u.password_iterations, u.created_at, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<SessionUserRow>();

  if (!user) return authJson({ error: "La sesión expiró." }, 401);

  await env.USERS_DB.prepare(
    "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
  )
    .bind(now, tokenHash)
    .run();

  return authJson({ user: publicUser(user), expiresAt: user.expires_at });
}

async function logout(request: Request, env: AuthEnv) {
  const token = bearerToken(request);
  if (token) {
    await env.USERS_DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function createSession(env: AuthEnv, userId: string, request: Request) {
  const token = randomBase64(32);
  const tokenHash = await sha256(token);
  const now = unixNow();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60;
  await env.USERS_DB.prepare(
    `INSERT INTO sessions (
      token_hash, user_id, created_at, expires_at, last_seen_at, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      tokenHash,
      userId,
      now,
      expiresAt,
      now,
      request.headers.get("User-Agent")?.slice(0, 240) ?? null,
    )
    .run();
  return token;
}

async function readCredentials(request: Request, includeName: boolean) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return authJson({ error: "El cuerpo de la solicitud no es válido." }, 400);
  }

  if (!raw || typeof raw !== "object") {
    return authJson({ error: "Completa todos los campos." }, 400);
  }

  const record = raw as Record<string, unknown>;
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const password = typeof record.password === "string" ? record.password : "";
  const displayName = typeof record.displayName === "string" ? record.displayName.trim() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return authJson({ error: "Escribe un correo válido." }, 400);
  }
  if (password.length < 10 || password.length > 128) {
    return authJson({ error: "La contraseña debe tener entre 10 y 128 caracteres." }, 400);
  }
  if (includeName && (displayName.length < 2 || displayName.length > 50)) {
    return authJson({ error: "El nombre debe tener entre 2 y 50 caracteres." }, 400);
  }

  return { email, password, displayName };
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    createdAt: user.created_at,
  };
}

async function derivePassword(password: string, saltBase64: string, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64(saltBase64),
      iterations,
    },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

async function verifyPassword(password: string, salt: string, iterations: number, expected: string) {
  const actual = fromBase64(await derivePassword(password, salt, iterations));
  const expectedBytes = fromBase64(expected);
  if (actual.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function loginIdentifier(request: Request, email: string) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return sha256(`${ip}:${email}`);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomBase64(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function authJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
