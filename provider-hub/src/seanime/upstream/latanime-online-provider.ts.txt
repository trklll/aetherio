/// <reference path="./core.d.ts" />
/// <reference path="./online-streaming-provider.d.ts" />

const SLUG_SUFFIXES_DUB = ["latino", "castellano", "audio-latino", "audio-castellano"];
const SLUG_SUFFIXES_SUB = ["japones", "audio-japones", "subtitulado"];
const CHALLENGE_MARKERS = [
  "Just a moment...",
  "cf_chl",
  "Enable JavaScript and cookies to continue",
];

const SEASON_SLUG_RULES: {
  pattern: RegExp;
  format: (base: string, season: string) => string;
}[] = [
  { pattern: /^(.*?)-temporada-(\d+)$/, format: (b, s) => `${b}-s${s}` },
  { pattern: /^(.*?)-s(\d+)$/, format: (b, s) => `${b}-temporada-${s}` },
  {
    pattern: /^(.*?)-(?:season-)?(\d+)(?:st|nd|rd|th)?-season$/,
    format: (b, s) => `${b}-s${s}`,
  },
  { pattern: /^(.*?)-season-(\d+)$/, format: (b, s) => `${b}-s${s}` },
  { pattern: /^(.*?)-(\d+)(?:st|nd|rd|th)$/, format: (b, s) => `${b}-s${s}` },
];

const SLUG_STRIP_SUFFIXES = ["-tv", "-the-animation"];
const CATALOG_TOKEN_STOP = new Set([
  "season", "temporada", "the", "and", "of", "de", "la", "el", "latino", "castellano",
]);

const BUSCAR_CONCURRENCY = 4;
const SLUG_PROBE_BATCH = 6;
const SLUG_PROBE_MAX = 64;
const SEARCH_STOP_SCORE = 100;

const SERVER_URL_RULES: { needles: string[]; name: string }[] = [
  { needles: ["filemoon"], name: "filemoon" },
  { needles: ["ok.ru"], name: "ok" },
  { needles: ["mixdrop"], name: "mixdrop" },
  { needles: ["mxdrop"], name: "mxdrop" },
  { needles: ["dood", "d0000d", "d-s.io"], name: "doodstream" },
  { needles: ["yourupload"], name: "yourupload" },
  { needles: ["wolf"], name: "wolf" },
  { needles: ["mp4upload"], name: "mp4upload" },
  { needles: ["mega.nz"], name: "mega" },
  { needles: ["uqload"], name: "uqload" },
  { needles: ["lulustream", "lulu"], name: "lulu" },
  { needles: ["listeamed"], name: "listeamed" },
  { needles: ["hlswish"], name: "hlswish" },
  { needles: ["embedv"], name: "embedv" },
  { needles: ["streamwish"], name: "streamwish" },
  { needles: ["videobin"], name: "videobin" },
  { needles: ["voe.sx", "voe."], name: "voe" },
  { needles: ["dsvplay", "dsplay"], name: "dsvplay" },
  { needles: ["bysekoze", "byse.sx"], name: "byse" },
  { needles: ["hexload"], name: "hexload" },
  { needles: ["savefiles"], name: "savefiles" },
];

const SERVER_LABEL_ALIASES: Record<string, string> = {
  lulustream: "lulu",
  "d-s": "doodstream",
  mxdrop: "mixdrop",
};

const VOE_BAIT_HOSTS = /test-videos\.co\.uk|bigbuckbunny/i;

const UQLOAD_MIRROR_HOSTS = ["uqload.is", "uqload.com", "uqload.io"];

const OK_RU_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";

const OK_RU_QUALITY: Record<string, number> = {
  full: 1080, "1080": 1080, hd: 720, "720": 720, sd: 480, "480": 480,
  "360": 360, low: 360, lowest: 240, mobile: 144,
};

const SERVER_ALIASES: Record<string, string[]> = {
  mxdrop: ["mixdrop"],
  mixdrop: ["mxdrop"],
  doodstream: ["d-s"],
  "d-s": ["doodstream"],
  lulu: ["lulustream"],
  lulustream: ["lulu"],
};

const PREFERRED_SERVERS = [
  "mp4upload", "mxdrop", "mixdrop", "uqload", "voe", "lulu", "lulustream",
  "filemoon", "d-s", "doodstream", "ok",
];

const EPISODE_SERVER_NAMES = [...new Set([
  ...PREFERRED_SERVERS,
  ...Object.keys(SERVER_ALIASES),
])];
const EPISODE_SERVER_SET = new Set(EPISODE_SERVER_NAMES);

const EPISODE_PLAYER_CACHE_PREFIX = "latanime:episodePlayers:";
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;

type CachedEpisodeServer = {
  result: EpisodeServer;
  expiresAt: number;
};

const episodePlayerCache = new Map<string, Record<string, string>>();
const streamCache = new Map<string, CachedEpisodeServer>();

const DIRECT_STREAM_RULES: { pattern: RegExp; type: VideoSourceType }[] = [
  { pattern: /\.(m3u8)(?:$|\?)/i, type: "m3u8" },
  { pattern: /\.(mp4)(?:$|\?)/i, type: "mp4" },
];

type SearchIntent = {
  opts: SearchOptions;
  titles: string[];
  primarySlugs: string[];
  season: number;
  targetYear?: number;
  wantsMovie: boolean;
  wantsSpecial: boolean;
};

type SearchCandidate = SearchResult & {
  source: "buscar" | "slug";
  query?: string;
  year?: number;
  score?: number;
};

type ParsedSearchResult = SearchResult & {
  year?: number;
};

