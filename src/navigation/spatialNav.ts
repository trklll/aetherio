import { useEffect, useState } from "react";
import { isBigPictureMode } from "../runtime/platform.ts";
import { prefersReducedMotion, tweenTo } from "../utils/motion.ts";
import { isContextMenuOpen } from "../components/ui/ContextMenu.tsx";

/**
 * Navegación espacial 2D estilo Aetherio TV (Compose) para PC.
 *
 * Port 1:1 del modelo nativo:
 * - Compose TV mueve el foco al vecino más cercano EN LA DIRECCIÓN (no en
 *   orden DOM): HomeCanvas asume arriba/abajo entre filas, izquierda/derecha
 *   dentro de la fila, y el scaffold abre el rail con Left en el borde
 *   (TvPagePillScaffold: moveFocus falla -> expanded = true).
 * - El interceptor de fila solo abre el rail en la card 0; el resto de Left
 *   se mueve dentro de la fila. Equivalente web: Left sin candidato a la
 *   izquierda abre el rail.
 * - Back cierra el rail antes de salir (LocalTvPagePillBackHandler).
 * - Cada pantalla enfoca su contenido al entrar (requesters tras frames).
 * - El item enfocado se trae a vista (BringIntoViewSpec animado).
 * - Memoria de card por row: up/down entra en la card donde la row destino se
 *   quedó la última vez, no siempre en la 0. Se guarda el índice de la card
 *   enfocada (no el scrollLeft de la row), así que es independiente del scroll
 *   de cada fila y no "se va a cualquier lado". Una row en la que nunca se ha
 *   entrado sí empieza por su primera card.
 *
 * Activo solo en modo espacial (big-picture): en desktop con
 * ratón no interfiere. Las flechas del teclado equivalen al D-pad/stick del
 * mando (useGamepad ya las sintetiza); el botón A genera Enter sintético.
 */

export type SpatialDir = "left" | "right" | "up" | "down";

/** Evento para abrir el rail de picture desde el motor (borde izquierdo). */
export const OPEN_PICTURE_RAIL_EVENT = "aetherio-open-rail";

/**
 * Transición héroe ↔ contenido del Detail en picture (port del modelo de
 * zonas nativo: onMoveToContent/onMoveToHero con delay de 300ms y foco al
 * primer contenido). El Detail los escucha y ejecuta scroll + foco.
 */
export const DETAIL_ENTER_CONTENT_EVENT = "aetherio-detail-enter-content";
export const DETAIL_EXIT_HERO_EVENT = "aetherio-detail-exit-hero";

/**
 * El Detail en picture tiene dos zonas: el hero y la zona de contenido (rows).
 * El "atrás" desde la de contenido es un paso al hero, NO la salida de la
 * pantalla: el propio Detail repliega con el fade de su scroll (blur del
 * backdrop a 0, viñeta y overlay oscuro fuera, logo de contenido oculto, copy
 * del hero entrando) y devuelve el foco a Reproducir.
 *
 * Lo que decide es el `back` de la superficie que lo contiene (la shell preview
 * o la page Big Picture): si está en la zona de contenido, que se lo gaste el
 * hero; solo desde el hero el "atrás" colapsa o navega. Antes, el "atrás" salía
 * siempre y dejaba la ficha a media pantalla.
 *
 * `data-content-zone` lo escribe el Detail en su shell de scroll al cruzar el
 * hero — la misma señal que consume su CSS — así que la fuente de verdad es una
 * sola y no hay que recalcular el borde del hero aquí.
 *
 * @returns true si el Detail estaba en su zona de contenido: el "atrás" queda
 *   consumido y la superficie NO debe colapsar ni navegar.
 */
export function exitDetailContentZone(): boolean {
  if (typeof document === "undefined") return false;
  if (!document.querySelector("[data-content-zone]")) return false;
  window.dispatchEvent(new CustomEvent(DETAIL_EXIT_HERO_EVENT));
  return true;
}

/**
 * Puente con el Search de Big Picture (port 1:1 del SearchScreen nativo):
 * - SHOW: Left en el primer item (o con el teclado visible) vuelve al
 *   teclado en pantalla (equivale al leftInterceptor + showKeyboard nativo).
 * - HIDE: Right en una tecla del borde derecho sale del teclado y enfoca
 *   el contenido primario (onLeaveKeyboard -> focusPrimaryContent nativo).
 * El componente posee el estado; el motor solo dispara el evento.
 */
export const BP_SEARCH_SHOW_KEYBOARD_EVENT = "aetherio-bp-search-show-keyboard";
export const BP_SEARCH_HIDE_KEYBOARD_EVENT = "aetherio-bp-search-hide-keyboard";
/** Movimiento izquierda/derecha del selector de géneros del Home. */
export const GENRE_SHOWCASE_MOVE_EVENT = "aetherio-genre-showcase-move";
/**
 * El hero del Home en picture cicla el medio del banner con izquierda/derecha
 * desde el botón Reproducir (adelante / atrás). El backdrop decide si hay
 * medio anterior; si no, abre el rail.
 */
export const HERO_NEXT_EVENT = "aetherio-hero-next";
export const HERO_PREV_EVENT = "aetherio-hero-prev";

export function openPictureRail() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PICTURE_RAIL_EVENT));
}

function isSpatialNavMode() {
  if (typeof document === "undefined") return false;
  return isBigPictureMode()
    || document.documentElement.classList.contains("aetherio-profile-selection");
}

export interface SpatialRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DIR_VEC: Record<SpatialDir, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * Vecino más cercano en la dirección, estilo Compose FocusFinder:
 * distancia primaria + penalización del eje secundario (×2.2) + castigo
 * extra fuera del "haz" del elemento actual. Pura: cubierta por tests.
 */
export function findBestCandidate<T extends SpatialRect>(
  current: SpatialRect,
  dir: SpatialDir,
  others: readonly T[],
): T | null {
  const [dx, dy] = DIR_VEC[dir];
  const cx = current.left + current.width / 2;
  const cy = current.top + current.height / 2;
  // Ancho del haz = dimensión ortogonal del elemento actual.
  const beam = dir === "left" || dir === "right" ? current.height : current.width;

  let best: T | null = null;
  let bestScore = Infinity;
  for (const o of others) {
    if (o === (current as unknown as T)) continue;
    const ox = o.left + o.width / 2 - cx;
    const oy = o.top + o.height / 2 - cy;
    const primary = ox * dx + oy * dy;
    if (primary <= 8) continue; // tiene que estar en la dirección
    const secondary = Math.abs(ox * dy - oy * dx);
    const outsideBeam = Math.max(0, secondary - beam / 2);
    const score = primary + secondary * 2.2 + outsideBeam * 2;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export const SPATIAL_FOCUS_CLASS = "spatial-focus";

/**
 * Memoria por row: guarda la última card con foco de cada `data-row-key`.
 * Es lo que hace el TV nativo — bajas a otra row, vuelves, y la row te devuelve
 * la card donde la dejaste (episodio 20, no el 1). La clave la pone la propia
 * row y ya incluye el media y, en el Detail, la temporada: cada fila recuerda
 * su sitio sin mezclarse con las demás.
 *
 * Sin recuerdo (o con una row más corta que antes) se entra en la primera card.
 */
const focusedItemByRow = new Map<string, number>();
let activeRowKey: string | null = null;

/** Índice recordado de una row destino, o undefined si nunca estuvo activa. */
function rememberedIndexFor(rowEl: Element): number | undefined {
  const key = rowEl.getAttribute("data-row-key");
  if (!key) return undefined;
  return focusedItemByRow.get(key);
}

/** Índice deseado al entrar a una row: el recordado, o la primera card. Pura. */
export function resolveDesiredIndex(
  remembered: number | undefined,
  fallbackIndex: number,
  count: number,
): number {
  if (count <= 0) return 0;
  const base = remembered ?? fallbackIndex;
  if (!Number.isFinite(base)) return 0;
  return Math.min(Math.max(0, Math.trunc(base)), count - 1);
}

function getRowKey(el: HTMLElement): string | null {
  return el.closest("[data-row-key]")?.getAttribute("data-row-key") ?? null;
}

function getItemIndex(el: HTMLElement): number | null {
  const holder = el.matches("[data-item-index]")
    ? el
    : el.closest("[data-item-index]");
  if (!holder) return null;
  const idx = Number(holder.getAttribute("data-item-index"));
  return Number.isFinite(idx) && idx >= 0 ? Math.trunc(idx) : null;
}

function getRowCount(rowEl: Element): number {
  const fromAttr = Number(rowEl.getAttribute("data-row-count"));
  if (Number.isFinite(fromAttr) && fromAttr > 0) return Math.trunc(fromAttr);
  return rowEl.querySelectorAll("[data-item-index]").length;
}

function listRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-row-key]"))
    .filter(row => getRowCount(row) > 0);
}

