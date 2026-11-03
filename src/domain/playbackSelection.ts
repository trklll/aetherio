export type SubtitleMode = "auto" | "off" | "language";

export interface SemanticPlaybackTrackPreference {
  language: string;
  title: string;
  forced: boolean;
  sdh: boolean;
  subtitleMode?: SubtitleMode;
}

export interface PlaybackTrackCandidate {
  value: string;
  language?: string | null;
  title?: string | null;
  label?: string | null;
  forced?: boolean;
  sdh?: boolean;
  isDefault?: boolean;
  isOriginal?: boolean;
  /** Optional technical description, excluded from semantic title identity. */
  technical?: string | null;
}

export type PlaybackTrackDescription = Omit<PlaybackTrackCandidate, "value"> & { value?: string };

export interface PlaybackTrackResolution<T extends PlaybackTrackCandidate = PlaybackTrackCandidate> {
  source: "manual" | "episode" | "delivery" | "global" | "default" | "none";
  candidate: T | null;
  mode: SubtitleMode;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  es: "spa", esp: "spa", spa: "spa", spanish: "spa", español: "spa", espanol: "spa", castellano: "spa",
  en: "eng", eng: "eng", english: "eng", inglés: "eng", ingles: "eng",
  ja: "jpn", jp: "jpn", jpn: "jpn", japanese: "jpn", japonés: "jpn", japones: "jpn",
  ko: "kor", kor: "kor", korean: "kor", coreano: "kor",
  pt: "por", por: "por", portuguese: "por", portugués: "por", portugues: "por",
  fr: "fra", fre: "fra", fra: "fra", french: "fra", francés: "fra", frances: "fra",
  de: "deu", ger: "deu", deu: "deu", german: "deu", alemán: "deu", aleman: "deu",
  it: "ita", ita: "ita", italian: "ita", italiano: "ita",
  zh: "zho", chi: "zho", zho: "zho", chinese: "zho", chino: "zho",
  ru: "rus", rus: "rus", russian: "rus", ruso: "rus",
  und: "",
};

const LANGUAGE_NAME_PATTERNS = Object.entries(LANGUAGE_ALIASES)
  .filter(([alias]) => alias.length > 2)
  .sort(([left], [right]) => right.length - left.length);

const FORCED_PATTERN = /\bforced\b|\bforzados?\b|\bforc[eé]\b/i;
const SDH_PATTERN = /\b(?:sdh|hi|cc|closed captions?|hearing[\s-]*impaired|hard[\s-]*of[\s-]*hearing|subt[ií]tulos? para sordos)\b/i;

export function normalizePlaybackLanguage(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = normalizeText(value).replace(/_/g, "-").trim();
  if (!text || text === "original") return text;
  const firstPart = text.split(/[-\s]/, 1)[0];
  return LANGUAGE_ALIASES[text] ?? LANGUAGE_ALIASES[firstPart] ?? text;
}

export function normalizePlaybackTrackTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(?:[a-z]:\\|\\\\|\/)[^\s]+/gi, " ")
    .replace(FORCED_PATTERN, " ")
    .replace(SDH_PATTERN, " ")
    .replace(/\b(?:subtitles?|subt[ií]tulos?)\b/gi, " ");
  return normalizeText(cleaned)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function createPlaybackTrackPreference(
  candidate: PlaybackTrackDescription | null | undefined,
  subtitleMode: SubtitleMode = "language",
): SemanticPlaybackTrackPreference | null {
  if (!candidate || typeof candidate !== "object") return null;
  const sourceText = `${candidate.title ?? ""} ${candidate.label ?? ""}`;
  const language = normalizePlaybackLanguage(candidate.language) || languageFromText(sourceText);
  const title = normalizePlaybackTrackTitle(candidate.title ?? candidate.label);
  if (!language && !title) return null;
  return {
    language,
    title,
    forced: Boolean(candidate.forced || FORCED_PATTERN.test(sourceText)),
    sdh: Boolean(candidate.sdh || SDH_PATTERN.test(sourceText)),
    ...(subtitleMode !== "language" ? { subtitleMode } : {}),
  };
}

