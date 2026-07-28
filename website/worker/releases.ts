export interface ReleaseEnv {
  USERS_DB: D1Database;
  RELEASE_PUBLISH_TOKEN?: string;
}

interface ReleaseRecord {
  version: string;
  version_major: number;
  version_minor: number;
  version_patch: number;
  notes: string;
  published_at: string;
  installer_url: string;
  installer_size: number | null;
  installer_sha256: string;
  signature_current: string;
  signature_legacy: string | null;
}

interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
  assets: GitHubAsset[];
}

interface PublishReleaseBody {
  version?: unknown;
  notes?: unknown;
  pubDate?: unknown;
  url?: unknown;
  size?: unknown;
  sha256?: unknown;
  signatureCurrent?: unknown;
  signatureLegacy?: unknown;
}

const GITHUB_RELEASE_API = "https://api.github.com/repos/trklll/aetherio/releases/latest";
const LEGACY_KEY_CUTOFF = "0.3.0";
const CACHE_SECONDS = 300;

export async function handleReleaseRequest(
  request: Request,
  env: ReleaseEnv,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === "/api/internal/releases" && request.method === "POST") {
    return publishRelease(request, env);
  }

  if (url.pathname === "/api/release" && request.method === "GET") {
    return releaseInfo(env);
  }

  if (url.pathname.startsWith("/api/update/") && request.method === "GET") {
    return updateManifest(env, url);
  }

  if (url.pathname === "/download/windows" && ["GET", "HEAD"].includes(request.method)) {
    const release = await getLatestRelease(env);
    if (!release) return releaseJson({ error: "No hay un instalador compatible disponible." }, 404);
    return Response.redirect(release.installer_url, 302);
  }

  return null;
}

async function publishRelease(request: Request, env: ReleaseEnv) {
  if (!env.RELEASE_PUBLISH_TOKEN) {
    return releaseJson({ error: "La publicación interna no está configurada." }, 503);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(token, env.RELEASE_PUBLISH_TOKEN.trim())) {
    return releaseJson({ error: "No autorizado." }, 401);
  }

  let body: PublishReleaseBody;
  try {
    body = await request.json<PublishReleaseBody>();
  } catch {
    return releaseJson({ error: "Payload inválido." }, 400);
  }

  const version = text(body.version);
  const parsedVersion = parseStableVersion(version);
  const notes = text(body.notes);
  const pubDate = text(body.pubDate);
  const installerUrl = text(body.url);
  const sha256 = text(body.sha256).toLowerCase().replace(/^sha256:/, "");
  const signatureCurrent = text(body.signatureCurrent);
  const signatureLegacy = text(body.signatureLegacy) || null;
  const size = typeof body.size === "number" && Number.isSafeInteger(body.size) && body.size > 0
    ? body.size
    : null;

  if (!parsedVersion) return releaseJson({ error: "La versión debe ser SemVer estable." }, 400);
  if (!isHttpsUrl(installerUrl)) return releaseJson({ error: "La URL del instalador debe usar HTTPS." }, 400);
  if (!/^[a-f0-9]{64}$/.test(sha256)) return releaseJson({ error: "SHA-256 inválido." }, 400);
  if (!isSignature(signatureCurrent)) return releaseJson({ error: "Firma actual inválida." }, 400);
  if (signatureLegacy && !isSignature(signatureLegacy)) {
    return releaseJson({ error: "Firma legacy inválida." }, 400);
  }
  if (!pubDate || Number.isNaN(Date.parse(pubDate))) {
    return releaseJson({ error: "Fecha de publicación inválida." }, 400);
  }

  const now = unixNow();
  await env.USERS_DB.prepare(
    `INSERT INTO app_releases (
      version, version_major, version_minor, version_patch, notes, published_at,
      installer_url, installer_size, installer_sha256, signature_current,
      signature_legacy, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(version) DO UPDATE SET
      notes = excluded.notes,
      published_at = excluded.published_at,
      installer_url = excluded.installer_url,
      installer_size = excluded.installer_size,
      installer_sha256 = excluded.installer_sha256,
      signature_current = excluded.signature_current,
      signature_legacy = excluded.signature_legacy,
      updated_at = excluded.updated_at`,
  )
    .bind(
      version,
      parsedVersion[0],
      parsedVersion[1],
      parsedVersion[2],
      notes,
      new Date(pubDate).toISOString(),
      installerUrl,
      size,
      sha256,
      signatureCurrent,
      signatureLegacy,
      now,
      now,
    )
    .run();

  return releaseJson({ ok: true, version }, 201);
}

