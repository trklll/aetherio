/** Small, invocation-local subset of Seanime's helper API, matching the existing
 * desktop MediaExtension runtime. Third-party extension signatures are dynamic. */
export function createCompatibility(cheerio: any, CryptoJS: any) {
  function wrap($: any, selection: any): any {
    const value: any = { __selection: selection };
    const length: any = (): number => selection.length;
    length.valueOf = () => selection.length;
    length.toString = () => String(selection.length);
    length[Symbol.toPrimitive] = (): number => selection.length;
    value.length = length;
    value.html = () => selection.html();
    value.text = () => selection.text();
    value.attr = (name: string) => selection.attr(name);
    value.attrs = () => selection.get(0)?.attribs ?? {};
    value.data = (name: string) => name == null ? selection.data() : selection.attr("data-" + name);
    for (const method of ["find", "children", "parent", "parents", "closest", "first", "last", "eq", "contents", "filter", "not", "has", "next", "nextAll", "prev", "prevAll", "siblings", "end", "parentsUntil", "nextUntil", "prevUntil"]) {
      value[method] = (...args: any[]) => wrap($, selection[method](...args));
    }
    value.is = (selector: string) => selection.is(selector);
    value.each = (callback: any) => { selection.each((index: number, element: any) => callback(index, wrap($, $(element)))); return value; };
    value.map = (callback: any) => selection.map((index: number, element: any) => callback(index, wrap($, $(element)))).get();
    return value;
  }
  function LoadDoc(html: string) {
    const $ = cheerio.load(String(html ?? ""));
    return (selector: any) => wrap($, selector?.__selection ?? $(String(selector ?? "")));
  }
  const clean = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[()[\]{}|"'~*?\\^!]/g, " ").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const season = (value: unknown) => Number(String(value).match(/(?:\bseason\s*|\bs)(\d{1,2})(?=\b|e\d)/i)?.[1] ?? String(value).match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i)?.[1] ?? -1);
  const part = (value: unknown) => Number(String(value).match(/\b(?:part|cour)\s*(\d{1,2})\b/i)?.[1] ?? -1);
  const base = (value: unknown) => clean(value).replace(/\b(?:s\d{1,2}e\d{1,4}|season\s*\d+|s\d{1,2}|\d+(?:st|nd|rd|th)\s+season|(?:part|cour)\s*\d+)\b/gi, " ")
    .replace(/\b(?:1080p|720p|480p|2160p|bluray|blu-ray|webrip|web-dl|hdtv|x264|x265|hevc|aac|flac)\b/gi, " ").replace(/\s+/g, " ").trim();
  const compareTitles = (left: unknown, right: unknown) => {
    const a = new Set(base(left).toLowerCase().split(/\s+/).filter(Boolean));
    const b = new Set(base(right).toLowerCase().split(/\s+/).filter(Boolean));
    return a.size && b.size ? 2 * [...a].filter(word => b.has(word)).length / (a.size + b.size) : 0;
  };
  const scanner: any = {
    normalizeTitle(value: unknown) {
      const original = String(value ?? "");
      const cleanBaseTitle = base(original);
      return { original, normalized: clean(original).toLowerCase(), cleanBaseTitle, denoisedTitle: cleanBaseTitle,
        tokens: cleanBaseTitle.toLowerCase().split(/\s+/).filter(Boolean), season: season(original), part: part(original),
        year: Number(original.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? -1), isMain: true };
    },
    extractSeasonNumber: season, extractPartNumber: part,
    extractYear: (value: unknown) => Number(String(value).match(/\b(?:19|20)\d{2}\b/)?.[0] ?? -1),
    compareTitles, getSignificantTokens: (value: unknown) => base(value).toLowerCase().split(/\s+/).filter(Boolean),
    buildSearchQuery: base, sanitizeQuery: clean,
    findBestMatch: (target: unknown, candidates: string[]) => candidates.slice().sort((a, b) => compareTitles(target, b) - compareTitles(target, a))[0] ?? "",
    buildAdvancedQuery: (titles: string[]) => "(" + [...new Set(titles.map(base).filter(Boolean))].join(" | ") + ")",
    buildSeasonQuery: (title: string, n: number) => n <= 1 ? base(title) : `(${base(title)} S${String(n).padStart(2, "0")} | ${base(title)} S${n} | ${base(title)} Season ${n})`,
    buildPartQuery: (title: string, n: number) => n <= 1 ? base(title) : `(${base(title)} Part ${n} | ${base(title)} Cour ${n})`,
    buildSmartSearchTitles: (titles: string[]) => ({ titles: [...new Set(titles.map(base).filter(Boolean))], season: titles.map(season).find(n => n > 0) ?? -1, part: titles.map(part).find(n => n > 0) ?? -1 }),
  };
  const habari = {
    parse(value: unknown) {
      const name = String(value ?? "");
      const ep = name.match(/\bS\d{1,2}E(\d{1,4}(?:\.\d+)?)\b/i)?.[1] ?? name.match(/(?:\s-\s|\bEP?\s*)(\d{1,4}(?:\.\d+)?)\b/i)?.[1];
      const title = base(name.replace(/^\s*\[[^\]]+\]\s*/, "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\bS\d{1,2}E\d{1,4}\b|\s-\s\d{1,4}\b/ig, " "));
      return { title, formatted_title: title, file_name: name, file_extension: name.match(/\.([a-z0-9]{2,5})$/i)?.[1],
        release_group: name.match(/^\s*\[([^\]]+)\]/)?.[1], video_resolution: name.match(/\b(2160p|1080p|720p|576p|480p|360p)\b/i)?.[1],
        episode_number: ep ? [ep] : [], season_number: season(name) > 0 ? [String(season(name))] : [], part_number: part(name) > 0 ? [String(part(name))] : [],
        audio_term: /dual[ ._-]*audio|multi[ ._-]*audio/i.test(name) ? ["Dual Audio"] : [], language: [], subtitles: [] };
    },
  };
  function torrentMagnet(data: string): string {
    // Hash the original bencoded `info` bytes, never JSON re-encoding.
    let position = 0;
    let start = -1;
    let end = -1;
    function parse(depth: number): string | undefined {
      if (depth > 64 || position >= data.length) throw new Error("Torrent bencode inválido");
      const kind = data[position];
      if (/\d/.test(kind)) {
        const colon = data.indexOf(":", position);
        if (colon < 0 || colon - position > 9) throw new Error("Torrent bencode inválido");
        const length = Number(data.slice(position, colon));
        position = colon + 1;
        const value = data.slice(position, position + length);
        position += length;
        if (position > data.length) throw new Error("Torrent bencode incompleto");
        return value;
      }
      position++;
      if (kind === "i") {
        const next = data.indexOf("e", position);
        if (next < 0) throw new Error("Torrent bencode inválido");
        position = next + 1;
      } else if (kind === "l" || kind === "d") {
        while (data[position] !== "e") {
          const key = kind === "d" ? parse(depth + 1) : undefined;
          const before = position;
          parse(depth + 1);
          if (depth === 0 && key === "info") { start = before; end = position; }
        }
        position++;
      } else throw new Error("Torrent bencode inválido");
      return undefined;
    }
    parse(0);
    if (start < 0 || end <= start) return "";
    return "magnet:?xt=urn:btih:" + CryptoJS.SHA1(CryptoJS.enc.Latin1.parse(data.slice(start, end))).toString();
  }
  return { LoadDoc, load: LoadDoc, Doc: function(html: string) { return LoadDoc(html)("html"); }, $scannerUtils: scanner, $habari: habari,
    $torrentUtils: { getMagnetLinkFromTorrentData: torrentMagnet } };
}