export function normalizeSemanticPlaybackTrackPreference(
  value: unknown,
  kind: "audio" | "subtitle" = "audio",
): SemanticPlaybackTrackPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const subtitleMode = raw.subtitleMode;
  if (kind === "subtitle" && subtitleMode !== undefined
    && subtitleMode !== "auto" && subtitleMode !== "off" && subtitleMode !== "language") return null;
  if (kind === "audio" && subtitleMode !== undefined) return null;
  if (typeof raw.language !== "string" || typeof raw.title !== "string"
    || typeof raw.forced !== "boolean" || typeof raw.sdh !== "boolean"
    || raw.language.length > 64 || raw.title.length > 256) return null;
  const mode = kind === "subtitle" ? (subtitleMode as SubtitleMode | undefined) ?? "language" : undefined;
  if (mode !== "off" && !raw.language.trim() && !raw.title.trim()) return null;
  return {
    language: normalizePlaybackLanguage(raw.language),
    title: normalizePlaybackTrackTitle(raw.title),
    forced: raw.forced,
    sdh: raw.sdh,
    ...(mode !== undefined ? { subtitleMode: mode } : {}),
  };
}

export function matchPlaybackTrackPreference<T extends PlaybackTrackCandidate>(
  preference: SemanticPlaybackTrackPreference,
  candidates: readonly T[],
): T | null {
  if (preference.subtitleMode === "off" || preference.subtitleMode === "auto") return null;
  const expectedLanguage = normalizePlaybackLanguage(preference.language);
  const expectedTitle = normalizePlaybackTrackTitle(preference.title);
  const matchingFlags = candidates.filter(candidate => {
    const candidatePreference = createPlaybackTrackPreference(candidate);
    return candidatePreference
      && candidatePreference.forced === preference.forced
      && candidatePreference.sdh === preference.sdh;
  });
  const exact = matchingFlags.filter(candidate => {
    const candidatePreference = createPlaybackTrackPreference(candidate)!;
    return (!expectedLanguage || candidatePreference.language === expectedLanguage)
      && (!expectedTitle || candidatePreference.title === expectedTitle);
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const byLanguage = matchingFlags.filter(candidate => {
    const candidatePreference = createPlaybackTrackPreference(candidate)!;
    return expectedLanguage && candidatePreference.language === expectedLanguage;
  });
  if (byLanguage.length === 1) return byLanguage[0];

  if (!expectedLanguage && expectedTitle) {
    const byTitle = matchingFlags.filter(candidate => (
      createPlaybackTrackPreference(candidate)?.title === expectedTitle
    ));
    if (byTitle.length === 1) return byTitle[0];
  }
  return null;
}

export function resolvePlaybackTrackSelection<T extends PlaybackTrackCandidate>(input: {
  candidates: readonly T[];
  manual?: SemanticPlaybackTrackPreference | null;
  episode?: SemanticPlaybackTrackPreference | null;
  delivery?: SemanticPlaybackTrackPreference | null;
  globalLanguages?: readonly string[];
  defaultValue?: string;
  kind?: "audio" | "subtitle";
}): PlaybackTrackResolution<T> {
  const kind = input.kind ?? "audio";
  const intents = [
    ["manual", input.manual],
    ["episode", input.episode],
    ["delivery", input.delivery],
  ] as const;

  for (const [source, preference] of intents) {
    if (!preference) continue;
    const mode = kind === "subtitle" ? preference.subtitleMode ?? "language" : "language";
    if (kind === "subtitle" && mode === "off") {
      return { source, candidate: null, mode: "off" };
    }
    if (mode === "auto") continue;
    const candidate = matchPlaybackTrackPreference(preference, input.candidates);
    if (candidate) return { source, candidate, mode: "language" };
  }

  for (const language of input.globalLanguages ?? []) {
    const wanted = normalizePlaybackLanguage(language);
    if (!wanted) continue;
    const matchingCandidates = input.candidates.filter(option => {
      const preference = createPlaybackTrackPreference(option);
      return preference?.language === wanted;
    });
    const preferredCandidate = kind === "subtitle"
      ? matchingCandidates.find(option => !option.forced && !option.sdh) ?? matchingCandidates[0]
      : matchingCandidates[0];
    if (preferredCandidate) return { source: "global", candidate: preferredCandidate, mode: "auto" };
  }

  const defaultCandidate = input.defaultValue
    ? input.candidates.find(candidate => candidate.value === input.defaultValue)
    : input.candidates.find(candidate => candidate.isDefault === true);
  return defaultCandidate
    ? { source: "default", candidate: defaultCandidate, mode: "auto" }
    : { source: "none", candidate: null, mode: "auto" };
}

function languageFromText(value: string): string {
  const normalized = normalizeText(value);
  for (const [alias, language] of LANGUAGE_NAME_PATTERNS) {
    if (new RegExp(`(?:^|[^\\p{L}])${escapeRegExp(alias)}(?:$|[^\\p{L}])`, "u").test(normalized)) return language;
  }
  const code = /(?:^|[^a-z])([a-z]{2,3})(?:$|[^a-z])/i.exec(value)?.[1];
  return normalizePlaybackLanguage(code);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