/** Cards focuseables de la row ordenadas por índice (hay doble data-row-card: wrapper + inner). */
function getRowCards(rowEl: Element): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const cards: { idx: number; el: HTMLElement }[] = [];
  for (const holder of Array.from(rowEl.querySelectorAll<HTMLElement>("[data-item-index]"))) {
    const idx = Number(holder.getAttribute("data-item-index"));
    if (!Number.isFinite(idx) || idx < 0) continue;
    // El focuseable real (tabIndex 0) vive dentro del wrapper en CatalogRow.
    const focusable = holder.matches("button, a, input, [tabindex]")
      && holder.getAttribute("tabindex") !== "-1"
      && isVisibleFocusable(holder)
      ? holder
      : holder.querySelector<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      );
    if (focusable && isVisibleFocusable(focusable) && !seen.has(focusable)) {
      seen.add(focusable);
      cards.push({ idx: Math.trunc(idx), el: focusable });
    }
  }
  cards.sort((a, b) => a.idx - b.idx);
  return cards.map(c => c.el);
}

function findCardByIndex(rowEl: Element, index: number): HTMLElement | null {
  const holder = rowEl.querySelector<HTMLElement>(`[data-item-index="${index}"]`);
  if (!holder) return null;
  if (holder.matches("button, a, input, [tabindex]")
    && holder.getAttribute("tabindex") !== "-1"
    && isVisibleFocusable(holder)) return holder;
  const inner = holder.querySelector<HTMLElement>(
    "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
  );
  return inner && isVisibleFocusable(inner) ? inner : null;
}

function estimateStride(rowEl: Element): number {
  const cards = getRowCards(rowEl);
  if (cards.length >= 2) {
    const a = cards[0].getBoundingClientRect();
    const b = cards[1].getBoundingClientRect();
    const stride = Math.abs(b.left - a.left);
    if (stride > 50) return stride;
  }
  if (cards.length === 1) {
    const w = cards[0].getBoundingClientRect().width;
    if (w > 50) return w + 18;
  }
  return 443; // CARD_W (425) + GAP (18) por defecto
}

/**
 * Racha de navegación: si las flechas llegan seguidas (<260ms) es movimiento
 * mantenido → modo rápido (scroll instantáneo para que la vista siga al foco
 * en vez de perseguirlo con smooth). Como el fast-scroll vertical nativo.
 * Enfoca la card; si está virtualizada, scrollea la row y reintenta.
 */
let lastNavAt = 0;
let navStreak = 0;
let navigationGeneration = 0;

function registerNav(): boolean {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const gap = now - lastNavAt;
  lastNavAt = now;
  navStreak = gap < 260 ? navStreak + 1 : 0;
  return navStreak >= 2;
}

function focusRowIndex(rowEl: HTMLElement, index: number, dir: SpatialDir, fast = false): boolean {
  const generation = navigationGeneration;
  const key = rowEl.getAttribute("data-row-key");
  const direct = findCardByIndex(rowEl, index);
  if (direct) {
    if (key) {
      focusedItemByRow.set(key, index);
      activeRowKey = key;
    }
    direct.focus({ preventScroll: true });
    bringIntoView(direct, dir, fast);
    // La row virtualizada recicla nodos al scrollear: re-afirma tras el render.
    requestAnimationFrame(() => {
      if (generation !== navigationGeneration) return;
      const again = findCardByIndex(rowEl, index);
      if (again && document.activeElement !== again) {
        again.focus({ preventScroll: true });
        bringIntoView(again, dir, fast);
      }
    });
    return true;
  }
  const scroller = rowEl.querySelector<HTMLElement>("[data-row-scroller]");
  if (!scroller) return false;
  const stride = estimateStride(rowEl);
  scroller.scrollTo({ left: Math.max(0, index * stride - 48), behavior: "auto" });
  let attempts = 0;
  const retry = () => {
    if (generation !== navigationGeneration) return;
    attempts += 1;
    const card = findCardByIndex(rowEl, index);
    if (card) {
      if (key) {
        focusedItemByRow.set(key, index);
        activeRowKey = key;
      }
      card.focus({ preventScroll: true });
      bringIntoView(card, dir, fast);
      return;
    }
    if (attempts < 12) requestAnimationFrame(retry);
  };
  requestAnimationFrame(retry);
  return true;
}

/** Solo para tests/debug: expone la memoria por row (focusedItemByRow nativo). */
export function getSpatialRowMemory(): { activeRowKey: string | null; focused: [string, number][] } {
  return { activeRowKey, focused: [...focusedItemByRow.entries()] };
}

function recordRowFocus(el: HTMLElement) {
  const key = getRowKey(el);
  if (!key) return;
  activeRowKey = key;
  const idx = getItemIndex(el);
  if (idx != null) focusedItemByRow.set(key, idx);
}

/** Row vecina en DOM (el orden vertical del Home): equivalente al LazyColumn nativo. */
function neighborRow(currentRow: Element, dir: SpatialDir): HTMLElement | null {
  if (dir !== "up" && dir !== "down") return null;
  const rows = listRows();
  const i = rows.indexOf(currentRow as HTMLElement);
  if (i < 0) return null;
  return dir === "down" ? (rows[i + 1] ?? null) : (rows[i - 1] ?? null);
}

/** Primera row visible del Detail: subir desde aquí vuelve al hero. */
function isFirstVisibleDetailRow(row: HTMLElement): boolean {
  if (!(row.getAttribute("data-row-key") ?? "").startsWith("detail:")) return false;
  const rows = listRows().filter(candidate => {
    if (!(candidate.getAttribute("data-row-key") ?? "").startsWith("detail:")) return false;
    const rect = candidate.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  });
  return rows[0] === row;
}

