// Recorrido estructural de páginas de archivo oficial, agnóstico de clases.
// Estrategias: secciones por encabezados (h2/h3...) con ítems en listas, o
// tablas con fila de categoría.

import { load, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { AwardStatus } from "./types";
import { cleanText, detectStatus, stripStatusMarkers } from "./parse";

export function loadHtml(html: string): CheerioAPI {
  return load(html);
}

export interface SectionItem {
  text: string;
  status: AwardStatus | null;
}

export interface Section {
  category: string;
  items: SectionItem[];
}

const WINNER_CLASS_TOKENS = ["winner", "won", "ganador", "ganadora", "awarded", "受賞"];
const NOMINEE_CLASS_TOKENS = ["nominee", "nominated", "nominado", "nominada", "優秀", "提名"];

function classTokens($: CheerioAPI, el: AnyNode): string {
  const raw = $(el).attr("class") ?? "";
  return ` ${raw} `.toLowerCase();
}

/** Estado sugerido por clases/tokens del elemento (fallback visual). */
export function statusFromElement($: CheerioAPI, el: AnyNode): AwardStatus | null {
  const tokens = classTokens($, el);
  if (WINNER_CLASS_TOKENS.some(token => tokens.includes(` ${token} `) || tokens.includes(`${token}-`))) {
    return "winner";
  }
  if (NOMINEE_CLASS_TOKENS.some(token => tokens.includes(` ${token} `) || tokens.includes(`${token}-`))) {
    return "nominee";
  }
  return null;
}

export function itemStatus($: CheerioAPI, el: AnyNode, useTextMarkers = true): AwardStatus | null {
  const fromClass = statusFromElement($, el);
  if (fromClass) return fromClass;
  if (!useTextMarkers) return null;
  const text = cleanText($(el));
  const fromText = detectStatus(text);
  if (fromText) return fromText;
  const inner = $(el).find(".winner, .won, .ganadora, .ganador, .nominee, .nominated, .nominada, .nominado, .awarded").first();
  if (inner.length === 0) return null;
  const innerClass = ` ${String(inner.attr("class") ?? "")} `.toLowerCase();
  return WINNER_CLASS_TOKENS.some(token => innerClass.includes(` ${token}`)) ? "winner" : "nominee";
}

function tagNameOf($: CheerioAPI, el: AnyNode): string {
  const prop = $(el).prop("tagName");
  return typeof prop === "string" ? prop.toLowerCase() : "";
}

/**
 * Camina secciones definidas por encabezados: la categoría es el texto del
 * encabezado y sus ítems son los elementos itemSelector en los hermanos
 * siguientes hasta el próximo encabezado del mismo nivel.
 */
export function walkSections(
  $: CheerioAPI,
  headingSelector: string,
  itemSelector: string,
  options?: { useTextMarkers?: boolean; maxItemsPerSection?: number },
): Section[] {
  const useTextMarkers = options?.useTextMarkers ?? true;
  const maxItems = options?.maxItemsPerSection ?? 200;
  const headings = $("body").find(headingSelector).toArray();
  const sections: Section[] = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const category = stripStatusMarkers(cleanText($(heading))).replace(/^#{1,6}\s*/, "").trim();
    if (!category) continue;

    const items: SectionItem[] = [];
    let cursor: AnyNode | null = heading.next;
    while (cursor) {
      if (cursor.nodeType === 1) {
        const tagName = tagNameOf($, cursor);
        if (tagName === "footer" || tagName === "nav" || tagName === "script" || tagName === "style") break;
        // La sección termina ante cualquier encabezado (mismo nivel o anidado):
        // evita que wrappers tipo "Winners"/"Nominees" absorban subcategorías.
        if ($(cursor).is(headingSelector)) break;
        const $cursor = $(cursor);
        const hasItems = $cursor.find(itemSelector).length > 0 || $cursor.is(itemSelector);
        if (hasItems) {
          const targets = $cursor.is(itemSelector) ? [cursor] : $cursor.find(itemSelector).toArray();
          for (const target of targets) {
            const tag = tagNameOf($, target);
            const text = cleanText($(target));
            if (!text || tag === "ul" || tag === "ol") continue;
            items.push({ text, status: itemStatus($, target, useTextMarkers) });
            if (items.length >= maxItems) break;
          }
        }
      }
      cursor = cursor.next;
    }
    if (items.length > 0) sections.push({ category, items });
  }
  return sections;
}

/** Camina tablas: fila de categoría (th o td destacado) seguida de filas de datos. */
export function walkTable(
  $: CheerioAPI,
  tableSelector: string,
  options?: { categorySelector?: string; useTextMarkers?: boolean },
): Section[] {
  const useTextMarkers = options?.useTextMarkers ?? true;
  const categorySelector = options?.categorySelector ?? "th[colspan], tr.category, tr[class*='categor'], tr[class*='head']";
  const sections: Section[] = [];

  $(tableSelector).each((_i, table) => {
    const rows = $(table).find("tr").toArray();
    let current: Section | null = null;
    for (const row of rows) {
      const $row = $(row);
      const text = cleanText($row);
      if (!text) continue;
      const isCategory = $row.find(categorySelector).length > 0 || $row.find("th").length > 0;
      if (isCategory) {
        const categoryText = cleanText($row.find(categorySelector).first())
          || cleanText($row.find("th").first())
          || cleanText($row.find("td").first());
        const category = stripStatusMarkers(categoryText).trim();
        if (category) {
          current = { category, items: [] };
          sections.push(current);
        }
        continue;
      }
      if (!current) continue;
      const cells = $row.find("td").toArray();
      const firstCell = cells[0] ? cleanText($(cells[0])) : text;
      if (!firstCell) continue;
      current.items.push({ text: firstCell, status: itemStatus($, row, useTextMarkers) });
    }
  });
  return sections.filter(section => section.items.length > 0);
}

/** Itera ítems de un contenedor (lista de ganadores/nominados). */
export function itemsIn($: CheerioAPI, containerSelector: string, itemSelector: string): SectionItem[] {
  const items: SectionItem[] = [];
  $(containerSelector).each((_i, container) => {
    $(container).find(itemSelector).each((_j, item) => {
      const text = cleanText($(item));
      if (!text) return;
      items.push({ text, status: itemStatus($, item) });
    });
  });
  return items;
}

/** Devuelve el texto con los marcadores de estado eliminados. */
export function plainText(text: string): string {
  return stripStatusMarkers(text);
}

export type { CheerioAPI, AnyNode };
