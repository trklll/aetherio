import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tmdbFetch } from "../../config/apiKeys";
import { useAddonStore } from "../../store/addonStore";
import { useMediaSearch } from "../../hooks/useMediaSearch";
import { buildDetailPath, buildPersonPath } from "../../utils/bigPictureDetail.ts";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import type { UnifiedSearchResult } from "../../utils/searchProviders";
import { isNameMatch, pickTopNameMatch } from "../../utils/searchPeople";
import { gsap, prefersReducedMotion } from "../../utils/motion";
import {
  BP_SEARCH_HIDE_KEYBOARD_EVENT,
  BP_SEARCH_SHOW_KEYBOARD_EVENT,
} from "../../navigation/spatialNav";
import { GAMEPAD_ACTION_EVENT } from "../../hooks/useGamepad";
import { useTextBackAction } from "../../input/inputActions";
import "./BigPictureSearch.css";

/**
 * Search Big Picture rediseñado 1:1 sobre la referencia tvOS (fotos):
 * - Título compacto con la query + teclado fino a la izquierda (sticky).
 * - Tabs "Top resultados | Películas | Reparto y equipo" con reglas laterales.
 * - Top: grid 3 columnas de wide cards (thumb + título + meta).
 * - Películas: fila horizontal de pósters a sangre.
 * - Reparto y equipo: búsqueda de personas TMDB en grid de wide cards.
 * - Con teclado visible hay pills de sugerencia bajo los tabs; sin
 *   teclado la página es full-width (como en las fotos).
 *
 * Detalles Apple (skill apple-design): tracking negativo en display,
 * transiciones cortas críticamente amortiguadas, foco = cambio de
 * material (fondo blanco) sin outlines.
 */

const QUERY_STORE_KEY = "aetherio-bp-search-query-v1";

// Entrada/salida del teclado en pantalla. La columna del teclado es de 300px y
// deja 56px de hueco, así que el contenido salta 356px al aparecer o
// desaparecer. Se anima el ancho REAL de la columna (y el hueco), no un overlay
// encima, para que el reflow del grid se vea continuo en vez de teletransportado.
//
// La curva es la del scroll inercial de la app (`installInertialScroll`): salida
// rápida yhenyada larga, power4.out con duración según la distancia recorrida.
// Con prefers-reduced-motion el layout se coloca de golpe (mover el grid no es
// decorativo) y solo se atenúa el teclado.
const KEYBOARD_WIDTH = 300;
const KEYBOARD_GAP = 56;
/** Cuánto se escora el teclado hacia fuera al irse (paralaje, no desplazamiento). */
const KEYBOARD_SHIFT = 26;
const KEYBOARD_MOVE_MS = 460;

type KbMode = "ABC" | "NUMBERS";
type KbAction = "INSERT" | "SPACE" | "DELETE" | "CLEAR" | "MODE";
type SearchTab = "top" | "movies" | "series" | "cast";

interface KbKey {
  id: string;
  label: string;
  row: number;
  col: number;
  span: number;
  value: string;
  action: KbAction;
  mode?: KbMode;
}

interface SearchPerson {
  id: number;
  name: string;
  photo?: string;
  department: string;
  popularity?: number;
}

const TABS: readonly { key: SearchTab; label: string }[] = [
  { key: "top", label: "Top resultados" },
  { key: "movies", label: "Películas" },
  { key: "series", label: "Series" },
  { key: "cast", label: "Reparto y equipo" },
];

const DEPARTMENT_ES: Record<string, string> = {
  Acting: "Actuación",
  Directing: "Dirección",
  Production: "Producción",
  Writing: "Guion",
  Crew: "Equipo",
  Editing: "Edición",
  Camera: "Fotografía",
  Art: "Arte",
  Sound: "Sonido",
  "Visual Effects": "Efectos visuales",
  "Costume & Make-Up": "Vestuario",
  Lighting: "Iluminación",
};

