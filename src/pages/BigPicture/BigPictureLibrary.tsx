import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Camera,
  CircleCheck,
  Compass,
  Drama,
  Film,
  Gem,
  Globe,
  Heart,
  History,
  Laugh,
  Music,
  Orbit,
  Palette,
  Rocket,
  Sparkle,
  Sparkles,
  Star,
  Tag,
  Trophy,
  Tv,
} from "lucide-react";
import LibraryIcon from "../../components/ui/LibraryIcon";
import { ANILIST_LIBRARY_CHANGED_EVENT, readAniListLibrary } from "../../integrations/aniList";
import { buildDetailPath } from "../../utils/bigPictureDetail";
import {
  CONTINUE_WATCHING_EVENT,
  readPlaybackStateEntries,
} from "../../utils/continueWatching";
import { LIBRARY_CHANGED_EVENT, readSavedLibrary } from "../../utils/library";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { buildLibraryItems, getLibraryPoster, type LibraryItem } from "../Library/libraryLogic";
import "./BigPictureLibrary.css";

/** Un icono de la navegación: de lucide (forwardRef) o propio (función normal). */
type NavIcon = ComponentType<{ size?: number; className?: string }>;

/**
 * Biblioteca en Big Picture — port del diseño de la Library de referencia
 * (ANALYSIS §1) a la superficie 10-foot de aetherio.
 *
 * - Canvas y estructura vienen de la referencia; el TAMAÑO viene de las páginas
 *   10-foot que ya existen (rail: fila 60px, label 19px/700, icono 26px;
 *   .bp-row__title: 20px/700), porque los 15px de la captura de escritorio se
 *   leían diminutos al lado del Home/Detail. Ver ANALYSIS §9.
 * - No hay breadcrumb: la pill del rail ya dice "Biblioteca" y la segunda
 *   pastilla repetía el mismo nombre 40px más abajo.
 * - Las filas de la navegación son facetas reales de `buildLibraryItems`
 *   (ANALYSIS §4): la referencia trae "4K HDR" y "Family Sharing", que aetherio
 *   no tiene ni puede tener (no hay compras ni hogar compartido, y `MediaItem`
 *   no tiene campo de calidad), así que apuntan a "Mi lista" y "Ya vistos".
 * - El foco NO necesita `spatialNav`: el grid no lleva `data-row-key` ni
 *   `data-spatial-grid`, así que el motor cae a geometría pura. Con la columna
 *   de filtros pegada, ← desde el primer póster la encuentra, ↑ desde la
 *   primera fila sube a la cabecera de la page y ← en el borde abre el rail.
 */
