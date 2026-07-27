import { handleAuthRequest, type AuthEnv } from "./auth";

interface Env extends AuthEnv {
  ASSETS: Fetcher;
}

interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
  assets: GitHubAsset[];
}

const GITHUB_RELEASE_API = "https://api.github.com/repos/trklll/aetherio/releases/latest";
const CACHE_SECONDS = 300;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "aetherio-web" }, 200, 60);
    }

    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuthRequest(request, env, url.pathname);
    }

    if (url.pathname === "/api/release") {
      return handleReleaseInfo();
    }

    if (url.pathname.startsWith("/api/update/")) {
      return handleUpdate(url);
    }

    if (url.pathname === "/download/windows") {
      const release = await getLatestRelease();
      const installer = findWindowsInstaller(release.assets);
      if (!installer) return json({ error: "No hay un instalador compatible disponible." }, 404);
      return Response.redirect(installer.browser_download_url, 302);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleReleaseInfo() {
  try {
    const release = await getLatestRelease();
    const installer = findWindowsInstaller(release.assets);
    if (!installer) return json({ error: "No se encontró el instalador de Windows." }, 404);

    return json(
      {
        version: normalizeVersion(release.tag_name),
        name: release.name || `Aetherio ${release.tag_name}`,
        notes: release.body || "",
        publishedAt: release.published_at,
        downloadUrl: installer.browser_download_url,
        size: installer.size,
      },
      200,
      CACHE_SECONDS,
    );
  } catch (error) {
    return json({ error: describeError(error) }, 502, 30);
  }
}

async function handleUpdate(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 5) {
    return json({ error: "Ruta de actualización inválida." }, 400);
  }

  const [, , target, arch, currentVersion] = parts;
  if (target !== "windows" || !["x86_64", "x86-64", "x64"].includes(arch)) {
    return new Response(null, { status: 204 });
  }

  try {
    const release = await getLatestRelease();
    const latestVersion = normalizeVersion(release.tag_name);
    if (compareSemver(latestVersion, currentVersion) <= 0) {
      return new Response(null, { status: 204 });
    }

    const installer = findWindowsInstaller(release.assets);
    if (!installer) return json({ error: "No se encontró el instalador de Windows." }, 404);
    const signatureAsset = release.assets.find(asset => asset.name === `${installer.name}.sig`);
    if (!signatureAsset) return json({ error: "El release no contiene una firma del updater." }, 502);

    const signatureResponse = await fetch(signatureAsset.browser_download_url, {
      headers: { "User-Agent": "Aetherio-Updater" },
    });
    if (!signatureResponse.ok) {
      return json({ error: "No se pudo recuperar la firma del updater." }, 502);
    }
    const signature = (await signatureResponse.text()).trim();
    if (!signature) return json({ error: "La firma del updater está vacía." }, 502);

    return json(
      {
        version: latestVersion,
        notes: release.body || "",
        pub_date: release.published_at,
        url: installer.browser_download_url,
        signature,
      },
      200,
      CACHE_SECONDS,
    );
  } catch (error) {
    return json({ error: describeError(error) }, 502, 30);
  }
}

async function getLatestRelease(): Promise<GitHubRelease> {
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
  if (!response.ok) {
    throw new Error(`GitHub respondió ${response.status}.`);
  }

  const release = await response.json<GitHubRelease>();
  const cacheable = new Response(JSON.stringify(release), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
    },
  });
  await cache.put(cacheKey, cacheable);
  return release;
}

function findWindowsInstaller(assets: GitHubAsset[]) {
  return assets.find(asset => /_x64-setup\.exe$/i.test(asset.name))
    ?? assets.find(asset => /\.exe$/i.test(asset.name) && !/\.sig$/i.test(asset.name));
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

function json(value: unknown, status = 200, maxAge = 0) {
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