function buildKeyboardKeys(mode: KbMode): KbKey[] {
  const prefix = mode === "ABC" ? "abc" : "numbers";
  const rows: string[][] =
    mode === "ABC"
      ? [
          ["a", "b", "c", "d", "e", "f"],
          ["g", "h", "i", "j", "k", "l"],
          ["m", "n", "ñ", "o", "p", "q"],
          ["r", "s", "t", "u", "v", "w"],
          ["x", "y", "z"],
        ]
      : [
          ["1", "2", "3", "4", "5", "6"],
          ["7", "8", "9", "0", ".", "-"],
          ["@", "#", "&", "_", "/", ":"],
        ];
  const keys: KbKey[] = [
    { id: "tab-abc", label: "abc", row: 0, col: 0, span: 3, value: "", action: "MODE", mode: "ABC" },
    { id: "tab-123", label: "123", row: 0, col: 3, span: 3, value: "", action: "MODE", mode: "NUMBERS" },
  ];
  rows.forEach((rowLabels, rowIndex) => {
    rowLabels.forEach((label, col) => {
      keys.push({
        id: `${prefix}-${label}`,
        label,
        row: rowIndex + 1,
        col,
        span: 1,
        value: label,
        action: "INSERT",
      });
    });
  });
  const actionRow = rows.length + 1;
  keys.push({ id: "space", label: "ESPACIO", row: actionRow, col: 0, span: 2, value: "", action: "SPACE" });
  keys.push({ id: "delete", label: "Borrar", row: actionRow, col: 3, span: 1, value: "", action: "DELETE" });
  keys.push({ id: "clear", label: "BORRAR", row: actionRow, col: 4, span: 2, value: "", action: "CLEAR" });
  return keys;
}

function readStoredQuery(): string {
  try {
    return window.sessionStorage.getItem(QUERY_STORE_KEY) ?? "";
  } catch {
    return "";
  }
}

function normalizeSuggestion(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Sugerencias derivadas de los resultados (máx 8), como el ViewModel nativo.
function deriveAutocomplete(query: string, results: UnifiedSearchResult[]): string[] {
  const normalizedQuery = normalizeSuggestion(query);
  if (!normalizedQuery) return [];
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const result of results) {
    if (suggestions.length >= 8) break;
    const candidate = (result.name ?? "").split(" (")[0].trim();
    const normalizedCandidate = normalizeSuggestion(candidate);
    if (!candidate || normalizedCandidate === normalizedQuery) continue;
    let suggestion: string | undefined;
    if (normalizedCandidate.startsWith(normalizedQuery)) {
      suggestion = candidate;
    } else {
      suggestion = candidate
        .split(/\s+/)
        .find(word => normalizeSuggestion(word).startsWith(normalizedQuery));
    }
    if (!suggestion) continue;
    const key = normalizeSuggestion(suggestion);
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push(suggestion);
    }
  }
  return suggestions;
}

function mediaMeta(item: UnifiedSearchResult): string {
  return `${item.mediaLabel}${item.year ? ` · ${item.year}` : ""}`;
}

function personMeta(person: SearchPerson): string {
  const dept = DEPARTMENT_ES[person.department] ?? person.department;
  return dept ? `Persona · ${dept}` : "Persona";
}

const PERSON_IMG = "https://image.tmdb.org/t/p";
/** Tope de personas en la tab: 12 es lo que cabe cómodo en el grid de 3. */
const CAST_LIMIT = 12;
/** Elenco por título: los 4 primeros (= orden de facturación de TMDB). */
const CAST_PER_TITLE = 4;

interface TmdbCredits {
  cast?: Array<{ id: number; name: string; profile_path?: string | null; order?: number }>;
  crew?: Array<{ id: number; name: string; profile_path?: string | null; job?: string; jobs?: Array<{ job?: string }> }>;
}

function tmdbIdOf(item: UnifiedSearchResult): string | null {
  const fromExternal = item.externalIds?.tmdb;
  if (fromExternal) return fromExternal;
  return item.id.startsWith("tmdb:") ? item.id.slice(5) : null;
}

function toSearchPerson(
  entry: { id: number; name: string; profile_path?: string | null; popularity?: number },
  department: string,
): SearchPerson {
  return {
    id: entry.id,
    name: entry.name,
    photo: entry.profile_path ? `${PERSON_IMG}/w185${entry.profile_path}` : undefined,
    department,
    popularity: entry.popularity,
  };
}

/**
 * Reparto de UN resultado: actores principales y, detrás, sus directores.
 * `series`/`tv` van a /tv y el resto a /movie (mismo criterio que las tabs de
 * Películas/Series de esta page). Sin id de TMDB no hay credits que pedir.
 */
async function loadResultCast(item: UnifiedSearchResult): Promise<SearchPerson[]> {
  const tmdbId = tmdbIdOf(item);
  if (!tmdbId) return [];
  const segment = item.type === "series" || item.type === "tv" ? "tv" : "movie";
  const credits = await tmdbFetch<TmdbCredits>(`/${segment}/${tmdbId}/credits`, {
    params: { language: "es-ES" },
  });
  if (!credits) return [];
  // El cast de TMDB viene en orden de facturación, que es el "protagonista
  // primero" que se quiere; los directores van detrás, no mezclados.
  const actors = (credits.cast ?? [])
    .slice(0, CAST_PER_TITLE)
    .map(entry => toSearchPerson(entry, "Acting"));
  // En series hay un Director por episodio: dedupe por id y quédate con 2.
  const directors: SearchPerson[] = [];
  for (const entry of credits.crew ?? []) {
    const isDirector = entry.job === "Director" || entry.jobs?.some(job => job.job === "Director");
    if (!isDirector || directors.some(person => person.id === entry.id)) continue;
    directors.push(toSearchPerson(entry, "Directing"));
    if (directors.length >= 2) break;
  }
  return [...actors, ...directors];
}

