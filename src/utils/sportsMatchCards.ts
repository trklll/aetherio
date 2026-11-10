import { findTeamIdentity } from "../data/teamIdentity.ts";
import type { CanonicalEvent } from "../data/sports/types.ts";
import type { SportsMatchArtwork, SportsMatchSide } from "../types/sportsMatch.ts";
import { SPORTS_ENTITY_BY_ID, sportsDisciplineLabel } from "../data/sports/catalog.ts";
import { disciplineFromLabels, resolveParticipant } from "../data/sports/identity.ts";
import { basketballCompetitionLogo, resolveInsignia } from "../data/sports/insignia.ts";
import { footyLogosCompetitionUrl } from "../data/sports/footyLogosAssets.ts";

interface MatchParticipantInput {
  name: string;
  entityId?: string;
  crest?: string;
  color?: string;
}

interface SportsMatchArtworkInput {
  title: string;
  sport?: string;
  competitionId?: string;
  competitionName?: string;
  home?: MatchParticipantInput;
  away?: MatchParticipantInput;
}

/** Only spaced separators: Saint-Germain is one team, not two opponents. */
export function splitSportsMatchTitle(title: string): [string, string] | null {
  const clean = title.replace(/^(?:\[(?:live|replay)\]|(?:live|replay|repetici[oó]n)\s*:)\s*/i, "").trim();
  const match = /^(.+?)\s+(?:vs?\.?|[–—-])\s+(.+)$/i.exec(clean);
  return match ? [match[1].trim(), match[2].trim()] : null;
}

function crestUrl(value: string | null | undefined): string | undefined {
  const url = value?.trim();
  if (!url) return undefined;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return undefined;
    if (parsed.protocol === "https:") return parsed.href;
    if (parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) return parsed.href;
  } catch { /* Missing or malformed crests use the participant's initials. */ }
  return undefined;
}

function hexColor(value: string | undefined): string | undefined {
  if (!value || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value)) return undefined;
  const hex = value.slice(1);
  return `#${(hex.length === 3 ? [...hex].map(channel => channel + channel).join("") : hex).toUpperCase()}`;
}

function competitionLogo(competitionId: string | undefined, title: string, competitionName: string | undefined, sport?: string): string | undefined {
  const explicit = competitionId ? footyLogosCompetitionUrl(competitionId) : null;
  if (explicit) return explicit;
  if (sport === "baloncesto") {
    const basketball = basketballCompetitionLogo(competitionName);
    if (basketball) return basketball;
  }

  // Replay catalogs often publish the competition in the display title but
  // omit a canonical competition id. Resolve only this known alias; never guess
  // a badge from a vague or unrelated league label.
  const label = `${competitionName ?? ""} ${title}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(?:europa|uefa)\s+conference\s+league\b/.test(label)) {
    return footyLogosCompetitionUrl("comp:uefa-conference") ?? undefined;
  }
  return undefined;
}

/** Pure composition: reuse verified identities, no API or poster-generation server. */
export function buildSportsMatchArtwork(input: SportsMatchArtworkInput): SportsMatchArtwork {
  const sport = disciplineFromLabels([input.sport]);
  const opponents = splitSportsMatchTitle(input.title);
  const side = (participant: MatchParticipantInput | undefined, inferredName: string | undefined): SportsMatchSide | undefined => {
    const name = participant?.name.trim() || inferredName;
    if (!name) return undefined;
    const resolved = sport ? resolveParticipant(name, sport) : undefined;
    const candidate = SPORTS_ENTITY_BY_ID.get(participant?.entityId ?? resolved?.entityId ?? "");
    const entity = candidate?.sport === sport && ["club", "national-team", "fighter"].includes(candidate.kind) ? candidate : undefined;
    const providerCrest = crestUrl(participant?.crest);
    // Player startup expands the generated matchup to the TV viewport; ask the
    // insignia resolver for its large source so remote fallback crests are not
    // upscaled from thumbnail-sized URLs.
    const insignia = resolveInsignia({ entityId: entity?.id, name, explicitCrest: providerCrest ?? crestUrl(resolved?.crest), size: 512, sport: sport ?? undefined, competitionName: input.competitionName });
    const crest = crestUrl(insignia.src);
    const colorName = entity?.name ?? resolved?.name ?? name;
    const registeredColor = findTeamIdentity(colorName)?.colors.primary ?? hexColor(entity?.color);
    return {
      name,
      crest,
      fallbackCrest: providerCrest && providerCrest !== crest ? providerCrest : undefined,
      color: registeredColor ?? hexColor(participant?.color) ?? "#45494F",
      initials: insignia.initials,
    };
  };
  return {
    home: side(input.home, opponents?.[0]),
    away: side(input.away, opponents?.[1]),
    competitionLogo: competitionLogo(input.competitionId, input.title, input.competitionName, sport ?? undefined),
    label: sport ? sportsDisciplineLabel(sport) : input.sport?.trim() || "Deportes",
  };
}

/** Keep home cards and the player handoff on the same event-art composition. */
export function buildSportsMatchArtworkForEvent(event: CanonicalEvent): SportsMatchArtwork {
  return buildSportsMatchArtwork({
    title: event.title,
    sport: event.sport,
    competitionId: event.competitionId,
    home: event.home ? { ...event.home, crest: event.raw.home?.logo ?? event.home.crest, color: event.raw.home?.color } : undefined,
    away: event.away ? { ...event.away, crest: event.raw.away?.logo ?? event.away.crest, color: event.raw.away?.color } : undefined,
  });
}

export type SampledSportsMatchColors = Partial<Record<"home" | "away", string>>;

/** Apply actual crest samples to the playback handoff, not just card CSS. */
export function withSampledSportsMatchColors(
  match: SportsMatchArtwork | undefined,
  sampled: SampledSportsMatchColors | undefined,
): SportsMatchArtwork | undefined {
  if (!match || !sampled) return match;
  return {
    ...match,
    home: match.home && sampled.home ? { ...match.home, color: sampled.home } : match.home,
    away: match.away && sampled.away ? { ...match.away, color: sampled.away } : match.away,
  };
}
