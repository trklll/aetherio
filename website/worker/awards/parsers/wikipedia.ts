// Parser genérico de Wikipedia como fuente secundaria verificada.
// Solo se usa para cubrir huecos del archivo oficial (fallback de importación);
// todos los registros se etiquetan source_tier = 'secondary'.
//
// Estructuras reales que soporta (Wikipedia actual y markup antiguo):
// - Encabezados envueltos en <div class="mw-heading">: el contenido es hermano
//   del wrapper, no del heading.
// - Tablas con columnas por categoría (Oscar/BAFTA actuales): cada <td> trae
//   un <div> con el nombre de la categoría y un <ul> cuyo primer <li> (en
//   negrita) es el ganador con el <ul> anidado de nominados.
// - Tablas con filas <th> de categoría y columnas ("Film" / "Television" de
//   los Globos de Oro): filas th de categoría (colspan), filas th de
//   subcategorías (Drama / Musical or Comedy) y filas td de datos.
// - Layout antiguo con filas th (categoría) + td (ítems) en la misma fila.
// - Tablas de estadísticas (Nominations/Wins) se ignoran.

import type { AnyNode } from "domhandler";
import type { AwardCeremony, AwardStatus, ParsedEdition } from "../types";
import type { CeremonyParser, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml } from "../sections";
import type { Section, SectionItem } from "../sections";
import { cleanText, detectStatus, stripStatusMarkers } from "../parse";

const WIKIPEDIA_BASE = "https://en.wikipedia.org/wiki/";

function ordinal(edition: number): string {
  const mod100 = edition % 100;
  const mod10 = edition % 10;
  if (mod100 >= 11 && mod100 <= 13) return `${edition}th`;
  if (mod10 === 1) return `${edition}st`;
  if (mod10 === 2) return `${edition}nd`;
  if (mod10 === 3) return `${edition}rd`;
  return `${edition}th`;
}

/** Página de Wikipedia de la edición, por ceremonia (null si no existe). */
const PAGE_TITLES: Record<AwardCeremony, (edition: number, awardYear: number) => string | null> = {
  oscar: edition => `${ordinal(edition)} Academy Awards`,
  bafta: edition => `${ordinal(edition)} British Academy Film Awards`,
  golden_globes: edition => `${ordinal(edition)} Golden Globe Awards`,
  emmy: edition => `${ordinal(edition)} Primetime Emmy Awards`,
  goya: edition => `${ordinal(edition)} Goya Awards`,
  japan_academy: edition => `${ordinal(edition)} Japan Academy Film Prize`,
  crunchyroll: edition => `${ordinal(edition)} Crunchyroll Anime Awards`,
  cannes: (_edition, awardYear) => `${awardYear} Cannes Film Festival`,
  venice: edition => `${ordinal(edition)} Venice International Film Festival`,
  mar_del_plata: () => null, // sin artículo por edición en Wikipedia
};

export function wikipediaPageUrl(ceremony: AwardCeremony, edition: number, awardYear: number): string | null {
  const title = PAGE_TITLES[ceremony](edition, awardYear);
  return title ? `${WIKIPEDIA_BASE}${title.replace(/ /g, "_")}` : null;
}

// Secciones que no aportan premiaciones en una página de edición.
const SKIP_CATEGORY =
  /^(?:references|external links|see also|notes|further reading|bibliography|cast(?: and crew)?|production|music|soundtrack|release|reception|box office|box office performance of nominees|critical reviews|ratings and reception|cultural impact|legacy|in popular culture|controversy|controversies|accolades|award ceremonies?|awards breakdown|timeline|background|plot|plot summary|synopsis|sequel|remake|parody|statistics|multiple nominations and awards|films? with (?:the )?most|presenters?|performers?|in memoriam|ceremony(?: information)?|telecast|broadcast|production team|records and milestones|highest|nominees? by (?:film|category))\b/i;

const GROUP_STATUS_TEXT = /^(?:winners?|ganadores?|ganadoras?|nominados?|nominadas?|nominations?|受賞|提名|優秀)\b/i;

/** Primera columna de una tabla de estadísticas (Nominations/Wins/Awards). */
const STATS_TABLE_HEADER = /^(?:nominations?|wins?|awards?)\b/i;

function tagNameOf($: ReturnType<typeof loadHtml>, el: AnyNode): string {
  const prop = $(el).prop("tagName");
  return typeof prop === "string" ? prop.toLowerCase() : "";
}

function hasBold($: ReturnType<typeof loadHtml>, el: AnyNode): boolean {
  return $(el).find("b, strong").length > 0;
}

function stripFootnotes(text: string): string {
  return text.replace(/\[\d+\]/g, "").replace(/\s{2,}/g, " ").trim();
}

/** Texto de un li sin el contenido de sus listas anidadas (nominados). */
function liText($: ReturnType<typeof loadHtml>, li: AnyNode): string {
  const clone = $(li).clone();
  clone.find("ul, ol").remove();
  return stripFootnotes(cleanText(clone));
}