export default function BigPictureLibrary() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion(value => value + 1);
    window.addEventListener(CONTINUE_WATCHING_EVENT, refresh);
    window.addEventListener(ANILIST_LIBRARY_CHANGED_EVENT, refresh);
    window.addEventListener(LIBRARY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CONTINUE_WATCHING_EVENT, refresh);
      window.removeEventListener(ANILIST_LIBRARY_CHANGED_EVENT, refresh);
      window.removeEventListener(LIBRARY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const items = useMemo(() => {
    const saved = readSavedLibrary();
    const playback = readPlaybackStateEntries();
    const aniList = readAniListLibrary();
    return buildLibraryItems(saved, playback, aniList);
    // `version` es el reloj de refresco: las tres lecturas son de localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const rows = useMemo(() => buildLibraryRows(items), [items]);
  const [activeKey, setActiveKey] = useState<string>(() => TOP_ROWS[0].key);

  const activeRow = rows.find(row => row.key === activeKey) ?? rows[0];
  const visible = useMemo(() => {
    if (!activeRow) return [];
    return items.filter(item => matchesRow(item, activeRow.filter)).sort(sortAddedDesc);
  }, [activeRow, items]);

  return (
    <div className="bp-library" data-bp-library>
      <h1 className="bp-library__sr-title">Biblioteca</h1>
      <div className="bp-library__body">
        <LibraryNav rows={rows} activeKey={activeRow?.key ?? ""} onSelect={setActiveKey} />
        <div className="bp-library__results">
          {visible.length ? (
            <div className="bp-library__grid">
              {visible.map((item, index) => (
                <LibraryCard key={item.key} item={item} index={index} />
              ))}
            </div>
          ) : (
            /* Dos vacíos distintos, y no se pueden confundir: `items` decide si
               la biblioteca entera está vacía (las facetas existen siempre, así
               que preguntar por `rows` daba "no hay títulos en esta sección"
               incluso con la biblioteca en cero). */
            <p className="bp-library__status">
              {items.length ? "No hay títulos en esta sección." : "Tu biblioteca se llenará automáticamente."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Filas de la navegación ────────────────────────────────────────────── */

interface LibraryRow {
  key: string;
  label: string;
  /**
   * `NavIcon` y no `LucideIcon`: los iconos de lucide son `forwardRef` (llevan
   * `$$typeof`) pero `LibraryIcon` es un SVG propio, un componente de función
   * normal. Mismo apaño que en `BigPictureRail.tsx`: acepta ambos sin castear.
   */
  Icon: NavIcon;
  filter: LibraryFilter;
}

/** Sin faceta: todo, ordenado por "añadido recientemente" (la fila activa). */
type LibraryFilter =
  | { kind: "all" }
  | { kind: "type"; type: string }
  | { kind: "list"; listKey: string }
  | { kind: "genre"; aliases: readonly string[] };

const TOP_ROWS: readonly LibraryRow[] = [
  { key: "recent", label: "Añadidos recientemente", Icon: History, filter: { kind: "all" } },
  { key: "movie", label: "Películas", Icon: Film, filter: { kind: "type", type: "movie" } },
  { key: "series", label: "Series", Icon: Tv, filter: { kind: "type", type: "series" } },
  // "Mi lista" es la biblioteca guardada del usuario, así que lleva el mismo
  // glifo que el rail: una sola forma de decir "biblioteca" en toda la app.
  { key: "saved", label: "Mi lista", Icon: LibraryIcon, filter: { kind: "list", listKey: "saved" } },
  { key: "activity", label: "Ya vistos", Icon: CircleCheck, filter: { kind: "list", listKey: "activity" } },
];

/**
 * Los cinco géneros canónicos de la referencia.
 *
 * Los alias cubren las dos formas de escribir el mismo género que circulan en la
 * app: español (TMDB — `libraryLogic.ts` ya define "Acción y aventura",
 * "Ciencia ficción y fantasía", etc.) e inglés (addons y fichas guardadas que
 * traen la etiqueta cruda: "Action", "Sci-Fi", "Fantasy").
 *
 * OJO con el motivo: NO es AniList la que aporta los géneros.
 * `buildLibraryItems` fija `genres: ["Anime"]` para toda entrada de AniList
 * (libraryLogic.ts:145), así que sus etiquetas no son las que se ven aquí.
 */
const CANONICAL_GENRES: ReadonlyArray<{ label: string; Icon: NavIcon; aliases: readonly string[] }> = [
  {
    label: "Acción y aventura",
    Icon: Sparkles,
    aliases: ["Acción y aventura", "Acción", "Aventura", "Action", "Adventure"],
  },
  { label: "Comedia", Icon: Laugh, aliases: ["Comedia", "Comedy"] },
  { label: "Drama", Icon: Drama, aliases: ["Drama"] },
  { label: "Animación", Icon: Sparkle, aliases: ["Animación", "Animation"] },
  {
    label: "Ciencia ficción y fantasía",
    Icon: Orbit,
    aliases: [
      "Ciencia ficción y fantasía",
      "Ciencia ficción",
      "Fantasía",
      "Sci-Fi",
      "Sci-Fi & Fantasy",
      "Fantasy",
    ],
  },
];

const LEADING_ARTICLE = /^(the|an|a|el|la|los|las|un|una)\s+/i;

function buildLibraryRows(items: LibraryItem[]): LibraryRow[] {
  const rows: LibraryRow[] = [...TOP_ROWS];

  for (const genre of CANONICAL_GENRES) {
    rows.push({
      key: `genre:${normalizeGenre(genre.label)}`,
      label: genre.label,
      Icon: genre.Icon,
      filter: { kind: "genre", aliases: genre.aliases },
    });
  }

  // Géneros extra: cualquiera presente en la biblioteca que ningún canónico
  // cubre ya, para que no quede nada fuera de alcance de la navegación.
  const covered = new Set(CANONICAL_GENRES.flatMap(genre => genre.aliases.map(normalizeGenre)));
  const extras = new Map<string, string>();
  for (const item of items) {
    for (const raw of item.media.genres ?? []) {
      const label = raw.trim();
      if (!label) continue;
      const key = normalizeGenre(label);
      if (key && !covered.has(key) && !extras.has(key)) extras.set(key, label);
    }
  }

  // Un extra no puede repetir un icono de las filas de arriba ("Familia" cayendo
  // en Film se leía como la misma fila que "Películas") ni repetir uno de otro
  // extra ("Misterio" y "Suspenso" salían ambos con Palette y parecían un error
  // de render). Barrido con ocupación desde el índice del hash, no módulo: con
  // más extras que huecos el módulo reintroducía las colisiones (con 14,
  // Policial y Thriller salían los dos con Trophy).
  const taken = new Set<NavIcon>([
    ...TOP_ROWS.map(row => row.Icon),
    ...CANONICAL_GENRES.map(genre => genre.Icon),
  ]);
  const pool = EXTRA_GENRE_ICONS.filter(Icon => !taken.has(Icon));
  const used = new Set<NavIcon>();
  const ordered = [...extras].sort((a, b) => titleKey(a[1]).localeCompare(titleKey(b[1]), "es"));

  for (const [key, label] of ordered) {
    const start = extraGenreIndex(label, pool.length);
    let Icon = pool[start];
    if (used.has(Icon)) Icon = pool.find(candidate => !used.has(candidate)) ?? Icon;
    used.add(Icon);
    rows.push({
      key: `genre:${key}`,
      label,
      Icon,
      filter: { kind: "genre", aliases: [label] },
    });
  }
  return rows;
}

/**
 * Los géneros extra no tienen icono diseñado —no hay referencia para ellos— así
 * que se reparten dentro de un pool de glifos neutros, en orden alfabético y
 * sin repetir uno ya usado. El hash del nombre sólo fija el punto de partida,
 * para que dos bibliotecas distintas no repartan el pool de otra forma.
 */
const EXTRA_GENRE_ICONS: readonly NavIcon[] = [
  Tag, Star, Heart, Music, Camera, BookOpen, Palette, Globe, Trophy, Rocket, Gem, Compass,
];

function extraGenreIndex(label: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % length;
}

function LibraryNav({
  rows,
  activeKey,
  onSelect,
}: {
  rows: LibraryRow[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [indicatorY, setIndicatorY] = useState(0);

  const activeIndex = Math.max(0, rows.findIndex(row => row.key === activeKey));
  const indicatorIndex = cursor ?? activeIndex;
  // El índice puede quedar atrás si la biblioteca pierde la última faceta que
  // estaba seleccionada (p. ej. se vacía "Ya vistos").
  const safeIndicator = Math.min(indicatorIndex, Math.max(0, rows.length - 1));

  // El pill indicador se posiciona con la medida real de la fila, no con
  // aritmética: el bloque de géneros cambia de alto según la biblioteca.
  useLayoutEffect(() => {
    const row = rowRefs.current[safeIndicator];
    const host = rowsRef.current;
    if (!row || !host) return;
    setIndicatorY(row.getBoundingClientRect().top - host.getBoundingClientRect().top);
  }, [rows.length, safeIndicator]);

  // Foco de entrada en la fila seleccionada. NO es un timer fijo: el arranque de
  // la app mantiene #root en visibility:hidden hasta ~2s (medido), y con un
  // ancestro oculto el focus() es un no-op silencioso. Se reintenta por frames
  // hasta que el foco agarra, con tope.
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const MAX_TRIES = 150;
    const tryFocus = () => {
      const row = rowRefs.current[activeIndex];
      if (row) {
        row.focus({ preventScroll: true });
        if (document.activeElement === row) return;
      }
      if (tries++ < MAX_TRIES) frame = requestAnimationFrame(tryFocus);
    };
    frame = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(frame);
    // Solo al entrar: cambiar de filtro después no debe robar el foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sólo Home/End. Las flechas NO se tocan aquí a propósito: spatialNav las
  // atiende en fase capture sobre window y hace stopPropagation, así que un
  // onKeyDown de React nunca las ve — un handler de flechas en este componente
  // sería código muerto que además documenta un wrap que nunca ocurre.
  // spatialNav mueve por geometría, que es justo lo que se quiere aquí.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : rows.length - 1;
    setCursor(next);
    const row = rowRefs.current[next];
    if (!row) return;
    // Sin preventScroll: con una lista de géneros larga (medido: nav de 1056px
    // en un viewport de 888px) Home/End con preventScroll dejaban el foco fuera
    // de pantalla, enfocado pero invisible y sin pill a la vista.
    row.focus();
    row.scrollIntoView({ block: "nearest" });
  };

  const firstGenre = rows.findIndex(row => row.key.startsWith("genre:"));

  return (
    <nav className="bp-library__nav" aria-label="Secciones de la biblioteca">
      <div ref={rowsRef} className="bp-library__rows" onKeyDown={onKeyDown}>
        <div
          className="bp-library__indicator"
          style={{ transform: `translateY(${indicatorY}px)` }}
          aria-hidden="true"
        />
        {rows.map((row, index) => {
          const RowIcon = row.Icon;
          const focused = indicatorIndex === index;
          return (
            <div className="bp-library__slot" key={row.key}>
              {firstGenre >= 0 && index === firstGenre ? (
                <p className="bp-library__section">Géneros</p>
              ) : null}
              <button
                ref={el => {
                  rowRefs.current[index] = el;
                }}
                type="button"
                className={`bp-library__row${focused ? " is-focused" : ""}`}
                tabIndex={index === activeIndex ? 0 : -1}
                aria-current={index === activeIndex ? "true" : undefined}
                onFocus={() => setCursor(index)}
                onMouseEnter={() => setCursor(index)}
                onMouseLeave={() => setCursor(null)}
                onClick={() => {
                  onSelect(row.key);
                  setCursor(null);
                }}
              >
                <span className="bp-library__row-icon">
                  <RowIcon size={26} />
                </span>
                <span className="bp-library__row-label">{row.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/* ─── Filtrado ──────────────────────────────────────────────────────────── */

function matchesRow(item: LibraryItem, filter: LibraryFilter): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "type":
      return normalizeType(item.media.type) === filter.type;
    case "list":
      return item.listKey === filter.listKey;
    case "genre": {
      const wanted = new Set(filter.aliases.map(normalizeGenre));
      return (item.media.genres ?? []).some(genre => wanted.has(normalizeGenre(genre)));
    }
  }
}

function sortAddedDesc(a: LibraryItem, b: LibraryItem) {
  return b.addedAt - a.addedAt || titleKey(a.media.name).localeCompare(titleKey(b.media.name), "es");
}

function normalizeType(type: string) {
  const normalized = type.toLowerCase();
  return normalized === "tv" || normalized === "show" || normalized === "anime" ? "series" : normalized;
}

function normalizeGenre(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

function titleKey(value: string) {
  return value.trim().replace(LEADING_ARTICLE, "").toLocaleLowerCase("es");
}

/* ─── Card de póster ────────────────────────────────────────────────────── */

function LibraryCard({ item, index }: { item: LibraryItem; index: number }) {
  const navigate = useNavigate();
  const media = item.media;
  const type = normalizeType(media.type);
  const [failed, setFailed] = useState(false);
  const poster = getLibraryPoster(media);

  useEffect(() => {
    setFailed(false);
  }, [poster]);

  const openDetail = useCallback(() => {
    writeDetailMediaMeta({
      id: media.id,
      type,
      name: media.name,
      poster,
      background: media.background,
      logo: media.logo,
      description: media.description,
      year: media.year,
    });
    navigate(buildDetailPath(type, media.id, undefined, "/big-picture"));
  }, [media, navigate, type]);

  return (
    <div
      className="bp-library__cell"
      style={{ ["--bp-library-i" as string]: Math.min(index, 11) }}
    >
      <button
        type="button"
        className="bp-library__poster"
        aria-label={`${media.name}${media.year ? `, ${media.year}` : ""}`}
        title={media.name}
        onClick={openDetail}
      >
        {poster && !failed ? (
          <img
            src={poster}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="bp-library__fallback">{media.name}</span>
        )}
      </button>
    </div>
  );
}