type CandidateMatch = {
  candidateBase: string;
  exactSlug: boolean;
  generatedAudio: boolean;
  exactTitleQuery: boolean;
  exactSlugHit: boolean;
  sharedTokens: number;
  titleScore: number;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripAudioSuffix(id: string): string {
  return id.replace(/-(?:audio-)?(?:latino|castellano|japones|subtitulado)$/i, "");
}

function normalizeAudioText(...parts: (string | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function detectSubOrDub(sources: {
  title?: string;
  id?: string;
  badge?: string;
  spanLabel?: string;
}): SubOrDub {
  const text = normalizeAudioText(
    sources.title,
    sources.id,
    sources.badge,
    sources.spanLabel,
  );
  if (!text) return "sub";

  const hasLatino =
    /\blatino\b/.test(text) || /(?:^|-)latino(?:-|$)/.test(text) || /audio-latino/.test(text);
  const hasCastellano =
    /\bcastellano\b/.test(text) ||
    /(?:^|-)castellano(?:-|$)/.test(text) ||
    /audio-castellano/.test(text);
  const hasDub = hasLatino || hasCastellano;
  const hasSub =
    /\bjapones\b/.test(text) ||
    /\bsubtitulado\b/.test(text) ||
    /(?:^|-)japones(?:-|$)/.test(text) ||
    /\baudio\s+japones\b/.test(text);

  if (hasDub && hasSub) return "both";
  if (hasDub) return "dub";
  if (hasSub) return "sub";
  if (
    /\b(anime|pelicula|ona|cartoon)\b/.test(text) &&
    !hasLatino &&
    !hasCastellano
  ) {
    return "sub";
  }
  return "sub";
}

function dubVariantRank(result: SearchResult): number {
  const text = normalizeAudioText(result.title, result.id);
  if (/\blatino\b/.test(text) || /(?:^|-)latino(?:-|$)/.test(text)) return 30;
  if (/\bcastellano\b/.test(text) || /(?:^|-)castellano(?:-|$)/.test(text)) return 20;
  if (/\bjapones\b/.test(text) || /(?:^|-)japones(?:-|$)/.test(text)) return 8;
  if (/\bsubtitulado\b/.test(text)) return 6;
  if (result.subOrDub === "sub") return 4;
  if (result.subOrDub === "dub" || result.subOrDub === "both") return 10;
  return 0;
}

function compareSearchCandidates(
  a: SearchCandidate,
  b: SearchCandidate,
  intent?: SearchIntent,
): number {
  if (intent) {
    const aBare = isBareSubListing(a, intent);
    const bBare = isBareSubListing(b, intent);
    if (aBare !== bBare) return aBare ? 1 : -1;
  }
  const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  return dubVariantRank(b) - dubVariantRank(a);
}

function finalizeSearchResults(
  ranked: SearchCandidate[],
  intent: SearchIntent,
): SearchResult[] {
  const winner = ranked[0];
  if (!winner) return [];
  const media = intent.opts.media;
  const title = media?.englishTitle?.trim() ||
    media?.romajiTitle?.trim() ||
    intent.opts.query?.trim() ||
    intent.titles[0] ||
    winner.title;
  return [{ id: winner.id, title, url: winner.url, subOrDub: winner.subOrDub }];
}

function mediaTitles(opts: SearchOptions): string[] {
  return [opts.query, opts.media?.romajiTitle ?? "", opts.media?.englishTitle ?? ""].filter(
    Boolean,
  );
}

function extractSeasonNumber(title: string): number {
  if (typeof $scannerUtils !== "undefined") {
    return $scannerUtils.extractSeasonNumber(title);
  }
  const wordSeasons: [RegExp, number][] = [
    [/\bsecond\s+season\b/i, 2],
    [/\bthird\s+season\b/i, 3],
    [/\bfourth\s+season\b/i, 4],
    [/\bfifth\s+season\b/i, 5],
  ];
  for (const [pattern, n] of wordSeasons) {
    if (pattern.test(title)) return n;
  }
  const patterns = [
    /\bseason\s*(\d+)\b/i,
    /\bS(\d{1,2})\b/,
    /\bs(\d{1,2})\b/i,
    /\b(\d+)(?:st|nd|rd|th)\s+season\b/i,
    /\btemporada\s*(\d+)\b/i,
    /\b(\d+)\s* temporada\b/i,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return parseInt(match[1], 10);
  }
  const trailing = title.match(/\s(\d{1,2})$/);
  if (trailing) {
    const n = parseInt(trailing[1], 10);
    if (n >= 1 && n <= 30) return n;
  }
  if (/\blove\s+is\s+war\s*\?+\s*$/i.test(title)) return 2;
  return -1;
}

function stripSeasonFromTitle(title: string): string {
  return title
    .replace(/\b(?:season|temporada)\s*\d+(?:\s*part\s*\d+)?\b/gi, "")
    .replace(/\b\d+(?:st|nd|rd|th)\s+season(?:\s*part\s*\d+)?\b/gi, "")
    .replace(/\bpart\s+\d+\b/gi, "")
    .replace(/\s+\d{1,2}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactShowName(title: string): string {
  const base = title.split(/[:(]/)[0]?.trim() ?? title.trim();
  const stripped = stripSeasonFromTitle(base);
  return stripped || base || title.trim();
}

function extractYearFromText(value: string): number | undefined {
  const matches = value.match(/\b(19\d{2}|20\d{2}|2100)\b/g);
  if (!matches?.length) return undefined;
  const year = parseInt(matches[matches.length - 1], 10);
  return year >= 1900 && year <= 2100 ? year : undefined;
}

function resolveIntentYear(opts: SearchOptions): number | undefined {
  const direct = opts.year ?? opts.media?.startDate?.year;
  if (direct && direct >= 1900 && direct <= 2100) return direct;
  for (const title of mediaTitles(opts)) {
    const parsed = extractYearFromText(title);
    if (parsed) return parsed;
  }
  return undefined;
}

function candidateYear(candidate: SearchCandidate): number | undefined {
  return candidate.year ?? extractYearFromText(`${candidate.title} ${candidate.id}`);
}

function isStrongYearMismatch(
  candidate: SearchCandidate,
  targetYear?: number,
): boolean {
  if (!targetYear) return false;
  const year = candidateYear(candidate);
  if (!year) return false;
  return Math.abs(year - targetYear) >= 8;
}

function yearMatchScore(
  candidate: SearchCandidate,
  targetYear?: number,
): number {
  if (!targetYear) return 0;
  const year = candidateYear(candidate);
  if (!year) return 0;
  const delta = Math.abs(year - targetYear);
  if (delta === 0) return 28;
  if (delta === 1) return 16;
  if (delta === 2) return 8;
  if (delta >= 10) return -36;
  if (delta >= 6) return -20;
  return -8;
}

function titleBaseForSlug(title: string): string {
  return title
    .replace(/\s*-\s*the\s+maxim\s*-?\s*/gi, " ")
    .replace(/\b(?:audio\s+)?(?:latino|castellano|japones|japonés|subtitulado)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSeason(opts: SearchOptions): number {
  let season = -1;
  const offset = opts.media?.absoluteSeasonOffset;
  if (offset != null && offset > 0) season = offset;
  for (const title of mediaTitles(opts)) {
    const found = extractSeasonNumber(title);
    if (found > season) season = found;
  }
  return season;
}

function primarySlugKeys(opts: SearchOptions): string[] {
  const keys = new Set<string>();
  for (const title of mediaTitles(opts)) {
    for (const source of [title, titleBaseForSlug(title), compactShowName(title)]) {
      const slug = slugify(source);
      if (slug) keys.add(slug);
    }
  }
  return [...keys];
}

function slugHasSeasonMarker(slug: string): boolean {
  return /-temporada-\d+|-s\d+(?:-|$)|-season-\d+|-\d{1,2}$/.test(slug);
}

function idSeasonNumber(id: string): number {
  const temporada = id.match(/-temporada-(\d+)(?:-|$)/);
  if (temporada) return parseInt(temporada[1], 10);
  const sSuffix = id.match(/-s(\d+)(?:-|$)/);
  if (sSuffix) return parseInt(sSuffix[1], 10);
  const seasonTag = id.match(/-season-(\d+)(?:-|$)/);
  if (seasonTag) return parseInt(seasonTag[1], 10);
  const entry = id.match(/-(\d{1,2})$/);
  if (entry) return parseInt(entry[1], 10);
  return -1;
}

function slugMatchesTargetSeason(id: string, season: number): boolean {
  if (season <= 1) return true;
  if (idSeasonNumber(id) === season) return true;
  if (id.includes(`-temporada-${season}`)) return true;
  if (id.includes(`-season-${season}`)) return true;
  const combined = id.match(/(?:^|-)s(\d+)-y-s?(\d+)(?:-|$)/);
  if (combined) {
    const a = parseInt(combined[1], 10);
    const b = parseInt(combined[2], 10);
    if (season >= Math.min(a, b) && season <= Math.max(a, b)) return true;
  }
  return new RegExp(`-s${season}(?:-|$)`).test(id);
}

function seasonMatchScore(id: string, season: number): number {
  const idSeason = idSeasonNumber(id);
  if (season > 1) {
    if (slugMatchesTargetSeason(id, season)) return 60;
    if (idSeason > 0) return -40;
    if (slugHasSeasonMarker(id)) return -25;
    return -12;
  }
  if (season === 1) {
    if (idSeason === 1) return 15;
    if (idSeason > 1) return -10;
    return 0;
  }
  if (idSeason > 0) return -8;
  if (slugHasSeasonMarker(id)) return -4;
  return 0;
}

function addSeasonSlugVariants(variants: Set<string>, slug: string, season: number): void {
  if (season <= 1) return;
  variants.add(`${slug}-temporada-${season}`);
  variants.add(`${slug}-s${season}`);
  variants.add(`${slug}-season-${season}`);
}

function slugVariants(value: string, season = -1): string[] {
  const variants = new Set<string>();
  const slug = slugify(value);
  if (!slug) return [];

  variants.add(slug);
  variants.add(`${slug}-audio`);
  variants.add(slug.replace(/-/g, ""));
  variants.add(slug.replace(/(\d)-(\d+)/g, "$1$2"));
  variants.add(slug.replace(/(\d)-([a-z])/g, "$1$2"));
  variants.add(slug.replace(/([a-z])-(\d)/g, "$1$2"));
  variants.add(slug.replace(/^(\d+)([a-z]+)$/, "$1-$2"));
  for (const dotted of value.matchAll(/\b(\d+)\.(\d+)\b/g)) {
    const compact = `${dotted[1]}${dotted[2]}`;
    variants.add(slugify(value.replace(`${dotted[1]}.${dotted[2]}`, compact)));
    variants.add(slug.replace(`${dotted[1]}-${dotted[2]}`, compact));
    variants.add(slug.replace(`${dotted[1]}.${dotted[2]}`, compact));
  }

  for (const rule of SEASON_SLUG_RULES) {
    const match = slug.match(rule.pattern);
    if (match) variants.add(rule.format(match[1], match[2]));
  }
  for (const suffix of SLUG_STRIP_SUFFIXES) {
    if (slug.endsWith(suffix)) variants.add(slug.slice(0, -suffix.length));
  }
  if (season > 1) {
    for (const base of [...variants]) {
      addSeasonSlugVariants(variants, base, season);
      variants.add(`${base}-${season}`);
    }
  }
  return [...variants].filter(Boolean);
}

function prioritizeSlugProbes(ids: string[], season: number): string[] {
  if (season <= 1) return ids;
  const score = (id: string): number => {
    let s = 0;
    if (new RegExp(`-s${season}(?:-|$)`).test(id)) s += 20;
    if (id.includes(`-temporada-${season}`)) s += 18;
    if (id.includes(`-season-${season}`)) s += 16;
    if (!/-s\d+(?:-|$)|-temporada-\d|-season-\d/.test(id)) s += 12;
    if (id.includes("-latino")) s += 5;
    if (id.includes("-castellano")) s += 3;
    return s;
  };
  return [...ids].sort((a, b) => score(b) - score(a));
}

function buildSearchIntent(opts: SearchOptions): SearchIntent {
  const format = opts.media?.format ?? "";
  return {
    opts,
    titles: uniqueStrings(mediaTitles(opts)),
    primarySlugs: primarySlugKeys(opts),
    season: detectSeason(opts),
    targetYear: resolveIntentYear(opts),
    wantsMovie: format === "MOVIE" || format === "MUSIC",
    wantsSpecial: ["OVA", "SPECIAL", "TV_SPECIAL"].includes(format),
  };
}

function buildSearchQueries(intent: SearchIntent): string[] {
  const queries: string[] = [];
  const add = (value: string) => {
    if (value.trim()) queries.push(value.trim());
  };
  for (const title of intent.titles) {
    add(title);
    add(titleBaseForSlug(title));
    add(compactShowName(title));
    const beforeColon = title.split(":")[0]?.trim() ?? "";
    const afterColon = title.split(":")[1]?.trim() ?? "";
    if (beforeColon.length >= 3) add(beforeColon);
    if (afterColon.length >= 3) add(afterColon);
    if (intent.season > 1) {
      const compact = compactShowName(title);
      add(`${compact} S${intent.season}`);
      add(`${compact} s${intent.season}`);
      add(`${compact} temporada ${intent.season}`);
      add(`${compact} Season ${intent.season}`);
    }
  }
  return uniqueStrings(queries).slice(0, 10);
}

function appendSlugProbe(ordered: string[], seen: Set<string>, slug: string): void {
  if (!slug || seen.has(slug)) return;
  seen.add(slug);
  ordered.push(slug);
}

function appendDubProbes(
  ordered: string[],
  seen: Set<string>,
  slug: string,
  wantsDub: boolean,
): void {
  appendSlugProbe(ordered, seen, slug);
  if (!wantsDub) return;
  for (const suffix of SLUG_SUFFIXES_DUB) appendSlugProbe(ordered, seen, `${slug}-${suffix}`);
}

function buildSlugProbes(intent: SearchIntent): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const wantsDub = intent.opts.dub;

  for (const primary of intent.primarySlugs) {
    appendDubProbes(ordered, seen, primary, wantsDub);
    if (intent.season > 1) {
      appendDubProbes(ordered, seen, `${primary}-s${intent.season}`, wantsDub);
      appendDubProbes(ordered, seen, `${primary}-temporada-${intent.season}`, wantsDub);
      appendDubProbes(ordered, seen, `${primary}-season-${intent.season}`, wantsDub);
    }
  }

  const candidates = new Set<string>();
  const add = (slug: string) => {
    if (slug) candidates.add(slug);
  };

  for (const title of intent.titles) {
    const sources = [
      title,
      titleBaseForSlug(title),
      compactShowName(title),
      title.split(":")[0]?.trim() ?? "",
      title.split(":")[1]?.trim() ?? "",
      title.split(/\s+-\s+/)[0]?.trim() ?? "",
    ];
    for (const source of sources) {
      if (!source || source.length < 2) continue;
      for (const slug of slugVariants(source, intent.season)) add(slug);
    }
    if (intent.targetYear) {
      const withYear = `${compactShowName(title)} ${intent.targetYear}`.trim();
      for (const slug of slugVariants(withYear, intent.season)) add(slug);
    }
  }

  const formatSuffixes = intent.wantsMovie
    ? ["movie", "pelicula", "gekijouban"]
    : intent.wantsSpecial
    ? ["ova", "special", "especial", "regards"]
    : [];
  for (const slug of [...candidates]) {
    for (const suffix of formatSuffixes) {
      if (slug.includes(`-${suffix}`) || slug.endsWith(suffix)) continue;
      add(`${slug}-${suffix}`);
      add(`${suffix}-${slug}`);
    }
  }

  for (const slug of prioritizeSlugProbes([...candidates], intent.season)) {
    if (ordered.length >= SLUG_PROBE_MAX) break;
    appendDubProbes(ordered, seen, slug, wantsDub);
  }

  if (ordered.length < SLUG_PROBE_MAX) {
    for (const slug of candidates) {
      if (ordered.length >= SLUG_PROBE_MAX) break;
      for (const suffix of SLUG_SUFFIXES_SUB) {
        appendSlugProbe(ordered, seen, `${slug}-${suffix}`);
      }
    }
  }

  return ordered.slice(0, SLUG_PROBE_MAX);
}

function catalogTokens(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const part of slugify(text).split("-")) {
      if (part.length >= 4 && !CATALOG_TOKEN_STOP.has(part)) out.add(part);
    }
  }
  return [...out];
}

function titleMatchScore(result: SearchResult, opts: SearchOptions): number {
  const targets = [
    opts.media?.englishTitle ?? "",
    opts.media?.romajiTitle ?? "",
    opts.query,
  ].filter(Boolean);

  let best = 0;
  for (const target of targets) {
    if (typeof $scannerUtils !== "undefined") {
      best = Math.max(
        best,
        Math.round($scannerUtils.compareTitles(target, result.title) * 40),
      );
      continue;
    }
    const slug = slugify(compactShowName(target));
    if (!slug) continue;
    if (result.id === slug) best = Math.max(best, 35);
    else if (stripAudioSuffix(result.id) === slug) best = Math.max(best, 32);
    else if (result.id.startsWith(`${slug}-`)) best = Math.max(best, 18);
    else if (result.id.includes(slug)) best = Math.max(best, 16);
  }
  return best;
}

function candidateHasFormatSignal(
  candidate: SearchCandidate,
  format: "movie" | "special",
): boolean {
  const text = slugify(`${candidate.id} ${candidate.title}`);
  if (format === "movie") {
    return /(?:^|-)(movie|pelicula|gekijouban)(?:-|$)/.test(text);
  }
  return /(?:^|-)(ova|special|especial|regards)(?:-|$)/.test(text);
}

function buildCandidateMatch(
  candidate: SearchCandidate,
  intent: SearchIntent,
  slugProbes: string[],
): CandidateMatch {
  const candidateBase = stripAudioSuffix(candidate.id);
  const targetTokens = catalogTokens(...intent.titles);
  const candidateTokens = new Set(catalogTokens(candidate.id, candidate.title));
  return {
    candidateBase,
    exactSlug: slugProbes.some((slug) => candidate.id === slug),
    generatedAudio: slugProbes.some((slug) => candidateBase === slug),
    exactTitleQuery: !!candidate.query &&
      intent.titles.some((t) => t.toLowerCase() === candidate.query!.toLowerCase()),
    exactSlugHit: candidate.source === "slug" ||
      slugProbes.some((slug) => candidate.id === slug || candidateBase === slug),
    sharedTokens: targetTokens.filter((t) => candidateTokens.has(t)).length,
    titleScore: titleMatchScore(candidate, intent.opts),
  };
}

function hasExplicitDubAudio(candidate: SearchResult): boolean {
  return dubVariantRank(candidate) >= 20;
}

function isBareSubListing(candidate: SearchCandidate, intent: SearchIntent): boolean {
  if (candidate.subOrDub !== "sub" || hasExplicitDubAudio(candidate)) return false;
  const base = stripAudioSuffix(candidate.id);
  const matchesFranchiseSlug = intent.titles.some((title) => {
    for (const source of [title, titleBaseForSlug(title), compactShowName(title)]) {
      const slug = slugify(source);
      if (!slug) continue;
      if (candidate.id === slug || base === slug || candidate.id.startsWith(`${slug}-`)) {
        return true;
      }
    }
    return false;
  });
  const onPrimary = intent.primarySlugs.some((slug) =>
    candidate.id === slug || base === slug
  );
  return onPrimary || matchesFranchiseSlug;
}

function isSeasonlessPrimaryFranchise(
  candidate: SearchCandidate,
  intent: SearchIntent,
): boolean {
  if (intent.season <= 1) return false;
  const base = stripAudioSuffix(candidate.id);
  return intent.primarySlugs.some((slug) =>
    (candidate.id === slug || base === slug) &&
    !slugHasSeasonMarker(candidate.id) &&
    idSeasonNumber(candidate.id) <= 0
  );
}

function mergeCandidates(candidates: SearchCandidate[]): SearchCandidate[] {
  const byId = new Map<string, SearchCandidate>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      continue;
    }
    if (candidate.source === "slug") existing.source = "slug";
    existing.query ??= candidate.query;
    if (dubVariantRank(candidate) > dubVariantRank(existing)) {
      existing.title = candidate.title;
      existing.subOrDub = candidate.subOrDub;
      existing.url = candidate.url;
    }
  }
  return [...byId.values()];
}

function isSafeCandidate(
  candidate: SearchCandidate,
  intent: SearchIntent,
  slugProbes: string[],
): boolean {
  const m = buildCandidateMatch(candidate, intent, slugProbes);
  const targetTokens = catalogTokens(...intent.titles);

  if (
    intent.season > 1 &&
    slugHasSeasonMarker(candidate.id) &&
    !slugMatchesTargetSeason(candidate.id, intent.season)
  ) {
    return false;
  }
  if (intent.season <= 1 && idSeasonNumber(candidate.id) > 1 && !m.exactSlugHit) {
    return false;
  }
  if (isSeasonlessPrimaryFranchise(candidate, intent)) {
    return false;
  }
  if (
    isStrongYearMismatch(candidate, intent.targetYear) &&
    !m.exactSlugHit &&
    !m.exactTitleQuery
  ) {
    return false;
  }
  if (
    targetTokens.length <= 1 &&
    !m.exactSlugHit &&
    !m.exactTitleQuery &&
    m.sharedTokens === 0 &&
    m.titleScore < 30
  ) {
    return false;
  }
  if (!m.exactSlugHit && !m.exactTitleQuery && m.sharedTokens === 0 && m.titleScore < 28) {
    return false;
  }
  if (
    intent.wantsMovie &&
    !candidateHasFormatSignal(candidate, "movie") &&
    !m.exactSlugHit &&
    !m.exactTitleQuery &&
    m.sharedTokens < 2
  ) {
    return false;
  }
  if (
    intent.wantsSpecial &&
    !candidateHasFormatSignal(candidate, "special") &&
    !m.exactSlugHit &&
    !m.exactTitleQuery &&
    m.sharedTokens < 2
  ) {
    return false;
  }
  return true;
}

function rankCandidate(
  candidate: SearchCandidate,
  intent: SearchIntent,
  slugProbes: string[],
): SearchCandidate {
  const m = buildCandidateMatch(candidate, intent, slugProbes);
  let score = 0;

  if (m.exactSlug) {
    score += dubVariantRank(candidate) > 0 ? 60 : 28;
  } else if (m.generatedAudio || candidate.source === "slug") {
    score += 45;
  }
  if (m.exactTitleQuery) score += 30;

  const primarySlugMatch = intent.primarySlugs.includes(candidate.id) ||
    intent.primarySlugs.includes(m.candidateBase);
  const barePrimarySub = isBareSubListing(candidate, intent);
  const primarySeasonSafe = intent.season <= 1 ||
    (slugHasSeasonMarker(candidate.id) &&
      slugMatchesTargetSeason(candidate.id, intent.season));
  if (primarySlugMatch && primarySeasonSafe) score += barePrimarySub ? 12 : 45;

  score += yearMatchScore(candidate, intent.targetYear);
  score += seasonMatchScore(candidate.id, intent.season);
  score += Math.min(36, m.sharedTokens * 12);
  score += m.titleScore;
  if (intent.wantsMovie && candidateHasFormatSignal(candidate, "movie")) score += 12;
  if (intent.wantsSpecial && candidateHasFormatSignal(candidate, "special")) score += 12;
  if (candidate.source === "slug") score += 8;
  score += dubVariantRank(candidate);
  if (barePrimarySub) score -= 25;
  for (const title of intent.titles) {
    const dotted = title.match(/\b(\d+)\.(\d+)\b/);
    if (!dotted) continue;
    const compact = `${dotted[1]}${dotted[2]}`;
    if (candidate.id.includes(compact)) score += 35;
  }

  candidate.score = score;
  return candidate;
}

function shouldStopFetching(
  candidates: SearchCandidate[],
  intent: SearchIntent,
  slugProbes: string[],
): boolean {
  for (const raw of mergeCandidates(candidates)) {
    if (!isSafeCandidate(raw, intent, slugProbes)) continue;
    const ranked = rankCandidate({ ...raw }, intent, slugProbes);
    if ((ranked.score ?? 0) >= SEARCH_STOP_SCORE && hasExplicitDubAudio(ranked)) {
      return true;
    }
  }
  return false;
}

// deno-lint-ignore no-unused-vars
class Provider {
  baseUrl = "https://latanime.org";

  getSettings(): Settings {
    return {
      episodeServers: EPISODE_SERVER_NAMES,
      supportsDub: false, // audio picked in search(), not opts.dub
    };
  }

  async search(opts: SearchOptions): Promise<SearchResult[]> {
    const intent = buildSearchIntent({ ...opts, dub: true });
    const queries = buildSearchQueries(intent);
    const slugProbes = buildSlugProbes(intent);
    const ranked = mergeCandidates(
      await this._fetchSearchCandidates(intent, queries, slugProbes),
    )
      .filter((c) => isSafeCandidate(c, intent, slugProbes))
      .map((c) => rankCandidate(c, intent, slugProbes))
      .sort((a, b) => compareSearchCandidates(a, b, intent));
    return finalizeSearchResults(ranked, intent);
  }

  async findEpisodes(id: string): Promise<EpisodeDetails[]> {
    const animeId = this._animeIdFromUrl(id);
    const html = await this._fetchText(`${this.baseUrl}/anime/${animeId}`);
    if (!html) return [];

    const episodes: EpisodeDetails[] = [];
    const seen = new Set<number>();
    const pattern =
      /<a\b[^>]+href=["']([^"']*\/ver\/([^"']*?)-episodio-(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const number = parseInt(match[3], 10);
      if (!number || seen.has(number)) continue;
      const url = this._absoluteUrl(decodeHtml(match[1]));
      seen.add(number);
      episodes.push({
        id: url.replace(this.baseUrl, "").replace(/^\/+/, ""),
        number,
        url,
        title: stripTags(match[4]) || `Episodio ${number}`,
      });
    }

    if (episodes.length === 0) {
      const countMatch = html.match(/Episodios:\s*<\/[^>]+>\s*(\d+)/i);
      const total = countMatch ? parseInt(countMatch[1], 10) : 0;
      for (let i = 1; i <= total; i++) {
        const episodeUrl = `${this.baseUrl}/ver/${animeId}-episodio-${i}`;
        episodes.push({
          id: `ver/${animeId}-episodio-${i}`,
          number: i,
          url: episodeUrl,
          title: `Episodio ${i}`,
        });
      }
    }
    return episodes.sort((a, b) => a.number - b.number);
  }

  async findEpisodeServer(
    episode: EpisodeDetails,
    server: string,
  ): Promise<EpisodeServer> {
    const requested = server.trim().toLowerCase();
    const empty: EpisodeServer = {
      server: requested || server,
      headers: {},
      videoSources: [],
    };
    if (!episode?.url || !this._isValidHttpUrl(episode.url)) return empty;

    const cached = this._readStreamCache(episode.url, requested);
    if (cached) return cached;

    try {
      const manifest = await this._episodeManifest(episode.url);
      const candidates = this._candidateServers(manifest, requested);
      if (candidates.length === 0) return empty;

      for (const name of candidates) {
        const pick = await this._probeServer(name, manifest, episode.url);
        if (!pick) continue;

        const result: EpisodeServer = {
          server: pick.server,
          headers: this._playbackHeaders(episode, pick.playerUrl),
          videoSources: [pick.source],
        };
        this._writeStreamCache(episode.url, requested, result);
        if (requested === "default" || !requested) {
          this._writeStreamCache(episode.url, pick.server, result);
        }
        return result;
      }
      return empty;
    } catch {
      return empty;
    }
  }

  private _headers(referer = this.baseUrl): { [key: string]: string } {
    return {
      Referer: referer,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    };
  }

  private _okRuHeaders(referer: string): { [key: string]: string } {
    return { Referer: referer, "User-Agent": OK_RU_UA };
  }

  private _absoluteUrl(url: string): string {
    if (url.startsWith("//")) return "https:" + url;
    if (url.startsWith("/")) return this.baseUrl + url;
    return url;
  }

  private _animeIdFromUrl(url: string): string {
    return this._absoluteUrl(url)
      .replace(this.baseUrl, "")
      .replace(/^\/anime\//, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  }

  private async _fetchText(url: string, referer = this.baseUrl): Promise<string> {
    if (!this._isValidHttpUrl(url)) return "";
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: this._headers(referer),
      });
      if (!res.ok) return "";
      const html = await res.text();
      return CHALLENGE_MARKERS.some((m) => html.includes(m)) ? "" : html;
    } catch {
      return "";
    }
  }

  private async _runPool<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    if (items.length === 0) return;
    let next = 0;
    const workers = Math.min(concurrency, items.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (next < items.length) await fn(items[next++]!);
      }),
    );
  }

  private _parseSearchCardBadge(inner: string): string {
    return stripTags(inner.replace(/<h3[\s\S]*?<\/h3>/gi, "")).trim();
  }

  private _parseSeriesDetailsLabel(html: string): string {
    const idx = html.search(/\bseriedetails\b/i);
    if (idx < 0) return "";
    const spans = [...html.slice(idx, idx + 2500).matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)];
    return spans.map((m) => stripTags(m[1])).filter((s) => s && s.length < 80).join(" ");
  }

  private _parseTitle(html: string): string {
    const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const h3 =
      html.match(/<h3[^>]*class=["'][^"']*\bfs-6\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i) ??
      html.match(/<h3[^>]*class=["'][^"']*text-light[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i);
    const h2Text = h2 ? stripTags(h2[1]) : "";
    const h3Text = h3 ? stripTags(h3[1]) : "";
    if (h2Text && h3Text) return `${h2Text} / ${h3Text}`;
    if (h2Text) return h2Text;

    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) return stripTags(h1[1]);
    const og = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    );
    if (og) return decodeHtml(og[1]).replace(/\s*—\s*Latanime.*$/i, "").trim();
    return "";
  }

  private _parseSearchResults(html: string): ParsedSearchResult[] {
    const results: ParsedSearchResult[] = [];
    const seen = new Set<string>();
    const pattern =
      /<a\b[^>]+href=["']([^"']*\/anime\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const href = this._absoluteUrl(decodeHtml(match[1]));
      const id = this._animeIdFromUrl(href);
      const inner = match[2];
      const h3 = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      let title = h3 ? stripTags(h3[1]) : stripTags(inner);
      if (!id || seen.has(id) || !title || title.toLowerCase() === "image") continue;

      const badge = this._parseSearchCardBadge(inner);
      const year = extractYearFromText(`${title} ${badge} ${id}`);
      title = title.replace(/\s+0\.0$/, "").trim();
      seen.add(id);
      results.push({
        id,
        title,
        url: href,
        subOrDub: detectSubOrDub({ title, id, badge }),
        year,
      });
    }
    return results;
  }

  private async _fetchSearchCandidates(
    intent: SearchIntent,
    queries: string[],
    slugs: string[],
  ): Promise<SearchCandidate[]> {
    const out: SearchCandidate[] = [];
    const seen = new Set<string>();

    await this._runPool(queries, BUSCAR_CONCURRENCY, async (query) => {
      const html = await this._fetchText(
        `${this.baseUrl}/buscar?q=${encodeURIComponent(query)}`,
      );
      for (const result of this._parseSearchResults(html)) {
        if (seen.has(result.id)) continue;
        seen.add(result.id);
        out.push({ ...result, source: "buscar", query });
      }
    });

    if (shouldStopFetching(out, intent, slugs)) return out;

    for (let i = 0; i < slugs.length; i += SLUG_PROBE_BATCH) {
      await Promise.all(
        slugs.slice(i, i + SLUG_PROBE_BATCH).map(async (id) => {
          const html = await this._fetchText(`${this.baseUrl}/anime/${id}`);
          if (!html || !html.includes("/ver/") || seen.has(id)) return;
          const title = this._parseTitle(html) || id.replace(/-/g, " ");
          const spanLabel = this._parseSeriesDetailsLabel(html);
          seen.add(id);
          out.push({
            id,
            title,
            url: `${this.baseUrl}/anime/${id}`,
            year: extractYearFromText(`${title} ${id} ${spanLabel}`),
            subOrDub: detectSubOrDub({
              title,
              id,
              spanLabel,
            }),
            source: "slug",
          });
        }),
      );
      if (shouldStopFetching(out, intent, slugs)) break;
    }
    return out;
  }

  private _serverName(url: string): string {
    const lower = url.toLowerCase();
    for (const rule of SERVER_URL_RULES) {
      if (rule.needles.some((n) => lower.includes(n))) return rule.name;
    }
    return "default";
  }

  private _canonicalServerName(label: string): string {
    const key = label.trim().toLowerCase().replace(/\s+/g, "");
    return SERVER_LABEL_ALIASES[key] ?? key;
  }

  private _lookupPlayerUrl(
    playerMap: Record<string, string>,
    server: string,
  ): string | undefined {
    for (const name of [server, ...(SERVER_ALIASES[server] ?? [])]) {
      const url = playerMap[name];
      if (url) return url;
    }
    return undefined;
  }

  private _isValidHttpUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  private _fixObfuscatedStreamUrl(url: string): string {
    const fixed = url.replace(/\\/g, "").replace(/^j:/i, "https:");
    return this._normalizePlayerUrl(fixed);
  }

  private _origin(url: string): string {
    const match = url.match(/^(https?:\/\/[^/]+)/);
    return match ? match[1] : this.baseUrl;
  }

  private _decodeBase64(value: string): string {
    const input = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/[^A-Za-z0-9+/=]/g, "");
    if (!input) return "";
    try {
      const decoded = atob(input);
      if (decoded) return decoded;
    } catch {
    }
    if (typeof CryptoJS === "undefined") return "";
    try {
      return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(input));
    } catch {
      return "";
    }
  }

  private _normalizePlayerUrl(value: string): string {
    let url = decodeHtml(value).replace(/\\\//g, "/").replace(/%3A/gi, ":")
      .replace(/%2F/gi, "/").trim();
    if (!/^https?:\/\//.test(url)) {
      const decoded = this._decodeBase64(url);
      if (/^https?:\/\//.test(decoded)) url = decoded;
    }
    return this._absoluteUrl(url);
  }

  private _extractPlayerUrls(html: string): Record<string, string> {
    const map: Record<string, string> = {};
    const add = (rawUrl: string, server?: string) => {
      const url = this._normalizePlayerUrl(rawUrl);
      if (!this._isValidHttpUrl(url)) return;
      const label = server?.trim().toLowerCase();
      const canonical = label
        ? this._canonicalServerName(label)
        : this._serverName(url);
      const keys = new Set([canonical, label, this._serverName(url)].filter(Boolean) as string[]);
      for (const key of keys) {
        if (key !== "default" && !(key in map)) map[key] = url;
      }
    };

    for (const match of html.matchAll(
      /<a\b[^>]*class=["'][^"']*\bplay-video\b[^"']*["'][^>]*data-player=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      add(match[1], stripTags(match[2]));
    }
    for (const match of html.matchAll(/(?:aHR0cHM6|aHR0cDov)[A-Za-z0-9+/=_-]+/g)) {
      add(match[0]);
    }
    return map;
  }

  private async _episodeManifest(episodeUrl: string): Promise<Record<string, string>> {
    const cacheKey = EPISODE_PLAYER_CACHE_PREFIX + episodeUrl;
    if (typeof $store !== "undefined" && $store.has(cacheKey)) {
      const stored = $store.get<Record<string, string>>(cacheKey);
      if (stored && Object.keys(stored).length > 0) return stored;
    }
    const cached = episodePlayerCache.get(episodeUrl);
    if (cached && Object.keys(cached).length > 0) return cached;

    const html = await this._fetchText(episodeUrl);
    const map = html ? this._extractPlayerUrls(html) : {};
    if (Object.keys(map).length > 0) {
      episodePlayerCache.set(episodeUrl, map);
      if (typeof $store !== "undefined") {
        $store.set(cacheKey, map);
      }
    }
    return map;
  }

  private _streamCacheKey(episodeUrl: string, server: string): string {
    return `${episodeUrl}|${server || "default"}`;
  }

  private _readStreamCache(episodeUrl: string, server: string): EpisodeServer | null {
    const key = this._streamCacheKey(episodeUrl, server);
    const mem = streamCache.get(key);
    if (!mem) return null;
    if (mem.expiresAt > Date.now()) return mem.result;
    streamCache.delete(key);
    return null;
  }

  private _writeStreamCache(
    episodeUrl: string,
    server: string,
    result: EpisodeServer,
  ): void {
    if (result.videoSources.length === 0) return;
    const key = this._streamCacheKey(episodeUrl, server);
    streamCache.set(key, {
      result,
      expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
    });
  }

  private _candidateServers(
    playerMap: Record<string, string>,
    requested: string,
  ): string[] {
    const server = requested.trim().toLowerCase();
    if (server && server !== "default") {
      return [...new Set([server, ...(SERVER_ALIASES[server] ?? [])])].filter(
        (name) => this._lookupPlayerUrl(playerMap, name),
      );
    }
    const onPage = Object.keys(playerMap).filter(
      (k) => k !== "default" && EPISODE_SERVER_SET.has(k),
    );
    return [...new Set([...PREFERRED_SERVERS, ...onPage])].filter(
      (name) => this._lookupPlayerUrl(playerMap, name),
    );
  }

  private async _probeServer(
    server: string,
    playerMap: Record<string, string>,
    referer: string,
  ): Promise<{ server: string; playerUrl: string; source: VideoSource } | null> {
    const playerUrl = this._lookupPlayerUrl(playerMap, server);
    if (!playerUrl || !this._isValidHttpUrl(playerUrl)) return null;
    try {
      const source = await this._resolveStream(playerUrl, referer);
      if (!source?.url || !this._isValidHttpUrl(source.url)) return null;
      if (source.type !== "mp4" && source.type !== "m3u8") return null;
      return { server, playerUrl, source };
    } catch {
      return null;
    }
  }

  private _unpackCompactPackerScript(script: string): string | null {
    if (!script.includes("while(c--)if(k[c])")) return null;
    const open = script.indexOf("return p}('");
    if (open < 0) return null;
    const splitMark = script.indexOf(".split('|')", open);
    if (splitMark < 0) return null;
    const inner = script.slice(open + 11, splitMark);
    const meta = inner.match(/,(\d{1,3}),(\d{1,3}),'/);
    if (!meta || meta.index === undefined) return null;
    let p = inner.slice(0, meta.index);
    const radix = parseInt(meta[1], 10);
    let count = parseInt(meta[2], 10);
    const words = inner.slice(meta.index + meta[0].length).replace(/'+$/, "").split("|");
    while (count--) {
      if (words[count]) {
        p = p.replace(new RegExp(`\\b${count.toString(radix)}\\b`, "g"), words[count]);
      }
    }
    return p;
  }

  private _unpackPacker(source: string): string[] {
    const unpacked: string[] = [];
    const pushUnpacked = (raw: string) => {
      const text = raw.replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (text && !unpacked.includes(text)) unpacked.push(text);
    };

    for (const script of source.match(/<script[^>]*>[\s\S]*?<\/script>/gi) ?? []) {
      const compact = this._unpackCompactPackerScript(script);
      if (compact) pushUnpacked(compact);
    }

    const scripts = [
      ...(source.match(/eval\(function\(p,a,c,k,e,[\s\S]+?\)\)/g) ?? []),
      ...(source.match(
        /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('[\s\S]*?'\.split\('\|'\),0,\{\}\)\)/g,
      ) ?? []),
    ];
    for (const script of scripts) {
      const payload = script.match(
        /\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/,
      );
      if (!payload) continue;
      let p = payload[1];
      const radix = parseInt(payload[2], 10);
      let count = parseInt(payload[3], 10);
      const words = payload[4].split("|");
      const encode = (num: number): string =>
        num.toString(radix).replace(/\w/g, (c) => {
          const code = c.charCodeAt(0);
          return code >= 97 ? String.fromCharCode(code + 29) : c;
        });
      while (count--) {
        if (words[count]) {
          p = p.replace(new RegExp(`\\b${encode(count)}\\b`, "g"), words[count]);
        }
      }
      pushUnpacked(p);
    }
    return unpacked;
  }

  private _isDirectStreamUrl(url: string): boolean {
    return DIRECT_STREAM_RULES.some((rule) => rule.pattern.test(url));
  }

  private _playbackHeaders(
    episode: EpisodeDetails,
    embedUrl: string,
  ): { [key: string]: string } {
    const referer = embedUrl && !this._isDirectStreamUrl(embedUrl) ? embedUrl : episode.url;
    const origin = embedUrl && !this._isDirectStreamUrl(embedUrl)
      ? this._origin(embedUrl)
      : this.baseUrl;
    return { ...this._headers(referer), Origin: origin };
  }

  private _isVoeBaitUrl(url: string): boolean {
    return VOE_BAIT_HOSTS.test(url);
  }

  private _sourceFromStreamUrl(url: string): VideoSource | null {
    const fixed = this._fixObfuscatedStreamUrl(url);
    if (!this._isValidHttpUrl(fixed) || this._isVoeBaitUrl(fixed)) return null;
    const type: VideoSourceType = /\.m3u8/i.test(fixed) ? "m3u8" : "mp4";
    return { url: fixed, type, quality: "default", subtitles: [] };
  }

  private _deobfuscateVoeJson(raw: string): unknown {
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr) || typeof arr[0] !== "string") return null;
      const rot13 = (text: string): string =>
        text.replace(/[a-zA-Z]/g, (c) => {
          const base = c <= "Z" ? 65 : 97;
          return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
      const stripMarkers = (text: string): string => {
        let out = text;
        for (const marker of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) {
          out = out.split(marker).join("");
        }
        return out;
      };
      const shiftChars = (text: string, shift: number): string =>
        [...text].map((c) => String.fromCharCode(c.charCodeAt(0) - shift)).join("");
      const b64 = (value: string): string => {
        const pad = value.length % 4 ? "=".repeat(4 - (value.length % 4)) : "";
        return atob(value + pad);
      };

      let step = rot13(arr[0]);
      step = stripMarkers(step);
      step = b64(step);
      step = shiftChars(step, 3);
      step = step.split("").reverse().join("");
      step = b64(step);
      try {
        return JSON.parse(step);
      } catch {
        return step;
      }
    } catch {
      return null;
    }
  }

  private _extractVoeStream(html: string): VideoSource | null {
    const varSource = html.match(/var\s+source\s*=\s*['"]([^'"]+)['"]/i)?.[1];
    if (varSource) {
      const fromVar = this._sourceFromStreamUrl(varSource);
      if (fromVar) return fromVar;
    }

    const jsonScript = html.match(
      /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
    )?.[1]?.trim();
    if (jsonScript) {
      const decoded = this._deobfuscateVoeJson(jsonScript);
      if (decoded && typeof decoded === "object") {
        const record = decoded as Record<string, unknown>;
        for (const key of ["direct_access_url", "source", "hls"]) {
          const value = record[key];
          if (typeof value === "string") {
            const fromJson = this._sourceFromStreamUrl(value);
            if (fromJson) return fromJson;
          }
        }
      }
      if (typeof decoded === "string") {
        const m3u8 = decoded.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i)?.[0];
        if (m3u8) {
          const fromHls = this._sourceFromStreamUrl(m3u8);
          if (fromHls) return fromHls;
        }
        const mp4 = decoded.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/i)?.[0];
        if (mp4) {
          const fromMp4 = this._sourceFromStreamUrl(mp4);
          if (fromMp4) return fromMp4;
        }
      }
    }

    const hlsField = html.match(/"hls"\s*:\s*"([^"]+)"/i)?.[1];
    if (hlsField) {
      const fromField = this._sourceFromStreamUrl(hlsField);
      if (fromField) return fromField;
    }

    return null;
  }

  private _isUqloadEmbedUrl(url: string): boolean {
    return /uqload/i.test(url);
  }

  private _isOkRuEmbedUrl(url: string): boolean {
    return /ok\.ru/i.test(url);
  }

  private _unescapeHtmlEntities(text: string): string {
    return text
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  private _parseOkRuMetadata(raw: unknown): {
    hlsManifestUrl?: string;
    hlsMasterPlaylistUrl?: string;
    videos?: { name: string; url: string }[];
  } | null {
    if (!raw) return null;
    let data: unknown = raw;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }
    if (typeof data !== "object" || data === null) return null;
    return data as {
      hlsManifestUrl?: string;
      hlsMasterPlaylistUrl?: string;
      videos?: { name: string; url: string }[];
    };
  }

  private _sourceFromOkRuMetadata(meta: {
    hlsManifestUrl?: string;
    hlsMasterPlaylistUrl?: string;
    videos?: { name: string; url: string }[];
  }): VideoSource | null {
    for (const url of [meta.hlsMasterPlaylistUrl, meta.hlsManifestUrl]) {
      if (url && this._isValidHttpUrl(url)) {
        return { url, type: "m3u8", quality: "default", subtitles: [] };
      }
    }
    const videos = meta.videos?.filter((v) => v.url && this._isValidHttpUrl(v.url));
    if (!videos?.length) return null;

    let best = videos[0]!;
    let bestWeight = OK_RU_QUALITY[best.name] ?? 0;
    for (const video of videos) {
      const weight = OK_RU_QUALITY[video.name] ?? 0;
      if (weight >= bestWeight) {
        best = video;
        bestWeight = weight;
      }
    }
    return { url: best.url, type: "mp4", quality: best.name || "default", subtitles: [] };
  }

  private async _loadOkRuMetadata(
    embedUrl: string,
    html: string,
  ): Promise<{
    hlsManifestUrl?: string;
    hlsMasterPlaylistUrl?: string;
    videos?: { name: string; url: string }[];
  } | null> {
    const match = html.match(/data-options=["']([^"']+)["']/i);
    if (!match) return null;

    let options: { flashvars?: { metadata?: unknown; metadataUrl?: string } };
    try {
      options = JSON.parse(this._unescapeHtmlEntities(match[1]));
    } catch {
      return null;
    }

    const flashvars = options.flashvars;
    if (!flashvars) return null;

    const meta = this._parseOkRuMetadata(flashvars.metadata);
    if (meta) return meta;

    const metadataUrl = flashvars.metadataUrl
      ?.replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");
    if (!metadataUrl || !this._isValidHttpUrl(metadataUrl)) return null;

    try {
      const res = await fetch(metadataUrl, {
        method: "POST",
        headers: this._okRuHeaders(embedUrl),
      });
      if (!res.ok) return null;
      const body = await res.text();
      return this._parseOkRuMetadata(body);
    } catch {
      return null;
    }
  }

  private async _resolveOkRuStream(
    playerUrl: string,
    referer: string,
  ): Promise<VideoSource | null> {
    if (!this._isOkRuEmbedUrl(playerUrl)) return null;
    const embedUrl = playerUrl.replace(/^http:\/\//i, "https://");
    try {
      const res = await fetch(embedUrl, {
        headers: this._okRuHeaders(referer),
      });
      if (!res.ok) return null;
      const html = await res.text();
      if (CHALLENGE_MARKERS.some((m) => html.includes(m))) return null;

      const meta = await this._loadOkRuMetadata(embedUrl, html);
      if (!meta) return null;
      return this._sourceFromOkRuMetadata(meta);
    } catch {
      return null;
    }
  }

  private _uqloadMirrorUrls(playerUrl: string): string[] {
    const urls = [playerUrl];
    if (!this._isUqloadEmbedUrl(playerUrl)) return urls;
    try {
      const parsed = new URL(playerUrl);
      const path = `${parsed.pathname}${parsed.search}`;
      for (const host of UQLOAD_MIRROR_HOSTS) {
        if (parsed.hostname.toLowerCase() !== host) {
          urls.push(`${parsed.protocol}//${host}${path}`);
        }
      }
    } catch {
      return urls;
    }
    return [...new Set(urls)];
  }

  private _isDoodEmbedUrl(url: string): boolean {
    return /dood(?:stream)?|d0000d|ds2play|playmogo|d-s\.io/i.test(url);
  }

  private _isFilemoonEmbedUrl(url: string): boolean {
    return /filemoon|bysekoze|byse\.sx/i.test(url);
  }

  private _filemoonVideoCode(url: string): string | null {
    const match = url.match(/\/(?:e|d)\/([^/?#]+)/i);
    const code = match?.[1]?.replace(/\/+$/, "");
    return code || null;
  }

  private _base64UrlDecode(input: string): Uint8Array {
    let padded = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (padded.length % 4)) % 4;
    if (pad) padded += "=".repeat(pad);
    const bin = atob(padded);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  private _combineKeyParts(keyParts: string[]): Uint8Array {
    const chunks = keyParts.map((part) => this._base64UrlDecode(part));
    const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
    const key = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      key.set(chunk, offset);
      offset += chunk.length;
    }
    return key;
  }

  private _toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy.buffer;
  }

  private async _decryptFilemoonPlayback(
    playback: { key_parts: string[]; iv: string; payload: string },
  ): Promise<{ sources?: { mime_type?: string; url?: string }[] } | null> {
    try {
      const keyBytes = this._combineKeyParts(playback.key_parts);
      const key = await crypto.subtle.importKey(
        "raw",
        this._toArrayBuffer(keyBytes),
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      );
      const iv = this._base64UrlDecode(playback.iv);
      const payload = this._base64UrlDecode(playback.payload);
      const tag = payload.slice(-16);
      const ciphertext = payload.slice(0, -16);
      const combined = new Uint8Array(ciphertext.length + tag.length);
      combined.set(ciphertext);
      combined.set(tag, ciphertext.length);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: this._toArrayBuffer(iv) },
        key,
        this._toArrayBuffer(combined),
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      return null;
    }
  }

  private async _resolveFilemoonStream(
    playerUrl: string,
    _referer: string,
  ): Promise<VideoSource | null> {
    if (!this._isFilemoonEmbedUrl(playerUrl)) return null;
    const code = this._filemoonVideoCode(playerUrl);
    if (!code) return null;

    try {
      const embedUrl = this._absoluteUrl(playerUrl);
      const origin = this._origin(embedUrl);
      const apiUrl = `${origin}/api/videos/${code}`;
      const res = await fetch(apiUrl, {
        headers: { ...this._headers(embedUrl), Referer: embedUrl },
      });
      if (!res.ok) return null;

      const data = await res.json() as {
        playback?: { key_parts?: string[]; iv?: string; payload?: string };
        error?: string;
      };
      const playback = data.playback;
      if (!playback?.key_parts?.length || !playback.iv || !playback.payload) return null;

      const decrypted = await this._decryptFilemoonPlayback({
        key_parts: playback.key_parts,
        iv: playback.iv,
        payload: playback.payload,
      });
      if (!decrypted?.sources?.length) return null;

      for (const source of decrypted.sources) {
        const url = source.url?.trim();
        if (!url || !this._isValidHttpUrl(url)) continue;
        if (source.mime_type === "application/vnd.apple.mpegurl" || /\.m3u8/i.test(url)) {
          return { url, type: "m3u8", quality: "default", subtitles: [] };
        }
        if (/\.mp4/i.test(url)) {
          return { url, type: "mp4", quality: "default", subtitles: [] };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private _doodRandomSuffix(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return [...bytes].map((b) => chars[b % chars.length]).join("");
  }

  private async _resolveDoodStream(
    playerUrl: string,
    referer: string,
  ): Promise<VideoSource | null> {
    if (!this._isDoodEmbedUrl(playerUrl)) return null;
    try {
      const res = await fetch(playerUrl, {
        credentials: "include",
        redirect: "follow",
        headers: this._headers(referer),
      });
      if (!res.ok) return null;
      const html = await res.text();
      if (CHALLENGE_MARKERS.some((m) => html.includes(m))) return null;

      const passPath = html.match(/(\/pass_md5\/[^'"]+)/)?.[1];
      if (!passPath) return null;

      const expiry = passPath.match(/-(\d{10})-/)?.[1];
      const token = html.match(/[?&]token=([a-zA-Z0-9%._-]+)/)?.[1]
        ?? passPath.split("/").pop();
      if (!expiry || !token) return null;

      const embedUrl = res.url;
      const passUrl = new URL(passPath, new URL(embedUrl).origin).href;
      const passRes = await fetch(passUrl, {
        headers: { ...this._headers(embedUrl), Referer: embedUrl },
      });
      if (!passRes.ok) return null;

      const base = (await passRes.text()).trim();
      if (!base.startsWith("http")) return null;

      const streamUrl = `${base}${this._doodRandomSuffix()}?token=${token}&expiry=${expiry}`;
      if (!this._isValidHttpUrl(streamUrl)) return null;
      return { url: streamUrl, type: "mp4", quality: "default", subtitles: [] };
    } catch {
      return null;
    }
  }

  private _voeMirrorUrl(playerUrl: string, html: string): string {
    if (!/voe\.sx/i.test(playerUrl)) return playerUrl;
    const redirect = html.match(
      /window\.location\.href\s*=\s*['"]([^'"]+)['"]/i,
    )?.[1];
    if (!redirect) return playerUrl;
    const absolute = this._normalizePlayerUrl(redirect);
    return this._isValidHttpUrl(absolute) ? absolute : playerUrl;
  }

  private _extractStreamFromHtml(html: string): VideoSource | null {
    for (const candidate of [html, ...this._unpackPacker(html)]) {
      const hls = candidate.match(
        /["'`]((?:https?:|j:)?\\?\/\\?\/[^"'`\s<>?#]+\.m3u8(?:\?[^"'`\s<>]*)?)["'`]/i,
      ) ?? candidate.match(/(https?:\/\/[^"'`\s<>?#]+\.m3u8(?:\?[^"'`\s<>]*)?)/i);
      if (hls) {
        const url = this._fixObfuscatedStreamUrl(hls[1]);
        if (this._isValidHttpUrl(url)) {
          return { url, type: "m3u8", quality: "default", subtitles: [] };
        }
      }
      const mp4 = candidate.match(
        /(?:src|file|source)\s*:\s*["']((https?:\/\/[^"']+\.mp4[^"']*))["']/i,
      ) ?? candidate.match(
        /["'`]((?:https?:|j:)?\\?\/\\?\/[^"'`\s<>?#]+\.mp4(?:\?[^"'`\s<>]*)?)["'`]/i,
      ) ?? candidate.match(/(https?:\/\/[^"'`\s<>?#]+\.mp4(?:\?[^"'`\s<>]*)?)/i);
      if (mp4) {
        const url = this._fixObfuscatedStreamUrl(mp4[1]);
        if (this._isValidHttpUrl(url)) {
          return { url, type: "mp4", quality: "default", subtitles: [] };
        }
      }
    }
    return null;
  }

  private async _tryDedicatedResolvers(
    playerUrl: string,
    referer: string,
  ): Promise<VideoSource | null> {
    const resolvers: {
      test: (url: string) => boolean;
      resolve: (url: string, ref: string) => Promise<VideoSource | null>;
    }[] = [
      { test: (u) => this._isDoodEmbedUrl(u), resolve: (u, r) => this._resolveDoodStream(u, r) },
      { test: (u) => this._isFilemoonEmbedUrl(u), resolve: (u, r) => this._resolveFilemoonStream(u, r) },
      { test: (u) => this._isOkRuEmbedUrl(u), resolve: (u, r) => this._resolveOkRuStream(u, r) },
    ];
    for (const { test, resolve } of resolvers) {
      if (!test(playerUrl)) continue;
      const source = await resolve(playerUrl, referer);
      if (source) return source;
    }
    return null;
  }

  private async _resolveStream(
    playerUrl: string,
    referer: string,
    depth = 0,
  ): Promise<VideoSource | null> {
    if (!this._isValidHttpUrl(playerUrl)) return null;

    for (const rule of DIRECT_STREAM_RULES) {
      if (rule.pattern.test(playerUrl)) {
        return { url: playerUrl, type: rule.type, quality: "default", subtitles: [] };
      }
    }

    const dedicated = await this._tryDedicatedResolvers(playerUrl, referer);
    if (dedicated) return dedicated;

    let embedUrl = playerUrl;
    let html = "";
    for (const candidate of this._uqloadMirrorUrls(playerUrl)) {
      html = await this._fetchText(candidate, referer);
      if (html) {
        embedUrl = candidate;
        break;
      }
    }
    if (!html) return null;

    embedUrl = this._voeMirrorUrl(embedUrl, html);
    if (embedUrl !== playerUrl) {
      html = await this._fetchText(embedUrl, embedUrl);
      if (!html) return null;
    }

    if (/voe\.sx/i.test(playerUrl) || html.includes('type="application/json"')) {
      const voe = this._extractVoeStream(html);
      if (voe) return voe;
    }

    const direct = this._extractStreamFromHtml(html);
    if (direct) return direct;

    if (depth < 2) {
      for (const match of html.matchAll(
        /<iframe\b[^>]+src=["']([^"']+)["'][^>]*>/gi,
      )) {
        const iframeUrl = this._normalizePlayerUrl(match[1]);
        if (!this._isValidHttpUrl(iframeUrl)) continue;
        if (/NONE|javascript:|about:/i.test(iframeUrl)) continue;
        const nested = await this._resolveStream(iframeUrl, embedUrl, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }
}