/** Desde fuera de rows (hero): la row más cercana en la dirección. */
function nearestRowInDir(current: SpatialRect, dir: SpatialDir): HTMLElement | null {
  const rows = listRows();
  if (!rows.length) return null;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (dir === "down") {
      const delta = r.top - (current.top + current.height);
      if (delta < -40) continue;
      if (delta < bestScore) { bestScore = delta; best = row; }
    } else if (dir === "up") {
      const delta = current.top - r.top;
      if (r.top + r.height > current.top + 40) continue;
      if (delta < bestScore) { bestScore = delta; best = row; }
    }
  }
  return best;
}

/**
 * Navegación por índice dentro/fuera de rows: left/right al hermano adyacente
 * y up/down a la card que la row vecina tenía apuntada (o a la primera si
 * nunca se entró en ella). Devuelve true si consume la tecla, aunque el foco
 * llegue tras el scroll virtualizado.
 */
function isRailExpanded(): boolean {
  return document.querySelector(".bp-rail__expanded.is-visible") !== null;
}

/** Lleva el foco al item actual del rail (cuando ya está abierto). */
function focusRailCurrent(): boolean {
  const current = document.querySelector<HTMLElement>(".bp-rail__item.is-focused")
    ?? document.querySelector<HTMLElement>(".bp-rail__item");
  if (!current) return false;
  current.focus({ preventScroll: true });
  return true;
}

function moveRowAware(active: HTMLElement, dir: SpatialDir, current: SpatialRect, fast = false): boolean {
  // Rejilla: el foco se mueve por geometria, nunca por indice de fila. Una
  // rejilla de N columnas no es un carril horizontal, asi que la aritmetica de
  // `data-item-index` saltaria de linea al final de cada una, y `neighborRow`
  // buscaria el siguiente grupo entero en vez de la linea siguiente. Ese camino
  // geometrico es el mismo que usa la pagina de "ver mas" del Home.
  if (active.closest("[data-spatial-grid]")) return false;
  const currentRow = active.closest("[data-row-key]") as HTMLElement | null;
  if ((dir === "left" || dir === "right") && currentRow) {
    const count = getRowCount(currentRow);
    const currentIdx = getItemIndex(active) ?? 0;
    const sibling = dir === "right" ? currentIdx + 1 : currentIdx - 1;
    if (sibling < 0) {
      // Search Big Picture (port del SearchScreen nativo): con el teclado
      // visible, Left en cualquier primera card vuelve a él; oculto, solo
      // las secciones marcadas (autocomplete/top/recents) lo reabren. El
      // resto cae al rail como el scaffold nativo.
      if (isBigPictureMode() && document.querySelector("[data-bp-search-kb]")) {
        const kbState = document.querySelector("[data-bp-search-kb]")?.getAttribute("data-bp-search-kb");
        if (kbState === "visible" || active.hasAttribute("data-kb-return")) {
          window.dispatchEvent(new CustomEvent(BP_SEARCH_SHOW_KEYBOARD_EVENT));
          return true;
        }
      }
      // Primera card + izquierda = sidebar:
      // cerrada se abre (ella se auto-enfoca), abierta recibe el foco.
      if (isBigPictureMode() && document.querySelector(".bp-rail")) {
        if (!isRailExpanded()) openPictureRail();
        else focusRailCurrent();
        return true;
      }
      return false; // fuera de picture: geométrico
    }
    if (sibling >= count) return true; // fin de row: se queda (nativo no hace wrap)
    return focusRowIndex(currentRow, sibling, dir, fast);
  }
  if ((dir === "up" || dir === "down") && currentRow) {
    const target = neighborRow(currentRow, dir);
    if (!target) return false; // primera/última row: geométrico (hero) o nada
    // La row destino devuelve el foco donde se quedó la última vez; solo si
    // nunca se entró en ella cae en la primera card.
    const desired = resolveDesiredIndex(rememberedIndexFor(target), 0, getRowCount(target));
    return focusRowIndex(target, desired, dir, fast);
  }
  if (dir === "down" || dir === "up") {
    // Teclado en pantalla del search: no robar el movimiento. Las teclas
    // (p. ej. las letras justo debajo de abc/123) se resuelven por vecino
    // geométrico; la row de contenido "más cercana" no es el destino.
    if (active.closest(".bp-search__keyboard")) return false;
    // Desde el hero (o cualquier foco fuera de rows) cae en la card que la row
    // destino tenía memorizada de su última visita, o en la primera si no hay
    // memoria.
    const target = nearestRowInDir(current, dir);
    if (!target) return false;
    const desired = resolveDesiredIndex(rememberedIndexFor(target), 0, getRowCount(target));
    return focusRowIndex(target, desired, dir, fast);
  }
  return false;
}

