/** Descargas administrativas: nunca reenvían el token ni credenciales del cliente. */
export class AssetError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AssetError";
  }
}

export function publicHttpsUrl(value: string): URL | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" || url.username || url.password ||
      !host.includes(".") || host.startsWith("[") || /^\d+(?:\.\d+){0,3}$/.test(host) ||
      host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
      (url.port && url.port !== "443")
    ) return null;
    return url;
  } catch { return null; }
}

export async function fetchPublicAsset(value: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }> {
  let url = publicHttpsUrl(value);
  if (!url) throw new AssetError("Usa una URL HTTPS sin credenciales, IP literal ni host local.");
  const signal = AbortSignal.timeout(12_000);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response: Response;
    try { response = await fetch(url.href, { redirect: "manual", signal }); }
    catch { throw new AssetError("No se pudo descargar el recurso remoto.", 502); }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      let next: URL | null = null;
      try { next = location ? publicHttpsUrl(new URL(location, url).href) : null; } catch { /* destino inválido */ }
      if (!next) throw new AssetError("Redirección no permitida: debe usar HTTPS y un host no local.");
      if (redirects === 3) throw new AssetError("Demasiadas redirecciones.", 502);
      url = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AssetError(`El recurso remoto respondió HTTP ${response.status}.`, 502);
    }
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new AssetError("El recurso remoto supera el tamaño permitido.", 413);
    }
    if (!response.body) throw new AssetError("El servidor devolvió un recurso vacío.", 422);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        length += chunk.byteLength;
        if (length > maxBytes) {
          await reader.cancel();
          throw new AssetError("El recurso remoto supera el tamaño permitido.", 413);
        }
        chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    if (!length) throw new AssetError("El servidor devolvió un recurso vacío.", 422);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, contentType };
  }
  throw new AssetError("Demasiadas redirecciones.", 502);
}