/** Fusiona el reparto de varios resultados: primero el del más popular. */
function mergeCastPeople(casts: SearchPerson[][]): SearchPerson[] {
  const seen = new Set<number>();
  const merged: SearchPerson[] = [];
  for (const person of casts.flat()) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    merged.push(person);
    if (merged.length >= CAST_LIMIT) break;
  }
  return merged;
}

function scrollShellToTop() {
  document
    .querySelector<HTMLElement>("[data-aetherio-big-picture] [data-aetherio-scroll-shell]")
    ?.scrollTo({ top: 0, behavior: "auto" });
}

function focusKbKey(id: string) {
  document
    .querySelector<HTMLElement>(`[data-kb-key="${CSS.escape(id)}"]`)
    ?.focus({ preventScroll: true });
}

function focusSearchPrimaryFallback() {
  const primary = document.querySelector<HTMLElement>("[data-bp-search-primary]");
  const fallback = document.querySelector<HTMLElement>(".bp-search__tab.is-active");
  (primary ?? fallback)?.focus({ preventScroll: true });
}

// Fila horizontal de pósters a sangre (tabs Películas y Series).
function PosterRowPanel({
  section,
  items,
  emptyText,
  onOpen,
}: {
  section: string;
  items: UnifiedSearchResult[];
  emptyText: string;
  onOpen: (item: UnifiedSearchResult) => void;
}) {
  if (items.length === 0) {
    return <p className="bp-search__status">{emptyText}</p>;
  }
  return (
    <div data-row-key={section} data-row-count={items.length}>
      <div data-row-scroller className="bp-search__track--posters">
        {items.map((item, index) => (
          <button
            key={`${item.type}:${item.id}`}
            type="button"
            data-item-index={index}
            data-row-card
            data-bp-search-primary={index === 0 ? true : undefined}
            // El primer póster es la "izquierda" de la row: al pulsarla desde
            // aquí se vuelve al teclado. Sin este marcador, el motor espacial no
            // encuentra vecino a la izquierda (el teclado está oculto) y cae en
            // la regla de borde, que abre el rail lateral.
            data-kb-return={index === 0 ? true : undefined}
            className="bp-search__poster"
            aria-label={`${item.name ?? "Sin título"}${item.year ? `, ${item.year}` : ""}`}
            onClick={() => onOpen(item)}
          >
            {item.poster || item.background ? (
              <img
                src={item.poster ?? item.background}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ) : (
              <span className="bp-search__poster-fallback">{item.name ?? "Sin imagen"}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// Card de persona. Vive suelto porque se usa en dos sitios: la tab de reparto y
// el primer resultado de "Top resultados" cuando la query era un nombre.
function PersonResultCard({
  person,
  index,
  onOpen,
}: {
  person: SearchPerson;
  index: number;
  onOpen: (person: SearchPerson) => void;
}) {
  return (
    <button
      type="button"
      data-row-card
      data-kb-return={index % 3 === 0 ? true : undefined}
      data-bp-search-primary={index === 0 ? true : undefined}
      className="bp-search__card"
      onClick={() => onOpen(person)}
    >
      <span className="bp-search__thumb">
        {person.photo ? (
          <img
            src={person.photo}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : null}
      </span>
      <span className="bp-search__card-text">
        <span className="bp-search__card-title">{person.name}</span>
        <span className="bp-search__card-meta">{personMeta(person)}</span>
      </span>
    </button>
  );
}

// Panel de la tab "Reparto y equipo". Tiene su propio componente porque se
// pinta incluso SIN resultados de media: si la query es el nombre de un actor
// y no matchea ningún título, esta tab es la única forma de llegar a él.
function CastPanel({
  people,
  loading,
  fromResults,
  onOpen,
}: {
  people: SearchPerson[];
  loading: boolean;
  fromResults: boolean;
  onOpen: (person: SearchPerson) => void;
}) {
  if (loading) {
    return (
      <div className="bp-search__grid" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map(index => (
          <div key={index} className="bp-search__skeleton" />
        ))}
      </div>
    );
  }
  if (people.length === 0) {
    return (
      <p className="bp-search__status">
        {fromResults ? "Sin reparto para estos resultados." : "Sin resultados en reparto y equipo."}
      </p>
    );
  }
  return (
    <div className="bp-search__grid" data-bp-search-grid>
      {people.map((person, index) => (
        <PersonResultCard key={person.id} person={person} index={index} onOpen={onOpen} />
      ))}
    </div>
  );
}

export default function BigPictureSearch() {
  const navigate = useNavigate();
  const addons = useAddonStore(s => s.addons);
  const [query, setQuery] = useState(() => readStoredQuery());
  const [mode, setMode] = useState<KbMode>("ABC");
  const [keyboardVisible, setKeyboardVisible] = useState(true);
  const keyboardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [lastFocusId, setLastFocusId] = useState("abc-a");
  const [tab, setTab] = useState<SearchTab>("top");
  const [people, setPeople] = useState<SearchPerson[]>([]);
  // La persona que la query nombraba, si la nombraba. Va en "Top resultados"
  // como primer resultado: buscar "Tom Hanks" debe devolver a Tom Hanks, no
  // solo a películas con "Tom" en el título.
  const [nameMatch, setNameMatch] = useState<SearchPerson | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);

  const normalizedQuery = query.trim();
  const { results, loading, response } = useMediaSearch({
    query: normalizedQuery,
    mode: "full",
    addons,
    limit: 30,
    allowCorrection: false,
  });
  const autocomplete = useMemo(
    () => (keyboardVisible ? deriveAutocomplete(normalizedQuery, results) : []),
    [keyboardVisible, normalizedQuery, results],
  );
  // Películas incluye anime (las películas anime como Paprika/Ghibli viven
  // en el tipo "anime" del proveedor). Series cubre series + tv.
  const movies = useMemo(
    () => results.filter(item => item.type === "movie" || item.type === "anime"),
    [results],
  );
  const series = useMemo(
    () => results.filter(item => item.type === "series" || item.type === "tv"),
    [results],
  );

  const allProvidersError =
    !loading &&
    normalizedQuery.length > 0 &&
    results.length === 0 &&
    Object.values(response.providerStatus).filter(status => status.state !== "idle").length > 0 &&
    Object.values(response.providerStatus)
      .filter(status => status.state !== "idle")
      .every(status => status.state === "error");

  // "Reparto y equipo" tiene dos fuentes, y la primera decide:
  //
  // 1. Si la query RESUELVE A TÍTULO (el mejor resultado de la page tiene un
  //    tier de coincidencia alto), el reparto es el de los resultados que la
  //    page ya está mostrando: actores principales + directores. Es lo que
  //    espera alguien que busca "Nnn": el elenco de Nnn, no gente con un
  //    nombre parecido a "Nnn" (que es lo que devuelve /search/person con
  //    coincidencia difusa de TMDB: "Nnn", "st4nn"…).
  // 2. Solo si la query NO matchea ningún título (tier bajo o sin resultados)
  //    se busca persona, para que escribir el nombre de un actor sí lo
  //    encuentre: "Tom Hanks" no matchea títulos, y aquí sale él.
  const castFromResults = useMemo(
    () => results.length > 0 && (results[0].relevanceTier ?? 0) >= 3,
    [results],
  );
  // Solo los 3 primeros: son los más populares/rankeados de la page, y cada uno
  // es una petición de credits. Con 3 hay reparto aunque el primer resultado
  // no tenga elenco (documental, corto…).
  const castSourceItems = useMemo(() => (castFromResults ? results.slice(0, 3) : []), [castFromResults, results]);
  // `results` llega por snapshots (onSnapshot), así que su identidad cambia
  // varias veces por búsqueda. El efecto de abajo solo debe re-correr cuando
  // cambia la query o el conjunto de resultados, no con cada fragmento: si no,
  // el cleanup cancelaría el fetch en vuelo y el reparto nunca se pintaría.
  // Por eso la firma va en las deps y los items llegan por ref.
  const castSourceKey = castSourceItems.map(item => `${item.type}:${item.id}`).join("|");
  const castSourceRef = useRef(castSourceItems);
  castSourceRef.current = castSourceItems;

  useEffect(() => {
    try {
      window.sessionStorage.setItem(QUERY_STORE_KEY, query);
    } catch {
      // Best-effort.
    }
  }, [query]);

  // Reparto de la tab, con dos fuentes (ver castFromResults). Laidez por token
  // y NO con `cancelled` en el cleanup: en StrictMode el cleanup corre en el
  // doble montaje y se comería el único fetch bueno, dejando la tab vacía
  // para siempre. Con token, lo que llega tarde (búsqueda nueva) se descarta
  // por comparación y el request vigente siempre escribe.
  const castRequestRef = useRef(0);
  useEffect(() => {
    if (normalizedQuery.length < 2) {
      castRequestRef.current += 1;
      setPeople([]);
      setNameMatch(null);
      setPeopleLoading(false);
      return;
    }
    const token = (castRequestRef.current += 1);
    const stale = () => token !== castRequestRef.current;
    setPeople([]);
    setNameMatch(null);
    setPeopleLoading(true);
    const timer = window.setTimeout(() => {
      const sourceItems = castSourceRef.current;
      const land = (next: SearchPerson[], match: SearchPerson | null = null) => {
        if (stale()) return;
        setPeople(next);
        setNameMatch(match);
        setPeopleLoading(false);
      };
      // 1) La query matchea títulos: reparto de los resultados de la page.
      if (sourceItems.length > 0) {
        void Promise.all(sourceItems.map(loadResultCast))
          .then(casts => land(mergeCastPeople(casts)))
          .catch(() => land([]));
        return;
      }
      // 2) La query no matchea ningún título: es el nombre de alguien.
      void tmdbFetch<{
        results?: Array<{ id: number; name: string; profile_path?: string | null; known_for_department?: string; popularity?: number }>;
      }>(
        "/search/person",
        {
          params: {
            query: normalizedQuery,
            language: "es-ES",
            include_adult: "false",
            page: "1",
          },
        },
      )
        .then(data => {
          const entries = data?.results ?? [];
          const matches = entries.filter(entry => isNameMatch(entry.name, normalizedQuery));
          // La lista de la tab se queda con todos los que comparten nombre.
          // En "Top resultados" solo entra UNA, y solo si además es alguien de
          // verdad: si la query era el nombre de un actor, ese actor es el
          // primer resultado de la búsqueda, no un título cualquiera.
          const topMatch = pickTopNameMatch(entries, normalizedQuery);
          land(
            matches.slice(0, CAST_LIMIT).map(entry => toSearchPerson(entry, entry.known_for_department ?? "")),
            topMatch ? toSearchPerson(topMatch, topMatch.known_for_department ?? "") : null,
          );
        })
        .catch(() => land([]));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [normalizedQuery, castSourceKey]);

  const lastFocusIdRef = useRef(lastFocusId);
  lastFocusIdRef.current = lastFocusId;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const tabRefs = useRef(new Map<SearchTab, HTMLButtonElement>());

  // LB/RB del mando recorren las categorías (Top/Películas/Series/Reparto)
  // sin obligar a saltar tecla a tecla con la cruceta. Devuelve false si no
  // hay fila de tabs montada, para que LB/RB sigan cayendo en su
  // PageUp/PageDown sintético de siempre.
  //
  // El teclado NO se oculta aquí: las tabs conviven con él (es la fila de
  // categorías, se lee con el teclado al lado). Se oculta al BAJAR a las cards,
  // que es cuando el foco deja el teclado de verdad — lo resuelve spatialNav
  // con `data-kb-summon` hacia abajo.
  const moveTab = useCallback((delta: number) => {
    if (tabRefs.current.size === 0) return false;
    const current = Math.max(TABS.findIndex(item => item.key === tabRef.current), 0);
    const next = TABS[(current + delta + TABS.length) % TABS.length];
    setTab(next.key);
    // La fila vive arriba del contenido: sin esto, cambiar de categoría con
    // el scroll abajo dejaría el cambio y la tab enfocada fuera de vista.
    scrollShellToTop();
    tabRefs.current.get(next.key)?.focus({ preventScroll: true });
    return true;
  }, []);

  useEffect(() => {
    const onGamepadAction = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id !== "lb" && id !== "rb") return;
      // preventDefault reclama la acción: useGamepad no sintetiza PageUp/Down.
      if (moveTab(id === "rb" ? 1 : -1)) event.preventDefault();
    };
    // Respaldo de teclado: es la única forma de probarlo sin mando físico.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "PageUp" && event.key !== "PageDown") return;
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/i.test(target.tagName)) return;
      if (moveTab(event.key === "PageDown" ? 1 : -1)) event.preventDefault();
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [moveTab]);

  // Y del mando alterna el teclado ABC <-> 123 sin obligar a subir hasta las
  // pestañas. Si el teclado estaba oculto lo vuelve a mostrar (el cambio de
  // modo no se ve si no hay teclado) y deja el foco en la primera tecla del
  // modo nuevo: quien acaba de pedir "dame números" quiere escribir, no quedarse
  // parado sobre la pestaña.
  useEffect(() => {
    const onGamepadAction = (event: Event) => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id !== "y") return;
      const nextMode: KbMode = modeRef.current === "ABC" ? "NUMBERS" : "ABC";
      setKeyboardVisible(true);
      setLastFocusId(nextMode === "ABC" ? "abc-a" : "numbers-1");
      setMode(nextMode);
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
  }, []);

  const focusPrimaryContent = useCallback(() => {
    setKeyboardVisible(false);
    window.setTimeout(focusSearchPrimaryFallback, 80);
  }, []);

  // Puente del motor espacial (flechas del mando): show/hide del teclado.
  useEffect(() => {
    const onShow = () => {
      setKeyboardVisible(true);
      window.setTimeout(() => focusKbKey(lastFocusIdRef.current), 80);
    };
    const onHide = () => {
      setKeyboardVisible(false);
      window.setTimeout(focusSearchPrimaryFallback, 80);
    };
    window.addEventListener(BP_SEARCH_SHOW_KEYBOARD_EVENT, onShow);
    window.addEventListener(BP_SEARCH_HIDE_KEYBOARD_EVENT, onHide);
    return () => {
      window.removeEventListener(BP_SEARCH_SHOW_KEYBOARD_EVENT, onShow);
      window.removeEventListener(BP_SEARCH_HIDE_KEYBOARD_EVENT, onHide);
    };
  }, []);

  // Al abrir el teclado se vuelve arriba (el teclado es sticky: nunca
  // queda a medias tras el scroll).
  useEffect(() => {
    if (keyboardVisible) scrollShellToTop();
  }, [keyboardVisible, mode]);

  // El teclado NO se desmonta nunca: se queda en el DOM con ancho 0, `inert` y
  // `aria-hidden` mientras está fuera. Desmontarlo obligaría a esperar al final
  // de la salida para volver a montarlo, y en ese commit el elemento nace ya
  // con el ancho del CSS (300px), así que la entrada siguiente no tendría nada
  // que animar y saltaría igual. Siempre montado, el tween siempre tiene destino.
  useLayoutEffect(() => {
    const keyboardEl = keyboardRef.current;
    const bodyEl = bodyRef.current;
    if (!keyboardEl || !bodyEl) return;
    const shown = keyboardVisible;
    if (prefersReducedMotion()) {
      // Mover el grid no es decorativo: se coloca de golpe y solo se atenúa
      // el teclado.
      gsap.killTweensOf([keyboardEl, bodyEl]);
      gsap.set(keyboardEl, {
        flexBasis: shown ? KEYBOARD_WIDTH : 0,
        width: shown ? KEYBOARD_WIDTH : 0,
        opacity: shown ? 1 : 0,
        x: shown ? 0 : -KEYBOARD_SHIFT,
      });
      gsap.set(bodyEl, { columnGap: shown ? KEYBOARD_GAP : 0 });
      return;
    }
    const duration = KEYBOARD_MOVE_MS / 1000;
    gsap.to(keyboardEl, {
      flexBasis: shown ? KEYBOARD_WIDTH : 0,
      width: shown ? KEYBOARD_WIDTH : 0,
      opacity: shown ? 1 : 0,
      x: shown ? 0 : -KEYBOARD_SHIFT,
      duration,
      ease: "power4.out",
      overwrite: "auto",
    });
    gsap.to(bodyEl, {
      columnGap: shown ? KEYBOARD_GAP : 0,
      duration,
      ease: "power4.out",
      overwrite: "auto",
    });
  }, [keyboardVisible]);

  useEffect(() => () => {
    if (keyboardRef.current && bodyRef.current) gsap.killTweensOf([keyboardRef.current, bodyRef.current]);
  }, []);

  // Al cambiar de modo, foco a la última tecla o al fallback (70ms nativo).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ids = new Set(buildKeyboardKeys(mode).map(key => key.id));
      const fallback = mode === "ABC" ? "abc-a" : "numbers-1";
      focusKbKey(ids.has(lastFocusIdRef.current) ? lastFocusIdRef.current : fallback);
    }, 70);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // El teclado físico también escribe (adaptación desktop).
  // Borrar/X del mando lo gestiona useTextBackAction (acción central).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName)) return;
      if (event.key === "Backspace") return;
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        setQuery(current => (current === "" || current.endsWith(" ") ? current : `${current} `));
        return;
      }
      if (event.key.length === 1 && /[a-zA-Z0-9ñÑáéíóúüÁÉÍÓÚÜ@#&_/:\.\-]/.test(event.key)) {
        setQuery(current => current + event.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const append = useCallback((value: string) => {
    if (value) setQuery(current => current + value);
  }, []);
  const addSpace = useCallback(() => {
    setQuery(current => (current === "" || current.endsWith(" ") ? current : `${current} `));
  }, []);
  const deleteLast = useCallback(() => {
    setQuery(current => current.slice(0, -1));
  }, []);
  const clear = useCallback(() => {
    setQuery("");
  }, []);

  // Borrar físico y X del mando borran el último carácter mientras haya texto.
  // B/Esc ya no borran: retroceden siempre (lo gestiona el back de
  // BigPicturePage). Acción central.
  useTextBackAction({ hasText: query.length > 0, onDeleteChar: deleteLast });

  const openResult = useCallback(
    (item: UnifiedSearchResult) => {
      writeDetailMediaMeta(item);
      const params = new URLSearchParams({ fromSearch: "1" });
      if (normalizedQuery) params.set("q", normalizedQuery);
      navigate(buildDetailPath(item.type, item.id, params.toString()));
    },
    [navigate, normalizedQuery],
  );

  const openPerson = useCallback(
    (person: SearchPerson) => {
      navigate(buildPersonPath(person.id));
    },
    [navigate],
  );

  const keys = useMemo(() => buildKeyboardKeys(mode), [mode]);
  const rightEdgeIds = useMemo(() => {
    const byRow = new Map<number, KbKey[]>();
    for (const key of keys) {
      const group = byRow.get(key.row) ?? [];
      group.push(key);
      byRow.set(key.row, group);
    }
    return new Set(
      [...byRow.values()].map(rowKeys =>
        rowKeys.reduce((a, b) => (a.col + a.span > b.col + b.span ? a : b)).id,
      ),
    );
  }, [keys]);
  const letterRows = useMemo(() => {
    const byRow = new Map<number, KbKey[]>();
    for (const key of keys) {
      if (key.action === "MODE") continue;
      const group = byRow.get(key.row) ?? [];
      group.push(key);
      byRow.set(key.row, group);
    }
    return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, rowKeys]) => rowKeys);
  }, [keys]);
  const actionRowKeys = useMemo(() => {
    const isAction = (key: KbKey) =>
      key.action === "SPACE" || key.action === "DELETE" || key.action === "CLEAR";
    return keys
      .filter(isAction)
      .sort((a, b) => a.col - b.col || a.row - b.row);
  }, [keys]);

  return (
    <div
      className="bp-search"
      data-bp-search-kb={keyboardVisible ? "visible" : "hidden"}
      data-kb-last={lastFocusId}
    >
      <h1 className="bp-search__title">{normalizedQuery || "Buscar"}</h1>

      <div className="bp-search__body" ref={bodyRef}>
        <div
          ref={keyboardRef}
          className="bp-search__keyboard"
          // Oculto pero NO desmontado: sale con `inert` para que nada lo pueda
          // enfocar y con `aria-hidden` para que el motor espacial lo saque de
          // sus candidatos (si no, la cruceta podría volver a una tecla que ya
          // se está yendo).
          inert={!keyboardVisible}
          aria-hidden={!keyboardVisible}
          aria-label="Teclado en pantalla"
        >
          <div className="bp-search__kb-tabs" role="tablist" aria-label="Modo de teclado">
            {(["ABC", "NUMBERS"] as const).map(tabMode => (
              <button
                key={tabMode}
                type="button"
                data-kb-key={tabMode === "ABC" ? "tab-abc" : "tab-123"}
                data-kb-edge={tabMode === "NUMBERS" ? "right" : undefined}
                className={
                  mode === tabMode ? "bp-search__kb-tab is-active" : "bp-search__kb-tab"
                }
                onFocus={() =>
                  setLastFocusId(tabMode === "ABC" ? "tab-abc" : "tab-123")
                }
                onClick={() => {
                  setLastFocusId(tabMode === "ABC" ? "tab-abc" : "tab-123");
                  setMode(tabMode);
                }}
              >
                {tabMode === "ABC" ? "abc" : "123"}
              </button>
            ))}
          </div>
          {letterRows.map(rowKeys => (
            <div key={rowKeys[0].row} className="bp-search__kb-row">
              {rowKeys
                .filter(key => key.action === "INSERT")
                .map(key => (
                  <button
                    key={key.id}
                    type="button"
                    data-kb-key={key.id}
                    data-kb-edge={rightEdgeIds.has(key.id) ? "right" : undefined}
                    className="bp-search__kb-key"
                    onFocus={() => setLastFocusId(key.id)}
                    onClick={() => {
                      setLastFocusId(key.id);
                      append(key.value);
                    }}
                  >
                    {key.label}
                  </button>
                ))}
            </div>
          ))}
          <div className="bp-search__kb-actionrow">
            {actionRowKeys.map(key => {
              if (key.action === "DELETE") {
                return (
                  <button
                    key={key.id}
                    type="button"
                    data-kb-key={key.id}
                    aria-label="Borrar último carácter"
                    className="bp-search__kb-del"
                    onFocus={() => setLastFocusId(key.id)}
                    onClick={() => {
                      setLastFocusId(key.id);
                      deleteLast();
                    }}
                  >
                    ⌫
                  </button>
                );
              }
              return (
                <button
                  key={key.id}
                  type="button"
                  data-kb-key={key.id}
                  data-kb-edge={rightEdgeIds.has(key.id) ? "right" : undefined}
                  className="bp-search__kb-text"
                  onFocus={() => setLastFocusId(key.id)}
                  onClick={() => {
                    setLastFocusId(key.id);
                    if (key.action === "SPACE") addSpace();
                    else clear();
                  }}
                >
                  {key.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bp-search__content">
          {normalizedQuery === "" ? (
            <p className="bp-search__hint">Escribe para buscar películas, series y personas.</p>
          ) : (
            <div>
              <div className="bp-search__tabs" role="tablist" aria-label="Categorías de búsqueda">
                <span className="bp-search__rule" aria-hidden="true" />
                {TABS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    ref={node => {
                      if (node) tabRefs.current.set(item.key, node);
                      else tabRefs.current.delete(item.key);
                    }}
                    aria-selected={tab === item.key}
                    data-kb-summon
                    className={tab === item.key ? "bp-search__tab is-active" : "bp-search__tab"}
                    onClick={() => setTab(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
                <span className="bp-search__rule" aria-hidden="true" />
              </div>

              {autocomplete.length > 0 && (
                <div data-row-key="suggestions" data-row-count={autocomplete.length}>
                  <div data-row-scroller className="bp-search__suggest">
                    {autocomplete.map((suggestion, index) => (
                      <button
                        key={suggestion}
                        type="button"
                        data-item-index={index}
                        data-row-card
                        data-kb-return={index === 0 ? true : undefined}
                        data-bp-search-primary={index === 0 ? true : undefined}
                        className="bp-search__sug"
                        onClick={() => {
                          setQuery(suggestion);
                          focusPrimaryContent();
                        }}
                      >
                        <span className="bp-search__sug-icon" aria-hidden="true">
                          ⌕
                        </span>
                        <span className="bp-search__sug-text">{suggestion}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {loading && results.length === 0 ? (
                <div className="bp-search__grid" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5].map(index => (
                    <div key={index} className="bp-search__skeleton" />
                  ))}
                </div>
              ) : allProvidersError ? (
                <p className="bp-search__status">Error de red. Verifica tu conexión.</p>
              ) : results.length > 0 ? (
                <div>
                  {autocomplete.length > 0 && <div className="bp-search__divider" />}
                  {tab === "top" && (
                    <div className="bp-search__grid" data-bp-search-grid>
                      {nameMatch && (
                        <PersonResultCard person={nameMatch} index={0} onOpen={openPerson} />
                      )}
                      {results.map((item, index) => (
                        <button
                          key={`${item.type}:${item.id}`}
                          type="button"
                          data-row-card
                          data-kb-return={(index + (nameMatch ? 1 : 0)) % 3 === 0 ? true : undefined}
                          data-bp-search-primary={index === 0 && !nameMatch ? true : undefined}
                          className="bp-search__card"
                          onClick={() => openResult(item)}
                        >
                          <span className="bp-search__thumb">
                            {item.poster || item.background ? (
                              <img
                                src={item.poster ?? item.background}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                draggable={false}
                              />
                            ) : null}
                          </span>
                          <span className="bp-search__card-text">
                            <span className="bp-search__card-title">
                              {item.name ?? "Sin título"}
                            </span>
                            <span className="bp-search__card-meta">{mediaMeta(item)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {tab === "movies" && (
                    <PosterRowPanel
                      section="movies"
                      items={movies}
                      emptyText={`Sin películas para “${normalizedQuery}”.`}
                      onOpen={openResult}
                    />
                  )}
                  {tab === "series" && (
                    <PosterRowPanel
                      section="series"
                      items={series}
                      emptyText={`Sin series para “${normalizedQuery}”.`}
                      onOpen={openResult}
                    />
                  )}
                  {tab === "cast" && (
                    <CastPanel
                      people={people}
                      loading={peopleLoading}
                      fromResults={castFromResults}
                      onOpen={openPerson}
                    />
                  )}
                </div>
              ) : nameMatch && tab !== "cast" ? (
                // La query no matcheó ningún título pero sí es el nombre de
                // alguien: en "Top resultados" sale esa persona, no un "sin
                // resultados" que contradice lo que el usuario ha buscado.
                <div className="bp-search__grid">
                  <PersonResultCard person={nameMatch} index={0} onOpen={openPerson} />
                </div>
              ) : tab === "cast" ? (
                // Sin media: la query era el nombre de alguien. Esta tab sigue
                // viva y hace su propia búsqueda de personas.
                <CastPanel
                  people={people}
                  loading={peopleLoading}
                  fromResults={false}
                  onOpen={openPerson}
                />
              ) : (
                <p className="bp-search__status">Sin resultados para “{normalizedQuery}”.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