/** Hook reactivo del modo picture (la clase vive en documentElement). */
export function useBigPictureActive() {
  const [active, setActive] = useState(() => isBigPictureMode());
  useEffect(() => {
    const observer = new MutationObserver(() => setActive(isBigPictureMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return active;
}

function isVisibleFocusable(el: HTMLElement): boolean {
  // El rail gestiona su propio foco (como el TvPagePill nativo, fuera del grid).
  if (el.closest(".bp-rail")) return false;
  if (el.closest("[data-spatial-ignore]")) return false;
  // En picture los heads de rows no son seleccionables (como en el TV nativo).
  if (el.closest("[data-row-header]") && isBigPictureMode()) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  // Controles solo-mouse ocultos (flechas de row con opacity 0): sin mando
  // no hay hover, enfocarlos dejaría el foco en algo invisible.
  if (style.pointerEvents === "none") return false;
  return true;
}

function collectCandidates(): HTMLElement[] {
  // Menú contextual abierto: zona espacial cerrada y exclusiva. El mando no
  // debe saltar al contenido que queda detrás; salir es solo con B/Escape
  // (lo cierra ContextMenu y devuelve el foco al ancla).
  const menu = document.querySelector<HTMLElement>("[data-aetherio-context-menu]");
  if (menu) return Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisibleFocusable);
  // Una superficie modal es una zona espacial cerrada: el mando no debe
  // saltar al contenido que queda detrás mientras el usuario escribe o
  // confirma una acción.
  const modal = document.querySelector<HTMLElement>("[data-spatial-modal]");
  const scope = modal ?? document;
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisibleFocusable);
}

/**
 * Primer match con geometría real. Las páginas cacheadas (Activity oculto)
 * siguen en el DOM con display:none: un querySelector pelado las atraparía.
 */
function queryVisible(selector: string): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(selector);
  for (const el of Array.from(matches)) {
    const rect = el.getBoundingClientRect();
    if (rect.width >= 2 && rect.height >= 2) return el;
  }
  return null;
}

function isTextEntry(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (/^(textarea|select)$/i.test(el.tagName)) return true;
  if (/^input$/i.test(el.tagName)) {
    // Solo los inputs de texto ceden las flechas (teclados en pantalla).
    // Los sliders (range) son navegables con el mando: si las flechas
    // cayeran, los atajos del reproductor las convierten en volumen.
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return type !== "range" && type !== "checkbox" && type !== "radio"
      && type !== "button" && type !== "submit" && type !== "reset"
      && type !== "color" && type !== "file" && type !== "hidden"
      && type !== "image";
  }
  return false;
}

function clearFocusMarks() {
  document.querySelectorAll(`.${SPATIAL_FOCUS_CLASS}`).forEach(el => el.classList.remove(SPATIAL_FOCUS_CLASS));
}

/**
 * Trae el foco a vista como el BringIntoView nativo: si el foco cae en el
 * panel del hero, el shell vuelve arriba del todo (el `nearest` nativo no
 * hace nada cuando el botón ya asoma parcial y el hero quedaba a medias).
 * Al subir/bajar a una row-card, la row se ancla cerca del top (offset bajo
 * la pill) en vez de quedarse apenas asomando. Resto: reveal mínimo.
 */
/**
 * Scroll en racha rápida: tweens cortos re-objetivables (overwrite auto) en
 * vez del smooth del navegador, que llega tarde y va a tirones. Cada paso
 * re-apunta el mismo tween → deslizamiento continuo y elegante que sigue
 * al foco. Misma geometría que el path suave (ancla bajo la pill).
 */
/**
 * Seguimiento horizontal (CatalogRowSection con su
 * BringIntoViewSpec propio): la card con foco SIEMPRE se alinea al padding
 * inicial de la row (borde izquierdo + 48), nunca se deja donde caiga ni
 * apenas asomando al borde. Si la card no cabe, se alinea al borde final.
 * Lo usan tanto la racha rápida (tween re-objetivable) como el path suave
 * (scroll nativo).
 */
function contentVisualScaleY(el: HTMLElement, shell: HTMLElement): number {
  // Home y Entity escalan su contenido (scale 1.2, ver index.css): los rects
  // están escalados pero scrollTop no. Sin convertir, el ancla vertical erra
  // un 20% y la row enfocada queda fuera de vista al cambiar de row.
  const content = el.closest<HTMLElement>(".detail-page-scale, .entity-page-scale, .home-page-scale")
    ?? shell.querySelector<HTMLElement>(".detail-page-scale, .entity-page-scale, .home-page-scale");
  if (!content || content.offsetHeight <= 0) return 1;
  const visualHeight = content.getBoundingClientRect().height;
  return Number.isFinite(visualHeight) && visualHeight > 0
    ? visualHeight / content.offsetHeight
    : 1;
}

/**
 * Subiendo a la PRIMERA row del contenido del Detail, anclar la row bajo la
 * pill cortaría el logo + tabs que van encima. Se devuelve el scrollTop que
 * alinea el inicio del contenido (logo, o la sección) arriba del shell.
 * Solo rows `detail:*` que sean la primera visible; null = ancla normal.
 */
function firstDetailRowScrollTop(el: HTMLElement, shell: HTMLElement): number | null {
  const row = el.closest("[data-row-key]");
  if (!row || !(row instanceof HTMLElement)) return null;
  return detailRowContentTop(row, shell);
}

/**
 * Subiendo a la PRIMERA row de la page de entidad (cadena/producción), se
 * vuelve al top para mostrar la info del header completa, no solo la row.
 * Solo rows `entity:*` que sean la primera visible; null = ancla normal.
 * (Solo esta page: Detail y Home conservan su ancla.)
 */
function firstEntityRowScrollTop(el: HTMLElement, shell: HTMLElement): number | null {
  const row = el.closest("[data-row-key]");
  if (!row || !(row instanceof HTMLElement)) return null;
  if (!((row.getAttribute("data-row-key") ?? "").startsWith("entity:"))) return null;
  const visibleRows = Array.from(shell.querySelectorAll<HTMLElement>("[data-row-key]")).filter(candidate => {
    const rect = candidate.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  });
  if (visibleRows[0] !== row) return null;
  return 0;
}

/** ScrollTop que conserva el ancla de entrada de la primera row del Detail. */
function detailRowContentTop(row: HTMLElement, shell: HTMLElement): number | null {
  if (!((row.getAttribute("data-row-key") ?? "").startsWith("detail:"))) return null;
  const visibleRows = Array.from(shell.querySelectorAll<HTMLElement>("[data-row-key]")).filter(candidate => {
    const rect = candidate.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  });
  if (visibleRows[0] !== row) return null;
  const shellRect = shell.getBoundingClientRect();
  const hero = shell.querySelector<HTMLElement>("[data-hero-panel]");
  if (hero) {
    // Rebuild the same absolute hero edge used by enterContentZone. Measuring
    // the logo itself would anchor the return higher after its expansion.
    const heroRect = hero.getBoundingClientRect();
    const heroBottomAtTop = shell.scrollTop + heroRect.bottom - shellRect.top;
    const target = heroBottomAtTop + 24 - 48;
    return Number.isFinite(target) ? Math.max(0, target) : null;
  }
  const logo = shell.querySelector("[data-content-logo]");
  const ref = logo instanceof HTMLElement ? logo : (row.closest("section") ?? row);
  if (!(ref instanceof HTMLElement)) return null;
  const refRect = ref.getBoundingClientRect();
  const target = shell.scrollTop + refRect.top - shellRect.top - 12;
  return Number.isFinite(target) ? Math.max(0, target) : null;
}

/**
 * Scroll Big Picture con mando/teclado: glide suave con desaceleración larga
 * (estilo Steam). En vez del smooth nativo (brusco) o del tween corto de
 * racha (0.22s), se usa un tween re-objetivable con ease de fuerte
 * desaceleración y duración según distancia. `overwrite: auto` (dentro de
 * tweenTo) hace que mantener la flecha re-apunte el mismo tween → deriva
 * continua sin tirones.
 */
const BP_SCROLL_EASE = "expo.out";
const BP_SCROLL_MIN_DUR = 0.95;
const BP_SCROLL_MAX_DUR = 1.6;
const BP_ROW_MIN_DUR = 0.9;
const BP_ROW_MAX_DUR = 1.4;

function bpVerticalDuration(distancePx: number): number {
  const d = Math.abs(distancePx);
  return Math.min(BP_SCROLL_MAX_DUR, Math.max(BP_SCROLL_MIN_DUR, 0.95 + d / 900));
}

function bpHorizontalDuration(distancePx: number): number {
  const d = Math.abs(distancePx);
  return Math.min(BP_ROW_MAX_DUR, Math.max(BP_ROW_MIN_DUR, 0.9 + d / 1000));
}

function tweenVerticalScroll(shell: HTMLElement, target: number, fast: boolean) {
  if (prefersReducedMotion()) {
    shell.scrollTo({ top: target, behavior: "auto" });
    return;
  }
  if (isBigPictureMode()) {
    const distance = Math.abs(target - shell.scrollTop);
    if (distance <= 2) return;
    tweenTo(shell, { scrollTop: target, ease: BP_SCROLL_EASE }, bpVerticalDuration(distance));
    return;
  }
  if (fast) {
    tweenTo(shell, { scrollTop: target }, 0.22);
  } else {
    shell.scrollTo({ top: target, behavior: "smooth" });
  }
}

function tweenHorizontalScroll(rowScroller: HTMLElement, target: number, fast: boolean) {
  if (prefersReducedMotion()) {
    rowScroller.scrollTo({ left: target, behavior: "auto" });
    return;
  }
  if (isBigPictureMode()) {
    const distance = Math.abs(target - rowScroller.scrollLeft);
    if (distance <= 2) return;
    tweenTo(rowScroller, { scrollLeft: target, ease: BP_SCROLL_EASE }, bpHorizontalDuration(distance));
    return;
  }
  if (fast) {
    tweenTo(rowScroller, { scrollLeft: target }, 0.22);
  } else {
    rowScroller.scrollTo({ left: target, behavior: "smooth" });
  }
}

function followHorizontalFocus(rowScroller: HTMLElement, el: HTMLElement, fast: boolean) {
  const s = rowScroller.getBoundingClientRect();
  const c = el.getBoundingClientRect();
  const centerFocusedCard = rowScroller.hasAttribute("data-focus-center");
  // Home vive dentro de .home-page-scale (transform: scale(1.2)): los rects
  // están escalados, pero scrollLeft no. Convertir el desplazamiento visual
  // antes de sumarlo evita que el foco se pase del borde y corte la card.
  const visualScaleX = rowScroller.clientWidth > 0 ? s.width / rowScroller.clientWidth : 1;
  // Para rows sin centrado, la card enfocada queda alineada al padding propio
  // de la row (como el startPx del spec nativo), sin desfase.
  const ownPad = Number.parseFloat(getComputedStyle(rowScroller).paddingLeft) || 0;
  const pad = (ownPad > 0 ? ownPad : 48) * visualScaleX;
  const space = s.width - pad;
  const leading = c.width <= s.width && space < c.width ? s.width - c.width : pad;
  const maxLeft = Math.max(0, rowScroller.scrollWidth - rowScroller.clientWidth);
  let target = centerFocusedCard
    ? rowScroller.scrollLeft + (c.left + c.width / 2 - (s.left + s.width / 2)) / visualScaleX
    : rowScroller.scrollLeft + ((c.left - s.left) - leading) / visualScaleX;
  target = Math.min(maxLeft, Math.max(0, target));
  // Snap en los bordes: al volver a la primera/última card el cálculo por
  // rect puede dejar 2-20px de resto (la card queda cortada). Forzar 0/max.
  if (target <= 4) target = 0;
  else if (maxLeft - target <= 4) target = maxLeft;
  if (Math.abs(target - rowScroller.scrollLeft) <= 2) return;
  tweenHorizontalScroll(rowScroller, target, fast);
}

/**
 * Episodio Big Picture estático: la página no tiene ningún scroll; el cajón
 * de fuentes revela el foco por scroll programático (sin scrollbars ni
 * rueda). Nunca se toca el shell exterior.
 */
function scrollBpEpisodeListIntoView(list: HTMLElement, el: HTMLElement, fast: boolean) {
  const l = list.getBoundingClientRect();
  const c = el.getBoundingClientRect();
  const pad = 12;
  let target = list.scrollTop;
  if (c.top < l.top + pad) target += c.top - (l.top + pad);
  else if (c.bottom > l.bottom - pad) target += c.bottom - (l.bottom - pad);
  target = Math.max(0, Math.min(Math.max(0, list.scrollHeight - list.clientHeight), target));
  if (Math.abs(target - list.scrollTop) <= 2) return;
  tweenVerticalScroll(list, target, fast);
}

/**
 * ¿La fila enfocada ya cabe entera en la zona visible del shell? El ancla de
 * 81px existe para revelar una fila que queda fuera de pantalla; si la fila ya
 * se ve completa no hay nada que descubrir y recolocarla solo descuadra la page
 * (en pages cortas —el onboarding, una sola row— cortaba el título por arriba
 * sin necesidad). El borde inferior lleva margen porque la card enfocada crece
 * al enfocarse y así no queda pegada al final de la zona visible.
 */
function rowIsFullyVisible(shell: DOMRect, card: DOMRect) {
  return card.top >= shell.top + 2 && card.bottom <= shell.bottom - 8;
}

/**
 * ¿Es `el` una card de la primera fila de la rejilla del Search? Las cards de
 * una misma fila comparten `offsetTop` (son hijas del mismo grid), así que
 * compararlo con la primera basta.
 */
function isFirstSearchGridRow(el: HTMLElement): boolean {
  const grid = el.closest<HTMLElement>("[data-bp-search-grid]");
  const first = grid?.firstElementChild;
  if (!grid || !(first instanceof HTMLElement)) return false;
  return first === el || first.offsetTop === el.offsetTop;
}

function fastBringIntoView(el: HTMLElement, dir: SpatialDir) {
  const rowScroller = el.closest<HTMLElement>("[data-row-scroller]");
  if (rowScroller) followHorizontalFocus(rowScroller, el, true);
  // Página estática: solo el cajón de fuentes sigue al foco.
  if (el.closest("[data-bp-episode]")) {
    const list = el.closest<HTMLElement>("[data-bp-episode-streams]");
    if (list) scrollBpEpisodeListIntoView(list, el, true);
    return;
  }
  const shell = el.closest<HTMLElement>("[data-aetherio-scroll-shell]");
  if (!shell) {
    if (!rowScroller) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    return;
  }

  if (el.closest("[data-hero-panel]")) {
    if (shell.scrollTop > 2) tweenVerticalScroll(shell, 0, true);
    return;
  }
  const s = shell.getBoundingClientRect();
  const c = el.getBoundingClientRect();
  const scaleY = contentVisualScaleY(el, shell);
  let target = shell.scrollTop;
  // Search Big Picture: la primera fila de la rejilla de cards NO se alinea con
  // el ancla de 81px que usan las rows normales: eso la deja a media altura con
  // el pill y el título cortados. La primera fila ES el principio de la page, así
  // que se vuelve a scrollTop 0. Salida incondicional: si ya se está arriba del
  // todo, caer al cálculo del ancla de abajo volvería a cortarlo (el objetivo
  // sería positivo porque la card está más abajo que el ancla).
  if (isFirstSearchGridRow(el)) {
    if (shell.scrollTop > 2) tweenVerticalScroll(shell, 0, true);
    return;
  }
  if ((dir === "up" || dir === "down") && el.closest("[data-row-card]")) {
    const firstTop = dir === "up" ? (firstDetailRowScrollTop(el, shell) ?? firstEntityRowScrollTop(el, shell)) : null;
    if (firstTop !== null) {
      target = firstTop;
    } else {
      const anchor = window.innerHeight * 0.05 + 81; // = scroll-margin-top CSS
      // Fila ya visible = no se toca el scroll. El ancla solo saca a la vista
      // lo que estaba fuera; aplicarla siempre arrastraba la page hacia arriba
      // aunque la fila siguiente ya cupiera entera en pantalla.
      if (!rowIsFullyVisible(s, c)) target += (c.top - (s.top + anchor)) / scaleY;
    }
  } else {
    const pad = 24;
    if (c.top < s.top + pad) target += (c.top - (s.top + pad)) / scaleY;
    else if (c.bottom > s.bottom - pad) target += (c.bottom - (s.bottom - pad)) / scaleY;
  }
  if (Math.abs(target - shell.scrollTop) > 2) tweenVerticalScroll(shell, target, true);
}

function bringIntoView(el: HTMLElement, dir: SpatialDir, fast = false) {
  // Big Picture con mando/teclado: SIEMPRE glide suave con desaceleración
  // larga (incluso en pulsación aislada). El smooth nativo es brusco y el
  // tween corto de racha no tiene cola de frenada.
  if (isBigPictureMode() && !prefersReducedMotion()) {
    fastBringIntoView(el, dir);
    return;
  }
  // Racha rápida con movimiento: glide fluido; el resto, suave clásico.
  if (fast && !prefersReducedMotion()) {
    fastBringIntoView(el, dir);
    return;
  }
  // Suave como la app normal (el anclaje de rows se mantiene); instantáneo
  // solo con reduced-motion.
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  if (el.closest("[data-hero-panel]")) {
    const shell = el.closest<HTMLElement>("[data-aetherio-scroll-shell]");
    if (shell) {
      shell.scrollTo({ top: 0, behavior });
      return;
    }
  }
  // Horizontal con la regla de alineación al padding. Si hay
  // rowScroller, NO se llama a scrollIntoView después: su `inline: "nearest"`
  // alinea al borde del viewport (0), no al padding, y al correr a la vez que
  // el scrollTo suave de arriba pelean y la card queda cortada al volver al
  // principio/fin. La vertical se resuelve manual con el shell.
  // Episodio Big Picture estático: la página no tiene scroll; el foco solo
  // revela el item dentro del cajón de fuentes, sin tocar el shell.
  if (el.closest("[data-bp-episode]")) {
    const bpRowScroller = el.closest<HTMLElement>("[data-row-scroller]");
    if (bpRowScroller) followHorizontalFocus(bpRowScroller, el, false);
    const bpList = el.closest<HTMLElement>("[data-bp-episode-streams]");
    if (bpList) scrollBpEpisodeListIntoView(bpList, el, false);
    return;
  }
  const rowScroller = el.closest<HTMLElement>("[data-row-scroller]");
  if (rowScroller) {
    followHorizontalFocus(rowScroller, el, false);
    const shell = el.closest<HTMLElement>("[data-aetherio-scroll-shell]");
    if (!shell) return;
    const s = shell.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const scaleY = contentVisualScaleY(el, shell);
    let target = shell.scrollTop;
    if ((dir === "up" || dir === "down") && el.closest("[data-row-card]")) {
      const firstTop = dir === "up" ? (firstDetailRowScrollTop(el, shell) ?? firstEntityRowScrollTop(el, shell)) : null;
      if (firstTop !== null) {
        target = firstTop;
      } else {
        const anchor = window.innerHeight * 0.05 + 81; // = scroll-margin-top CSS
        if (!rowIsFullyVisible(s, c)) target += (c.top - (s.top + anchor)) / scaleY;
      }
    } else {
      const pad = 24;
      if (c.top < s.top + pad) target += (c.top - (s.top + pad)) / scaleY;
      else if (c.bottom > s.bottom - pad) target += (c.bottom - (s.bottom - pad)) / scaleY;
    }
    if (Math.abs(target - shell.scrollTop) > 2) shell.scrollTo({ top: target, behavior });
    return;
  }
  if ((dir === "up" || dir === "down") && el.closest("[data-row-card]")) {
    el.scrollIntoView({ block: "start", inline: "nearest", behavior });
    return;
  }
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
}

/** Foco inicial de pantalla: primer candidato fuera del rail (el rail no es foco inicial). */
function focusInitialContent() {
  if (!isSpatialNavMode()) return;
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && active !== document.documentElement) return;
  // Episodio Big Picture: el foco inicial es siempre la primera fuente.
  const bpPrimary = document.querySelector<HTMLElement>("[data-bp-episode-primary]");
  if (bpPrimary && isVisibleFocusable(bpPrimary)) {
    bpPrimary.focus({ preventScroll: true });
    return;
  }
  const first = collectCandidates()[0];
  if (first) first.focus({ preventScroll: true });
}

