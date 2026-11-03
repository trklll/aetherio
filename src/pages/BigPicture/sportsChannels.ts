import { sportsFallbackArtwork } from "../../data/sports/artwork.ts";
import { sportsDisciplineLabel } from "../../data/sports/catalog.ts";
import { channelMatchesSports, iptvChannelEvent } from "../../services/iptvSports.ts";
import type { LiveChannel, LiveEvent } from "../../types/liveSports.ts";
import type { CatalogRowData, MediaItem } from "../../types/ui.ts";

const SPANISH_SPEAKING_COUNTRIES = new Set([
  "ar", "bo", "cl", "co", "cr", "cu", "do", "ec", "es", "gt", "hn", "mx", "ni", "pa", "pe", "pr", "py", "sv", "uy", "ve",
]);
const KNOWN_SPANISH_CHANNEL_IDS = new Set(["tdp.tv", "e3.tv", "rmtv.tv", "gol.tv", "betis.tv"]);

function spanishPriority(channel: LiveChannel): number {
  const languages = [channel.language, ...channel.sources.map(source => source.language)].filter((value): value is string => Boolean(value));
  const tokens = languages.flatMap(value => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9-]+/));
  if (tokens.some(value => value === "spanish" || value === "espanol" || value === "castellano" || value === "spa" || /^es(?:-[a-z]{2})?$/.test(value))) return 2;
  // An explicit non-Spanish language wins over a country-based guess.
  if (tokens.some(value => value.length > 1)) return 0;

  const identity = [channel.name, channel.tvgName, channel.tvgId, ...channel.sources.map(source => source.channelName ?? source.label)]
    .filter(Boolean).join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(?:spanish|espanol|castellano|castilian)\b/.test(identity)
    || /\b(?:espn|fox|tudn|univision)\s+deportes\b/.test(identity)) return 2;

  const ids = [channel.tvgId ?? ""].map(value => value.toLowerCase().replace(/@(?:sd|hd|fhd|uhd|4k|8k)$/i, ""));
  if (ids.some(value => KNOWN_SPANISH_CHANNEL_IDS.has(value))) return 1;
  const countries = [channel.country ?? "", ...(channel.country?.split(/[;,\s]+/) ?? [])];
  for (const id of [channel.tvgId ?? "", channel.tvgName ?? ""]) {
    for (const match of id.matchAll(/\.([a-z]{2})(?:@|$)/gi)) countries.push(match[1]);
  }
  if (countries.some(value => SPANISH_SPEAKING_COUNTRIES.has(value.trim().toLowerCase()))) return 1;
  return 0;
}

/** Linear channels never enter the match identity/deduplication pipeline. */
export function buildSportsChannels(channels: readonly LiveChannel[], sports: readonly string[], now = Date.now()) {
  const byId = new Map<string, LiveEvent>();
  const items: MediaItem[] = [];
  const selectedChannels = channels.filter(channel => channel.sources.length && channelMatchesSports(channel, sports, now));
  // Stable sort: prioritize identified Spanish-language channels without hiding
  // other regions or changing the order within each priority group.
  selectedChannels.sort((a, b) => spanishPriority(b) - spanishPriority(a));
  for (const channel of selectedChannels) {
    const event = iptvChannelEvent(channel);
    if (byId.has(event.id)) continue;
    byId.set(event.id, event);
    const p = channel.currentProgramme;
    const current = p && Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt) ? p : undefined;
    const sport = channel.sports?.includes("futbol") ? "futbol" : channel.sports?.includes("baloncesto") ? "baloncesto" : channel.sports?.includes("mma") ? "mma" : "futbol";
    const artwork = sportsFallbackArtwork({ title: channel.name, sport }, "Canal deportivo");
    items.push({ id: event.id, type: "live", name: channel.name, poster: channel.poster || artwork, background: channel.poster || artwork, originalPoster: artwork,
      logo: channel.logo, genres: ["Canal deportivo", ...(channel.sports ?? []).filter((s): s is "futbol" | "mma" | "baloncesto" => s === "futbol" || s === "mma" || s === "baloncesto").map(sportsDisciplineLabel)],
      description: current ? `Ahora: ${current.title}${current.subtitle ? ` · ${current.subtitle}` : ""}. Programación del canal; la emisión puede variar según tu región.`
        : "Sin programación disponible. Puedes abrir el canal, pero no se ha confirmado qué partido está emitiendo." });
  }
  const row: CatalogRowData | null = items.length ? { addonId: "aetherio-sports", addonName: "Sports", catalogId: "sports-channels", type: "live", name: "Canales deportivos", items } : null;
  return { row, items, byId };
}
