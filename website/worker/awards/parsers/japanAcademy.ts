// Parser del archivo oficial del Japan Academy Prize (japan-academy-prize.jp/prizes/).
// Estructura: tablas por categoría (fila th) con filas de obras y marcadores
// 受賞 (ganadora) / 優秀 (nominada).

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkTable, type AnyNode, type CheerioAPI } from "../sections";

const CEREMONY: AwardCeremony = "japan_academy";
const LATEST_EDITION = 49; // 49.ª edición, 2026

const DICTIONARY: Record<string, string> = {
  "最優秀作品賞": "Mejor Película",
  "最優秀アニメーション作品賞": "Mejor Película de Animación",
  "最優秀監督賞": "Mejor Dirección",
  "最優秀脚本賞": "Mejor Guion",
  "最優秀主演男優賞": "Mejor Actor Protagónico",
  "最優秀主演女優賞": "Mejor Actriz Protagónica",
  "最優秀助演男優賞": "Mejor Actor de Reparto",
  "最優秀助演女優賞": "Mejor Actriz de Reparto",
  "最優秀音楽賞": "Mejor Música",
  "最優秀撮影賞": "Mejor Fotografía",
  "最優秀照明賞": "Mejor Iluminación",
  "最優秀美術賞": "Mejor Dirección de Arte",
  "最優秀録音賞": "Mejor Sonido",
  "最優秀編集賞": "Mejor Montaje",
};

export const japanAcademyParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    const editions: EditionSpec[] = [];
    for (let edition = 1; edition <= LATEST_EDITION; edition += 1) {
      editions.push({
        edition,
        awardYear: edition + 1977,
        coverage: "complete",
        url: `https://www.japan-academy-prize.jp/prizes/?t=${edition}`,
      });
    }
    return editions;
  },

  recentEditions() {
    return [
      { ceremony: CEREMONY, edition: LATEST_EDITION },
      { ceremony: CEREMONY, edition: LATEST_EDITION - 1 },
    ];
  },

  // El sitio oficial bloquea/no expone el archivo histórico 1–45; se deja
  // como hueco bloqueado hasta disponer de capturas verificadas.
  gapEditions() {
    return Array.from({ length: 45 }, (_, index) => ({ edition: index + 1, awardYear: index + 1978, type: "blocked" as const }));
  },

  parseEdition(html: string, meta: ParserMeta): ParsedEdition {
    const $ = loadHtml(html);
    const realSections: Array<{ category: string; items: Array<{ text: string; status: "winner" | "nominee" }> }> = [];
    $(".subtitle").each((_index, subtitle) => {
      const category = $(subtitle).find("img[alt]").first().attr("alt")?.trim() || $(subtitle).text().trim();
      if (!category) return;
      const items: Array<{ text: string; status: "winner" | "nominee" }> = [];
      let sibling = $(subtitle).next();
      while (sibling.length > 0 && !sibling.is(".subtitle")) {
        sibling.find(".txtBlock").each((_i, block) => {
          const line = $(block).find(".txt p").first().text().replace(/\s+/g, " ").trim();
          const parsed = parseJapaneseAwardLine(line);
          if (parsed) items.push(parsed);
        });
        sibling.find(".titleBlock").each((_i, titleBlock) => {
          const line = $(titleBlock).text().replace(/\s+/g, " ").trim();
          const parsed = parseJapaneseTitleBlock(line, $, titleBlock);
          if (parsed) items.push(parsed);
        });
        sibling = sibling.next();
      }
      if (items.length > 0) realSections.push({ category, items });
    });

    // Fallback for the compact table format used by older editions and tests.
    const sections = realSections.length > 0 ? realSections : walkTable($, "table");
    const records = recordsFromSections(sections, meta, {
      ceremony: CEREMONY,
      dictionary: DICTIONARY,
      defaultStatus: "nominee",
      personCategories: true,
    });
    return {
      ceremony: CEREMONY,
      edition: meta.edition,
      awardYear: meta.awardYear,
      coverage: meta.coverage,
      records,
    };
  },
};

function parseJapaneseAwardLine(line: string): { text: string; status: "winner" | "nominee" } | null {
  if (!line) return null;
  const quoted = /[「『]([^「」『』]+)[」』]/.exec(line);
  if (!quoted?.[1]) return null;
  return {
    text: quoted[1].trim(),
    status: line.includes("最優秀") ? "winner" : "nominee",
  };
}

function parseJapaneseTitleBlock(
  line: string,
  $: CheerioAPI,
  titleBlock: AnyNode,
): { text: string; status: "winner" | "nominee" } | null {
  if (!line) return null;
  const quoted = /^(.*?)\s*[「『]([^「」『』]+)[」』]/.exec(line);
  if (!quoted?.[2]) return null;
  const status = $(titleBlock).find("img[alt*='最優秀']").length > 0 ? "winner" : "nominee";
  const recipient = quoted[1].replace(/\s+/g, " ").trim();
  return { text: recipient ? `${recipient} — ${quoted[2].trim()}` : quoted[2].trim(), status };
}