function moveFocus(dir: SpatialDir): boolean {
  // Invalidate re-affirm callbacks from the previous arrow press. Without
  // this, a delayed RAF can restore an older card after the user has already
  // moved to another row and run its stale scroll calculation.
  navigationGeneration += 1;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const all = collectCandidates();
  if (!all.length) return false;

  if (!active || active === document.body || active === document.documentElement) {
    if (dir === "left" && isBigPictureMode() && !isContextMenuOpen()) {
      // Sin foco y a la izquierda: abre el rail (scaffold nativo).
      if (!document.querySelector(".bp-rail__expanded.is-visible")) openPictureRail();
      return true;
    }
    const first = all[0];
    first.focus({ preventScroll: true });
    bringIntoView(first, dir);
    return true;
  }

  const current = active.getBoundingClientRect();
  // Racha = movimiento mantenido → glide fluido en todo el salto.
  const fast = registerNav();
  // Menú contextual abierto: controles exclusivos del menú. Se omiten los
  // atajos zonales (héroe, rows, teclado, rail) y solo se navega dentro con
  // el vecino geométrico. Sin vecino en esa dirección se consume la flecha
  // para no escapar al fondo; la salida es B/Escape.
  if (isContextMenuOpen()) {
    const next = findBestCandidate(current, dir, all.map(el => {
      const r = el.getBoundingClientRect();
      return { el, left: r.left, top: r.top, width: r.width, height: r.height };
    }));
    if (next) {
      next.el.focus({ preventScroll: true });
      bringIntoView(next.el, dir, fast);
    }
    return true;
  }
  // Al filo con acción marcada (Siguiente del hero): empujar la dispara
  // ANTES de buscar vecinos — a la derecha no hay nada y el geométrico
  // caería en diagonal a la row de abajo.
  if (active.getAttribute("data-edge-activate") === dir) {
    active.click();
    return true;
  }
  // Hero del Home en picture: derecha = siguiente medio del banner,
  // izquierda = anterior; si no hay anterior, el backdrop abre el rail
  // (dispara HERO_PREV_EVENT y decide). Solo aquí: el Detail usa su propio
  // data-hero-primary sin esta marca, así que su izquierda sigue abriendo
  // el rail directamente.
  if (active.hasAttribute("data-hero-cycle") && isBigPictureMode()) {
    if (dir === "right") {
      window.dispatchEvent(new CustomEvent(HERO_NEXT_EVENT));
      return true;
    }
    if (dir === "left") {
      window.dispatchEvent(new CustomEvent(HERO_PREV_EVENT));
      return true;
    }
  }
  // Search Big Picture (port del onLeaveKeyboard nativo): Right en una
  // tecla del borde derecho del teclado sale al contenido primario.
  if (dir === "right" && active.getAttribute("data-kb-edge") === "right" && isBigPictureMode()) {
    if (document.querySelector("[data-bp-search-primary]")) {
      window.dispatchEvent(new CustomEvent(BP_SEARCH_HIDE_KEYBOARD_EVENT));
      return true;
    }
  }
  // Search Big Picture: Left en un item marcado (primera columna del grid
  // o primer item de row) reabre el teclado para seguir escribiendo
  // (equivale al leftInterceptor nativo). Va antes de moveRowAware porque
  // el grid no usa data-row-key y caería al geométrico (abriría el rail).
  if (dir === "left" && active.hasAttribute("data-kb-return") && isBigPictureMode()) {
    if (document.querySelector("[data-bp-search-kb]")) {
      window.dispatchEvent(new CustomEvent(BP_SEARCH_SHOW_KEYBOARD_EVENT));
      return true;
    }
  }
  // Search Big Picture: Up desde los tabs (lo más alto enfocable) también
  // reabre el teclado. Es la salida en 1 toque cuando la página quedó a
  // medias con el mando: el show vuelve arriba y enfoca la última tecla.
  if (dir === "up" && active.hasAttribute("data-kb-summon") && isBigPictureMode()) {
    if (document.querySelector("[data-bp-search-kb]")) {
      window.dispatchEvent(new CustomEvent(BP_SEARCH_SHOW_KEYBOARD_EVENT));
      return true;
    }
  }
  // Search Big Picture: Down desde las tabs a las cards retira el teclado, que
  // es el momento de verdad en que el foco lo abandona. Las tabs (y los atajos
  // LB/RB que las recorren) dejan el teclado al lado a propósito, porque siguen
  // siendo fila de categorías; sin esto el teclado se quedaba sticky pegado al
  // scroll con el contenido moviéndose al lado. El hide enfoca el contenido
  // primario, que es justo la primera card de la fila a la que se baja.
  if (dir === "down" && active.hasAttribute("data-kb-summon") && isBigPictureMode()) {
    if (document.querySelector("[data-bp-search-primary]")) {
      window.dispatchEvent(new CustomEvent(BP_SEARCH_HIDE_KEYBOARD_EVENT));
      return true;
    }
  }
  // El showcase de géneros es una sola card visible: izquierda/derecha cambia
  // su género actual en vez de buscar otra card geométrica.
  if ((dir === "left" || dir === "right") && active.hasAttribute("data-genre-showcase") && isBigPictureMode()) {
    window.dispatchEvent(new CustomEvent(GENRE_SHOWCASE_MOVE_EVENT, {
      detail: { direction: dir },
    }));
    return true;
  }
  // Controles TV de valor único (idioma, modo, velocidad): izquierda/derecha
  // cambia el valor en lugar de abandonar la fila. El componente decide si
  // avanzar o retroceder escuchando el evento en su botón.
  if ((dir === "left" || dir === "right") && active.hasAttribute("data-spatial-cycle") && isBigPictureMode()) {
    active.dispatchEvent(new CustomEvent("aetherio-spatial-cycle", {
      bubbles: true,
      detail: { direction: dir },
    }));
    return true;
  }
  // Episodio Big Picture estático: subida/bajada determinista entre el
  // cajón de fuentes y los filtros (arriba desde una fuente → "Todas",
  // abajo desde filtros → primera fuente). Va ANTES de moveRowAware: si
  // corriera después, la memoria por fila lo consumiría y mandaría el foco
  // al último chip visitado en vez de a TODOS.
  if (active.closest("[data-bp-episode]")) {
    if (dir === "up" && active.closest("[data-bp-episode-streams]")) {
      const todas = document.querySelector<HTMLElement>('[data-row-key="episode-sources"] [data-item-index="0"]');
      if (todas && isVisibleFocusable(todas)) {
        const sourceRow = todas.closest<HTMLElement>('[data-row-key="episode-sources"]');
        if (sourceRow) {
          // Entrar por el mismo camino que una row del Home: registra el
          // índice, aplica la marca visual y revela el chip horizontalmente.
          focusRowIndex(sourceRow, 0, dir, fast);
        } else {
          todas.focus({ preventScroll: true });
        }
        return true;
      }
    }
    if (dir === "down" && active.closest('[data-row-key="episode-sources"]')) {
      const firstStream = document.querySelector<HTMLElement>("[data-bp-episode-primary]")
        ?? document.querySelector<HTMLElement>("[data-bp-episode-streams] button:not([disabled])");
      if (firstStream && isVisibleFocusable(firstStream)) {
        firstStream.focus({ preventScroll: true });
        const list = firstStream.closest<HTMLElement>("[data-bp-episode-streams]");
        if (list) scrollBpEpisodeListIntoView(list, firstStream, fast);
        return true;
      }
    }
  }
  // Primero: dentro/fuera de rows manda el índice, no la geometría
  // (el scrollLeft distinto por row haría caer "en cualquier lado").
  // PERO la salida del héroe del Detail va antes: héroe y contenido son
  // zonas separadas y bajar desde Reproducir/... debe correr la transición
  // (scroll pasando el hero + foco al primer contenido). Si la row-aware
  // corriera primero, enfocaría el episodio directo y el hero quedaría
  // visible arriba. Solo casa con [data-hero-*], fuera del Detail no cambia.
  const inBigPicture = isBigPictureMode();
  const detailMenuOpen = isContextMenuOpen();
  if (!detailMenuOpen && dir === "left" && inBigPicture && active.hasAttribute("data-hero-primary")) {
    openPictureRail();
    return true;
  }
  if (!detailMenuOpen && dir === "down" && active.hasAttribute("data-hero-action")) {
    if (inBigPicture) {
      window.dispatchEvent(new CustomEvent(DETAIL_ENTER_CONTENT_EVENT));
      return true;
    }
    const tab = queryVisible(".season-tab.is-selected") ?? queryVisible(".season-tab");
    if (tab) {
      tab.focus({ preventScroll: true });
      bringIntoView(tab, dir, fast);
      return true;
    }
    const firstEpisode = queryVisible('.detail-episode-card[tabindex="0"]');
    if (firstEpisode) {
      firstEpisode.focus({ preventScroll: true });
      bringIntoView(firstEpisode, dir, fast);
      return true;
    }
  }
  // Desde la tab de temporada, abajo va SIEMPRE al primer episodio de la
  // row. El cambio de foco no debe mover verticalmente el shell: la posición
  // actual la conserva el usuario, y solo el foco horizontal se ajusta.
  if (!detailMenuOpen && dir === "down" && active.classList.contains("season-tab")) {
    const firstEpisode = queryVisible('.detail-episode-card[tabindex="0"]');
    if (firstEpisode) {
      firstEpisode.focus({ preventScroll: true });
      const rowScroller = firstEpisode.closest<HTMLElement>("[data-row-scroller]");
      if (rowScroller) followHorizontalFocus(rowScroller, firstEpisode, fast);
      return true;
    }
  }
  // Si el Detail empieza directamente con trailers, comentarios, colección u
  // otra row (por ejemplo una película sin episodios), no hay una tab/carta
  // de episodio que pueda reclamar ArrowUp. La primera row siempre devuelve
  // al hero y deja que Detail ejecute el scroll inverso.
  if (!detailMenuOpen && dir === "up" && inBigPicture) {
    const currentRow = active.closest<HTMLElement>("[data-row-key]");
    if (currentRow && isFirstVisibleDetailRow(currentRow)) {
      window.dispatchEvent(new CustomEvent(DETAIL_EXIT_HERO_EVENT));
      return true;
    }
  }
  if (moveRowAware(active, dir, current, fast)) return true;
  // Resto del Detail estilo nativo (la salida del héroe ya se resolvió
  // arriba, antes de la row-aware):
  // - Arriba desde una tab vuelve al héroe.
  // - Arriba desde una card de episodio sube a la tab seleccionada.
  // (Abajo desde la tab se resolvió arriba: primer episodio sin scroll.)
  // Con menú contextual abierto no se secuestra nada: las flechas navegan el menú.
  if (!detailMenuOpen && dir === "up" && active.classList.contains("season-tab")) {
    if (inBigPicture) {
      window.dispatchEvent(new CustomEvent(DETAIL_EXIT_HERO_EVENT));
      return true;
    }
    const play = queryVisible("[data-hero-primary]");
    if (play) {
      play.focus({ preventScroll: true });
      bringIntoView(play, dir, fast);
      return true;
    }
  }
  if (!detailMenuOpen && dir === "up" && active.classList.contains("detail-episode-card")) {
    // En Big Picture la row de temporadas es solo indicador (LB/RB): subir
    // desde un episodio vuelve directo al hero, sin detenerse en las tabs.
    if (inBigPicture) {
      window.dispatchEvent(new CustomEvent(DETAIL_EXIT_HERO_EVENT));
      return true;
    }
    const tab = queryVisible(".season-tab.is-selected") ?? queryVisible(".season-tab");
    if (tab) {
      tab.focus({ preventScroll: true });
      // Al subir a la tab se alinea el inicio del contenido (logo completo,
      // hero fuera); si ya está ahí, sin scroll.
      const shell = tab.closest<HTMLElement>("[data-aetherio-scroll-shell]");
      const row = tab.closest("section")?.querySelector<HTMLElement>("[data-row-key]");
      const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
      const contentTop = shell && row ? detailRowContentTop(row, shell) : null;
      if (shell && contentTop !== null) {
        if (Math.abs(contentTop - shell.scrollTop) > 2) shell.scrollTo({ top: contentTop, behavior });
      } else {
        bringIntoView(tab, dir, fast);
      }
      return true;
    }
    if (inBigPicture) {
      window.dispatchEvent(new CustomEvent(DETAIL_EXIT_HERO_EVENT));
      return true;
    }
    const playFallback = queryVisible("[data-hero-primary]");
    if (playFallback) {
      playFallback.focus({ preventScroll: true });
      bringIntoView(playFallback, dir, fast);
      return true;
    }
  }
  let next = findBestCandidate(current, dir, all.map(el => {
    const r = el.getBoundingClientRect();
    return { el, left: r.left, top: r.top, width: r.width, height: r.height };
  }));
  // Al subir al hero, el foco vuelve siempre a la acción primaria
  // (Reproducir), no al Siguiente auxiliar.
  if (next && dir === "up" && next.el.closest("[data-hero-panel]")) {
    const primary = document.querySelector<HTMLElement>("[data-hero-primary]");
    if (primary && primary !== next.el && all.includes(primary)) next = { ...next, el: primary };
  }
  if (next) {
    next.el.focus({ preventScroll: true });
    bringIntoView(next.el, dir, fast);
    return true;
  }

  // Borde sin vecino: como el scaffold nativo, Left abre el rail en picture.
  if (dir === "left" && isBigPictureMode() && !document.querySelector(".bp-rail__expanded.is-visible")) {
    openPictureRail();
    return true;
  }
  return false;
}

