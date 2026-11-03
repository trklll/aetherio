import type { LiveSource } from "../types/liveSports.ts";
import { fetchSportsBody, publicSportsHttps } from "./fmhySportsHttp.ts";

function isNativeMedia(bytes: Uint8Array): boolean {
  // The bundled libmpv can demux TS/fMP4, but not a PNG prefix followed by TS.
  for (const [offset, stride] of [[0, 188], [4, 192]]) {
    if (bytes[offset] === 0x47 && bytes[offset + stride] === 0x47 && bytes[offset + stride * 2] === 0x47) return true;
  }
  const box = new TextDecoder().decode(bytes.slice(4, 8));
  return bytes.length >= 8 && ["ftyp", "styp", "moof", "sidx"].includes(box);
}

/** Verify media bytes, not just a 200 response or an upstream "online" badge. */
export async function probeFmhyNativeSource(source: LiveSource): Promise<boolean> {
  let url = publicSportsHttps(source.url);
  if (!url) return false;
  const headers = source.headers ?? {};
  for (let hop = 0; hop < 3; hop++) {
    const bytes = await fetchSportsBody(url.href, headers);
    if (!bytes) return false;
    const playlist = new TextDecoder().decode(bytes).trimStart();
    if (!playlist.startsWith("#EXTM3U") || /#EXT-X-ENDLIST|#EXT-X-SESSION-KEY|skd:\/\/|widevine|#EXT-X-KEY:(?!METHOD=NONE)/i.test(playlist)) return false;
    const uri = playlist.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith("#"));
    if (!uri) return false;
    let next: URL | null;
    try { next = publicSportsHttps(new URL(uri, url).href); } catch { return false; }
    if (!next) return false;
    if (playlist.includes("#EXT-X-STREAM-INF")) { url = next; continue; }
    if (!playlist.includes("#EXTINF")) return false;
    const sample = await fetchSportsBody(next.href, { ...headers, Range: "bytes=0-1023" });
    return sample !== null && isNativeMedia(sample);
  }
  return false;
}
