export const SHELL_PREVIEW_QUERY = "shellPreview";
export const SHELL_PREVIEW_MESSAGE_SOURCE = "aetherio-shell-preview";

export interface ShellPreviewItem {
  detailPath: string;
  title: string;
  background?: string;
  // Fondo tal y como lo pinta la card de la fila (una resolución más baja y ya
  // en caché). El shell pinta primero esta capa y deja que `background` —que es
  // el `original` del Detail— disuelva encima: sin esto las fichas vecinas
  // arrancarían vacías hasta que terminara de descargar su imagen y su entrada
  // lateral se vería como un simple parpadeo.
  cardBackground?: string;
  cardElement: HTMLElement | null;
  restoreFocus?: () => void;
}

export interface ShellPreviewRequest extends ShellPreviewItem {
  items?: ShellPreviewItem[];
  initialIndex?: number;
}

export function resolveShellPreviewInitialIndex(request: ShellPreviewRequest) {
  const count = request.items?.length || 1;
  return Math.max(0, Math.min(request.initialIndex ?? 0, count - 1));
}

// SearchDetailOverlay.kt uses a 960 x 540 logical TV viewport. Keep this
// density fixed while the embedded viewport resizes, rather than scaling it.
export function shellPreviewBounds(width: number, height: number) {
  const density = Math.min(width / 960, height / 540);
  const panelWidth = Math.min(width - 168 * density, width * 0.84);
  return { left: (width - panelWidth) / 2, top: 28 * density, width: panelWidth, height: height - 28 * density, density };
}

export function isShellPreviewBootstrap(pathname: string, search: string, embedded: boolean) {
  return embedded && isShellPreviewInternalPath(pathname)
    && new URLSearchParams(search).get(SHELL_PREVIEW_QUERY) === "1";
}

/**
 * Distancia con signo más corta de `item` respecto a `index` en un carrusel
 * circular de `count` fichas. El carrusel no tiene fin, así que "la siguiente"
 * de la última es la primera: el hueco se mide siempre por el lado más corto.
 *
 *   wrapDelta(0, 4, 5) → +1   (activo = la última: la siguiente es la primera)
 *   wrapDelta(4, 0, 5) → -1   (activo = la primera: la anterior es la última)
 */
export function wrapDelta(item: number, index: number, count: number) {
  if (count <= 0) return 0;
  const raw = (((item - index) % count) + count) % count;
  return raw * 2 > count ? raw - count : raw;
}

/**
 * El overlay puede seguir montado pero cerrado (`hidden`) para que sus iframes
 * no tiren la cache del Detail. Por eso "hay un preview abierto" no es solo que
 * el nodo exista: tiene que estar visible. Todo lo que consulta si el carrusel
 * está en pantalla pasa por aquí.
 */
export function isShellPreviewOpen() {
  if (typeof document === "undefined") return false;
  return !!document.querySelector("[data-shell-preview]:not([hidden])");
}

export type ShellPreviewMessage =
  | { source: typeof SHELL_PREVIEW_MESSAGE_SOURCE; type: "loading" }
  | { source: typeof SHELL_PREVIEW_MESSAGE_SOURCE; type: "ready" }
  | { source: typeof SHELL_PREVIEW_MESSAGE_SOURCE; type: "close" }
  | { source: typeof SHELL_PREVIEW_MESSAGE_SOURCE; type: "navigate"; path: string }
  | { source: typeof SHELL_PREVIEW_MESSAGE_SOURCE; type: "background"; background: string }
  | { source: typeof SHELL_PREVIEW_MESSAGE_SOURCE; type: "reveal"; on: boolean };

type ShellPreviewEvent =
  | { type: "loading" }
  | { type: "ready" }
  | { type: "close" }
  | { type: "navigate"; path: string }
  | { type: "background"; background: string };

export function withShellPreviewQuery(detailPath: string) {
  const url = new URL(detailPath, "https://aetherio.local");
  url.searchParams.set(SHELL_PREVIEW_QUERY, "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function isShellPreviewInternalPath(pathname: string) {
  return pathname.startsWith("/big-picture/detail/")
    || pathname.startsWith("/big-picture/person/")
    || pathname.startsWith("/big-picture/entity/");
}

export function isShellPreviewMessage(value: unknown): value is ShellPreviewMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.source !== SHELL_PREVIEW_MESSAGE_SOURCE) return false;
  if (message.type === "loading" || message.type === "ready" || message.type === "close") return true;
  if (message.type === "background") {
    return typeof message.background === "string" && message.background.length > 0;
  }
  if (message.type === "reveal") return typeof message.on === "boolean";
  return message.type === "navigate"
    && typeof message.path === "string"
    && message.path.startsWith("/")
    && !message.path.startsWith("//")
    && !/[\\\u0000-\u001f]/.test(message.path);
}

export function postShellPreviewMessage(message: ShellPreviewEvent) {
  if (typeof window === "undefined" || window.parent === window) return;
  const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
  window.parent.postMessage({ source: SHELL_PREVIEW_MESSAGE_SOURCE, ...message }, targetOrigin);
}

// La shell muestra exactamente el backdrop final del Detail (normalmente el
// `original` de TMDB), que pesa mucho más que el fondo de la card. Para que
// llegue lo antes posible se precalienta en caché: misma foto a máxima
// resolución. Si el Detail resuelve otra URL distinta, el preload se pierde
// (una sola imagen) sin ningún efecto visible.
export function fullResArtworkUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(
    /https:\/\/image\.tmdb\.org\/t\/p\/w\d+\//i,
    "https://image.tmdb.org/t/p/original/",
  );
}

const preloadedArtwork = new Set<string>();

export function preloadArtwork(url?: string) {
  const full = fullResArtworkUrl(url);
  if (!full || preloadedArtwork.has(full)) return;
  preloadedArtwork.add(full);
  try {
    const probe = new Image();
    try {
      (probe as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "high";
    } catch {
      // fetchPriority best-effort.
    }
    probe.decoding = "async";
    probe.src = full;
  } catch {
    preloadedArtwork.delete(full);
  }
}
