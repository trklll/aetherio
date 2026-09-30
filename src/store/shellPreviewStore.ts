import type { ShellPreviewRequest } from "../utils/shellPreview";

/**
 * Big Picture: carrusel de preview shells.
 *
 * Cuando se entra a una page detail desde el carrusel (onNavigate) el HomePage
 * se desmonta (BigPicturePage renderiza DetailPage en su lugar) y el preview se
 * pierde. Para volver al carrusel al salir del detail, se guarda una copia
 * serializable del carrusel antes de navegar y se restaura al volver al home.
 */

export interface SavedShellPreviewItem {
  detailPath: string;
  title: string;
  background?: string;
}

export interface SavedShellPreview {
  items: SavedShellPreviewItem[];
  activeIndex: number;
}

let pending: SavedShellPreview | null = null;

export function savePendingShellPreview(state: SavedShellPreview) {
  pending = state;
}

export function takePendingShellPreview(): SavedShellPreview | null {
  const next = pending;
  pending = null;
  return next;
}

export function peekPendingShellPreview(): SavedShellPreview | null {
  return pending;
}

export function clearPendingShellPreview() {
  pending = null;
}

/**
 * Reconstruye un ShellPreviewRequest a partir del estado guardado.
 * cardElement se resuelve de forma perezosa: al restaurar, el DOM del Home se
 * acaba de remontar y las cards todavía pueden no existir; por eso se deja en
 * null y el foco se resuelve en restoreFocus vía [data-detail-path].
 */
export function buildRestoredPreviewRequest(saved: SavedShellPreview): ShellPreviewRequest {
  const active = saved.items[Math.max(0, Math.min(saved.activeIndex, saved.items.length - 1))];
  const makeRestoreFocus = (detailPath: string) => () => {
    try {
      const escaped = CSS.escape(detailPath);
      const card = document.querySelector<HTMLElement>(`[data-detail-path="${escaped}"] [data-row-card], [data-detail-path="${escaped}"]`);
      if (card?.isConnected) {
        card.scrollIntoView({ block: "nearest", inline: "nearest" });
        window.setTimeout(() => {
          if (document.querySelector("[data-shell-preview]")) return;
          card.focus({ preventScroll: true });
        }, 80);
        return;
      }
    } catch {
      // Selector best-effort; si falla no se restaura el foco.
    }
    const fallback = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    fallback?.focus?.({ preventScroll: true });
  };
  return {
    detailPath: active?.detailPath ?? "",
    title: active?.title ?? "",
    background: active?.background,
    cardElement: null,
    items: saved.items.map(item => ({
      detailPath: item.detailPath,
      title: item.title,
      background: item.background,
      cardElement: null,
      restoreFocus: makeRestoreFocus(item.detailPath),
    })),
    initialIndex: Math.max(0, Math.min(saved.activeIndex, saved.items.length - 1)),
  };
}