/** Ítems de una celda: <li> de ganadores/nominados, o el texto plano. */
function itemsOfCell($: ReturnType<typeof loadHtml>, td: AnyNode): SectionItem[] {
  const items: SectionItem[] = [];
  const $td = $(td);
  const lis = $td.find("li").toArray();
  for (const li of lis) {
    const text = liText($, li);
    if (!text) continue;
    const fromText = detectStatus(text);
    const isNested = $(li).parents("li").length > 0;
    items.push({
      text: stripStatusMarkers(text),
      status: fromText ?? (hasBold($, li) ? "winner" : isNested ? "nominee" : "winner"),
    });
    if (items.length >= 200) break;
  }
  if (items.length > 0) return items;
  const text = stripFootnotes(cleanText($td));
  if (!text) return [];
  const fromText = detectStatus(text);
  return [{ text: stripStatusMarkers(text), status: fromText ?? (hasBold($, td) ? "winner" : "nominee") }];
}

/**
 * Parsea una tabla de premiaciones en una o más secciones:
 * - una fila th de categoría (colspan) abre un bloque de columnas;
 * - una fila th de subcategorías (Drama / Musical or Comedy) etiqueta columnas;
 * - una fila td de datos aporta una sección por columna (div de categoría o
 *   combinación de categoría + subcategoría);
 * - filas th + td (layout antiguo) son una sección por fila;
 * - las tablas de estadísticas se ignoran por completo.
 */
function parseTable($: ReturnType<typeof loadHtml>, table: AnyNode, fallbackCategory: string): Section[] {
  const sections: Section[] = [];
  const rows = $(table).find("tr").toArray();
  let baseCategories: string[] = [];
  let subcategories: string[] = [];
  let lastSection: Section | null = null;

  for (const row of rows) {
    const $row = $(row);
    const ths = $row.find("th").toArray();
    const tds = $row.find("td").toArray();
    if (ths.length === 0 && tds.length === 0) continue;

    // Layout antiguo: la categoría está en la th y los ítems en las tds.
    if (ths.length > 0 && tds.length > 0) {
      const category = stripStatusMarkers(cleanText($(ths[0]))).trim() || fallbackCategory;
      if (!category) continue;
      const items: SectionItem[] = [];
      for (const td of tds) items.push(...itemsOfCell($, td));
      if (items.length > 0) {
        if (lastSection && lastSection.category === category) {
          lastSection.items.push(...items);
        } else {
          lastSection = { category, items };
          sections.push(lastSection);
        }
      }
      continue;
    }

    if (ths.length > 0) {
      // El header de estadísticas se detecta sobre el texto crudo:
      // stripStatusMarkers borraría "Nominations"/"Wins" de la celda.
      const rawThs = ths.map(th => cleanText($(th)).trim()).filter(Boolean);
      if (rawThs.some(text => STATS_TABLE_HEADER.test(text))) return [];
      const thTexts = rawThs.map(text => stripStatusMarkers(text).trim()).filter(Boolean);
      if (thTexts.length === 0) continue;
      if (thTexts.length === 1) {
        // Fila de categoría de bloque (colspan, o texto de varias palabras).
        // Una sola th sin colspan es cabecera de columna ("Film"): se ignora.
        const colspan = Number($(ths[0]).attr("colspan") ?? 1);
        if (colspan >= 2 || thTexts[0].split(/\s+/).length > 2) {
          baseCategories = thTexts;
          subcategories = [];
        }
      } else {
        subcategories = thTexts;
      }
      continue;
    }

    // Fila de datos: una sección por columna de categoría.
    const consumed = baseCategories;
    baseCategories = [];
    const subCols = subcategories;
    subcategories = [];
    for (let index = 0; index < tds.length; index += 1) {
      const td = tds[index];
      let category = "";
      if (consumed[0] && subCols[index]) {
        category = /^(?:other|others|miscellaneous|various)$/i.test(consumed[0])
          ? subCols[index]
          : `${consumed[0]} – ${subCols[index]}`;
      } else if (consumed[0]) {
        category = consumed[0];
      } else if (subCols[index]) {
        // Filas de subcategorías sin bloque ("Best Director | Best Screenplay").
        category = subCols[index];
      } else {
        const div = $(td).find("div").first();
        category = div.length ? stripStatusMarkers(cleanText(div)).trim() : "";
      }
      if (!category) category = fallbackCategory;
      if (!category) continue;
      const items = itemsOfCell($, td);
      if (items.length === 0) continue;
      if (lastSection && lastSection.category === category && consumed.length === 0 && subCols.length === 0) {
        // Filas sin categoría propia (layout antiguo) se acumulan en la sección.
        lastSection.items.push(...items);
      } else {
        lastSection = { category, items };
        sections.push(lastSection);
      }
    }
  }
  return sections.filter(section => section.items.length > 0);
}