async function releaseInfo(env: ReleaseEnv) {
  try {
    const release = await getLatestRelease(env);
    if (!release) return releaseJson({ error: "No se encontró el instalador de Windows." }, 404);
    return releaseJson(
      {
        version: release.version,
        name: `Aetherio ${release.version}`,
        notes: release.notes,
        publishedAt: release.published_at,
        downloadUrl: "/download/windows",
        size: release.installer_size,
        sha256: release.installer_sha256,
      },
      200,
      CACHE_SECONDS,
    );
  } catch (error) {
    return releaseJson({ error: describeError(error) }, 502, 30);
  }
}

async function updateManifest(env: ReleaseEnv, url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 5) {
    return releaseJson({ error: "Ruta de actualización inválida." }, 400);
  }

  const [, , target, arch, rawCurrentVersion] = parts;
  if (target !== "windows" || !["x86_64", "x86-64", "x64"].includes(arch)) {
    return new Response(null, { status: 204 });
  }

  try {
    const release = await getLatestRelease(env);
    const currentVersion = normalizeVersion(rawCurrentVersion);
    if (!release || compareSemver(release.version, currentVersion) <= 0) {
      return new Response(null, { status: 204 });
    }

    const legacyClient = compareSemver(currentVersion, LEGACY_KEY_CUTOFF) < 0;
    const signature = legacyClient ? release.signature_legacy : release.signature_current;
    if (!signature) {
      return releaseJson(
        {
          error: legacyClient
            ? "Esta instalación necesita el puente de actualización legacy."
            : "El release interno no contiene una firma compatible.",
          repairUrl: "https://aetherio.aetherio.workers.dev/download/windows",
        },
        409,
      );
    }

    return releaseJson(
      {
        version: release.version,
        notes: release.notes,
        pub_date: release.published_at,
        url: release.installer_url,
        signature,
      },
      200,
      CACHE_SECONDS,
    );
  } catch (error) {
    return releaseJson({ error: describeError(error) }, 502, 30);
  }
}

async function getLatestRelease(env: ReleaseEnv): Promise<ReleaseRecord | null> {
  const internal = await env.USERS_DB.prepare(
    `SELECT version, version_major, version_minor, version_patch, notes,
      published_at, installer_url, installer_size, installer_sha256,
      signature_current, signature_legacy
     FROM app_releases
     ORDER BY version_major DESC, version_minor DESC, version_patch DESC
     LIMIT 1`,
  ).first<ReleaseRecord>();
  if (internal) return internal;
  return getLatestGitHubRelease();
}

async function getLatestGitHubRelease(): Promise<ReleaseRecord | null> {
  const release = await fetchLatestGitHubRelease();
  const installer = findWindowsInstaller(release.assets);
  if (!installer) return null;
  const signatureAsset = release.assets.find(asset => asset.name === `${installer.name}.sig`);
  if (!signatureAsset) throw new Error("El release no contiene una firma del updater.");

  const signatureResponse = await fetch(signatureAsset.browser_download_url, {
    headers: { "User-Agent": "Aetherio-Updater" },
  });
  if (!signatureResponse.ok) throw new Error("No se pudo recuperar la firma del updater.");
  const signature = (await signatureResponse.text()).trim();
  if (!isSignature(signature)) throw new Error("La firma del updater es inválida.");

  return {
    version: normalizeVersion(release.tag_name),
    version_major: 0,
    version_minor: 0,
    version_patch: 0,
    notes: release.body || "",
    published_at: release.published_at,
    installer_url: installer.browser_download_url,
    installer_size: installer.size,
    installer_sha256: installer.digest?.replace(/^sha256:/, "") ?? "",
    signature_current: signature,
    signature_legacy: null,
  };
}

async function fetchLatestGitHubRelease(): Promise<GitHubRelease> {
  const cache = await caches.open("aetherio-releases");
  const cacheKey = new Request(GITHUB_RELEASE_API, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json<GitHubRelease>();

  const response = await fetch(GITHUB_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Aetherio-Cloudflare-Updater",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}.`);

  const release = await response.json<GitHubRelease>();
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(release), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      },
    }),
  );
  return release;
}

function findWindowsInstaller(assets: GitHubAsset[]) {
  return assets.find(asset => /_x64-setup\.exe$/i.test(asset.name))
    ?? assets.find(asset => /\.exe$/i.test(asset.name) && !/\.sig$/i.test(asset.name));
}

function parseStableVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function normalizeVersion(version: string) {
  return decodeURIComponent(version).trim().replace(/^v/i, "");
}

function compareSemver(left: string, right: string) {
  const parse = (value: string) => normalizeVersion(value)
    .split("-")[0]
    .split(".")
    .map(part => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function isHttpsUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isSignature(value: string) {
  try {
    const decoded = atob(value.trim());
    const lines = decoded.split(/\r?\n/);
    return lines.length >= 4
      && lines[0].startsWith("untrusted comment:")
      && lines[2].startsWith("trusted comment:");
  } catch {
    return false;
  }
}

function constantTimeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function releaseJson(value: unknown, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo consultar el último release.";
}