/**
 * Instala el motor global. Se llama una vez desde main.tsx (sustituye al
 * ciclado lineal en orden DOM, que no existe en el TV nativo).
 */
export function installSpatialNavigation() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isSpatialNavMode()) return;
    // The native preview owns input, forwarding it to its embedded detail
    // only after expansion. Never move focus in the Home behind it.
    if (document.querySelector("[data-shell-preview]")) return;

    // Confirmar con mando (A = Enter sintético): los eventos sintéticos no
    // disparan la activación nativa del botón, hay que clickear a mano.
    // El Enter real del teclado se deja al navegador (evita doble click).
    // La pulsación con hold (A mantenido) la gestiona la card destino
    // (corto = abrir, largo = opciones): aquí no se clickea en el down.
    if (event.key === "Enter" && !event.isTrusted) {
      if ((event as KeyboardEvent & { aetherioGamepadHold?: boolean }).aetherioGamepadHold) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && !isTextEntry(el) && (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button")) {
        event.preventDefault();
        event.stopPropagation();
        el.click();
      }
      return;
    }

    if (event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowUp") return;
    const target = event.target as HTMLElement | null;
    if (isTextEntry(target)) return;
    // El rail gestiona sus propias flechas (arriba/abajo/izquierda/derecha/cierre).
    if (target?.closest(".bp-rail")) return;

    const dir: SpatialDir =
      event.key === "ArrowRight" ? "right"
      : event.key === "ArrowDown" ? "down"
      : event.key === "ArrowLeft" ? "left"
      : "up";
    // Sin wrap en los bordes (como el nativo): siempre se consume la flecha
    // para que la página no haga scroll por su cuenta.
    event.preventDefault();
    event.stopPropagation();
    moveFocus(dir);
  };
  window.addEventListener("keydown", onKeyDown, true);

  // Cierre de la pulsación del mando: las cards con [data-long-press] ya
  // resolvieron corto/largo en su keyup; el resto (botones reales) confirma
  // aquí al soltar A, como el click sintético de antes pero sin romper holds.
  const onKeyUp = (event: KeyboardEvent) => {
    if (!isSpatialNavMode()) return;
    if (document.querySelector("[data-shell-preview]")) return;
    if (event.key !== "Enter") return;
    if (!(event as KeyboardEvent & { aetherioGamepadHold?: boolean }).aetherioGamepadHold) return;
    const el = document.activeElement as HTMLElement | null;
    if (!el || isTextEntry(el)) return;
    if (el.closest("[data-long-press]")) return;
    if (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button") {
      el.click();
    }
  };
  window.addEventListener("keyup", onKeyUp, true);

  // Anillo de foco visible solo en modo espacial (los eventos sintéticos del
  // mando no siempre activan :focus-visible, por eso se marca con clase).
  const onFocusIn = (event: FocusEvent) => {
    if (!isSpatialNavMode()) return;
    const el = event.target as HTMLElement | null;
    if (el instanceof HTMLElement && el !== document.body && !el.closest(".bp-rail")) {
      // Solo puede existir un foco espacial visual. Algunos WebViews no
      // entregan focusout de forma consistente al mover el mando rápidamente.
      clearFocusMarks();
      el.classList.add(SPATIAL_FOCUS_CLASS);
      // Memoria por row: cualquier foco que cae en una card queda apuntado,
      // venga del mando, del ratón o del teclado.
      recordRowFocus(el);
    }
  };
  const onFocusOut = (event: FocusEvent) => {
    (event.target as HTMLElement | null)?.classList?.remove(SPATIAL_FOCUS_CLASS);
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);

  // Al salir del modo espacial, limpiar marcas.
  const classObserver = new MutationObserver(() => {
    if (!isSpatialNavMode()) clearFocusMarks();
  });
  classObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  // Foco inicial al entrar en modo espacial (requester tras frames, como el nativo).
  let initialTimer = 0;
  const scheduleInitial = () => {
    window.clearTimeout(initialTimer);
    initialTimer = window.setTimeout(focusInitialContent, 380);
  };
  const modeObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.attributeName !== "class") continue;
      if (isSpatialNavMode()) scheduleInitial();
      else window.clearTimeout(initialTimer);
    }
  });
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  // Foco inicial al cambiar de ruta dentro del modo espacial (cada pantalla
  // nativa enfoca su contenido al entrar).
  const fireRouteChange = () => {
    if (isSpatialNavMode()) scheduleInitial();
  };
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  history.pushState = (...args) => {
    originalPushState(...args);
    fireRouteChange();
  };
  history.replaceState = (...args) => {
    originalReplaceState(...args);
    fireRouteChange();
  };
  window.addEventListener("popstate", fireRouteChange);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    classObserver.disconnect();
    modeObserver.disconnect();
    window.clearTimeout(initialTimer);
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", fireRouteChange);
  };
}