/** Recolecta ítems li de una sección libre (fuera de tablas). */
function collectListItems($: ReturnType<typeof loadHtml>, start: AnyNode, out: SectionItem[]): void {
  const lis = $(start).find("li").toArray();
  for (const li of lis) {
    if (out.length >= 200) return;
    if ($(li).closest("table").length > 0) continue;
    const text = liText($, li);
    if (!text) continue;
    const fromText = detectStatus(text);
    const isNested = $(li).parents("li").length > 0;
    out.push({
      text: stripStatusMarkers(text),
      status: fromText ?? (hasBold($, li) ? "winner" : isNested ? "nominee" : null),
    });
  }
}

function isHeadingWrapper($: ReturnType<typeof loadHtml>, el: AnyNode): boolean {
  const className = String($(el).attr("class") ?? "");
  if (!/(?:^|\s)mw-heading(?:\s|$)/.test(className)) return false;
  return $(el).find("h2, h3").length > 0;
}

/**
 * Camina el contenido de una sección (desde el wrapper del heading o el
 * propio heading): tablas de premiaciones y listas libres hasta el próximo
 * encabezado. Las tablas pueden producir varias secciones (columnas).
 */
function collectSection(
  $: ReturnType<typeof loadHtml>,
  start: AnyNode,
  fallbackCategory: string,
): Section[] {
  const sections: Section[] = [];
  const loose: SectionItem[] = [];

  let node: AnyNode | null = start.next;
  while (node) {
    if (node.nodeType !== 1) {
      node = node.next;
      continue;
    }
    const tagName = tagNameOf($, node);
    if (tagName === "h2" || tagName === "h3" || tagName === "footer" || tagName === "nav" || tagName === "script" || tagName === "style") {
      break;
    }
    if (tagName === "div" && isHeadingWrapper($, node)) break;
    if (tagName === "table") {
      sections.push(...parseTable($, node, fallbackCategory));
      node = node.next;
      continue;
    }
    if ("children" in node && node.children.length > 0) {
      collectListItems($, node, loose);
      if (loose.length >= 200) break;
    }
    node = node.next;
  }
  if (loose.length > 0) sections.push({ category: fallbackCategory, items: loose });
  return sections;
}

/** Estado del grupo: "Winners" -> winner; grupos mixtos o "Nominees" -> nominee. */
function groupStatusOf(text: string): AwardStatus | null {
  if (/\b(?:nominees?|nominations?|nominated|nominados?|nominadas?|nominación|提名|優秀)\b/i.test(text)) return "nominee";
  return detectStatus(text);
}

/** Camina la página: h2 de grupo (Winners/Nominees) y h3 de categoría con sus ítems. */
export function walkWikipedia($: ReturnType<typeof loadHtml>): Section[] {
  $(".navbox, .toc, .mw-jump-link, .noprint, .mw-editsection, .sistersitebox, .sidebar, .hatnote").remove();
  const headings = $.root().find("h2, h3").toArray();
  const sections: Section[] = [];
  let groupStatus: AwardStatus | null = null;

  for (const heading of headings) {
    const raw = cleanText($(heading)).trim();
    const category = stripStatusMarkers(raw).replace(/^#{1,6}\s*/, "").trim();
    if (!category) continue;
    const tagName = tagNameOf($, heading);
    // El estado del grupo se detecta sobre el texto crudo: stripStatusMarkers
    // borraría "Winners" de "Winners and nominees" y rompería el patrón.
    const isGroupHeader = GROUP_STATUS_TEXT.test(raw);

    if (tagName === "h2") {
      groupStatus = isGroupHeader ? groupStatusOf(raw) : null;
      continue;
    }

    // h3: categoría o subgrupo de estado ("Winners" dentro de la categoría).
    if (isGroupHeader) {
      groupStatus = groupStatusOf(raw) ?? groupStatus;
      continue;
    }
    // El SKIP se evalúa sobre el texto crudo: "Multiple nominations and
    // awards" perdería "nominations" tras stripStatusMarkers.
    if (SKIP_CATEGORY.test(raw)) continue;

    // MediaWiki envuelve los encabezados en <div class="mw-heading">: el
    // contenido es hermano del wrapper, no del heading. En markup antiguo
    // sin wrapper se arranca del propio heading.
    const parent = $(heading).parent();
    const start = parent.is(".mw-heading, [class*='mw-heading']") ? (parent.get(0) ?? heading) : heading;

    const collected = collectSection($, start, category);
    for (const section of collected) {
      for (const item of section.items) {
        if (item.status === null) item.status = groupStatus ?? "winner";
      }
      sections.push(section);
    }
  }
  return sections;
}

/** Parser genérico de Wikipedia; se construye por ceremonia para validar el meta. */
export function wikipediaParser(ceremony: AwardCeremony): CeremonyParser {
  return {
    ceremony,
    archiveEditions: () => [],
    recentEditions: () => [],
    parseEdition(html: string, meta: ParserMeta): ParsedEdition {
      const $ = loadHtml(html);
      const sections = walkWikipedia($);
      const records = recordsFromSections(sections, meta, {
        ceremony,
        defaultStatus: "winner",
        personCategories: true,
        sourceTier: "secondary",
      });
      return {
        ceremony,
        edition: meta.edition,
        awardYear: meta.awardYear,
        coverage: meta.coverage,
        records,
      };
    },
  };
}
