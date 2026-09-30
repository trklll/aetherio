import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { tmdbFetch } from "../../config/apiKeys";
import { buildDetailPath } from "../../utils/bigPictureDetail.ts";
import { tweenTo } from "../../utils/motion.ts";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { readPageDataCache, writePageDataCache } from "../../utils/pageDataCache";
import type { MediaItem } from "../../types/ui.ts";
import "./BigPictureGenre.css";

const GENRE_LABELS: Record<string, string> = {
  Action: "Acción",
  Adventure: "Aventura",
  Comedy: "Comedia",
  Drama: "Drama",
  Fantasy: "Fantasía",
  Horror: "Horror",
  Mecha: "Mecha",
  Music: "Música",
  Psychological: "Psicológico",
  Romance: "Romance",
  "Sci-Fi": "Ciencia Ficción",
  "Slice of Life": "Slice of Life",
  Sports: "Deportes",
  Supernatural: "Sobrenatural",
  Thriller: "Suspenso",
};

interface AniListMedia {
  id: number;
  title: { romaji: string; english: string | null };
  coverImage: { large: string | null } | null;
  bannerImage: string | null;
  description: string | null;
  averageScore: number | null;
  genres: string[] | null;
  startDate: { year: number | null } | null;
  seasonYear: number | null;
}

function mediaToItem(media: AniListMedia): MediaItem {
  const name = media.title.english ?? media.title.romaji;
  const poster = media.coverImage?.large ?? undefined;
  const year = media.startDate?.year ?? media.seasonYear ?? undefined;
  return {
    id: `anilist:${media.id}`,
    type: "anime",
    name,
    poster,
    background: media.bannerImage ?? poster,
    description: media.description?.replace(/<[^>]*>/g, "") ?? undefined,
    year,
    genres: media.genres?.length ? media.genres : undefined,
    rating: media.averageScore != null ? String(media.averageScore) : undefined,
  };
}

const FIELDS = `id title { romaji english } coverImage { large } bannerImage description averageScore genres startDate { year } seasonYear`;

async function fetchGenrePage(genre: string, page: number): Promise<AniListMedia[]> {
  const r = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `query { Page(page: ${page}, perPage: 50) { media(genre: "${genre}", type: ANIME, sort: POPULARITY_DESC) { ${FIELDS} } } }`,
    }),
  });
  if (!r.ok) return [];
  const json = await r.json();
  return json?.data?.Page?.media ?? [];
}

async function fetchAllGenrePages(genre: string): Promise<MediaItem[]> {
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(page => fetchGenrePage(genre, page)),
  );
  const seen = new Set<string>();
  const collected: MediaItem[] = [];
  for (const page of results) {
    for (const m of page) {
      const id = `anilist:${m.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push(mediaToItem(m));
    }
  }
  return collected;
}

async function resolveTmdbId(name: string): Promise<string | null> {
  for (const type of ["tv", "movie"] as const) {
    const r = await tmdbFetch<{ results?: { id: number }[] }>(`/search/${type}`, {
      params: { query: name, language: "en-US", page: "1" },
    });
    const item = r?.results?.[0];
    if (item?.id) return `tmdb:${item.id}`;
  }
  return null;
}

function scrollShellToTop() {
  document
    .querySelector<HTMLElement>("[data-aetherio-big-picture] [data-aetherio-scroll-shell]")
    ?.scrollTo({ top: 0, behavior: "auto" });
}

/**
 * El buen espaciado header/techo solo existe con scrollTop === 0: en cuanto
 * se baja un poco, el título se pega al borde (segunda captura). Al volver
 * a la primera fila con el mando —o al soltar la rueda dentro de la zona
 * del header— se desliza suave al tope para recuperar ese aire.
 */
function snapTopIfFirstRow(el: HTMLElement) {
  const shell = document.querySelector<HTMLElement>(
    "[data-aetherio-big-picture] [data-aetherio-scroll-shell]",
  );
  const grid = el.closest<HTMLElement>(".bp-genre__grid");
  if (!shell || !grid) return;
  const gridTop = grid.getBoundingClientRect().top;
  const elTop = el.getBoundingClientRect().top;
  if (elTop - gridTop > 120) return; // no es la primera fila
  if (shell.scrollTop <= 0) return;
  // Tras el bringIntoView del motor espacial (corre justo después del
  // foco): este tween lo releva y deja el tope exacto.
  window.setTimeout(() => {
    tweenTo(shell, { scrollTop: 0 }, 0.28);
  }, 0);
}

/**
 * Género en Big Picture: misma lista de animes que /genre pero page
 * 10-foot dentro del chrome inmersivo (sin salir a la app normal).
 *
 * - Fondo sólido propio + padding bajo la pill (como Search/Party).
 * - Grid de pósters con foco = scale, sin outlines (navegación geométrica
 *   del motor espacial, sin data-row-key).
 * - El detalle usa buildDetailPath para quedarse en /big-picture/detail.
 * - B/Escape lo gestiona BigPicturePage (vuelve al Home picture).
 */
export default function BigPictureGenre() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const genre = params.get("genre") ?? "";
  const displayTitle = GENRE_LABELS[genre] ?? genre;

  // Misma caché que la page normal: si ya se visitó en PC, entra instantáneo.
  const cachedItems = genre ? readPageDataCache<MediaItem[]>("genre", genre) : null;
  const { data: items = cachedItems ?? [], isLoading } = useQuery({
    queryKey: ["genre-listing", genre],
    queryFn: async () => {
      const fetched = await fetchAllGenrePages(genre);
      writePageDataCache("genre", genre, fetched);
      return fetched;
    },
    enabled: !!genre,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    initialData: cachedItems ?? undefined,
  });

  // Al entrar (o cambiar de género), arriba del todo + foco al primer póster.
  useEffect(() => {
    scrollShellToTop();
  }, [genre]);

  // Rueda/arrastre: si el scroll reposa a medias sobre el header (título
  // pegado al techo), snap suave al tope. Solo actúa cerca de arriba.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(
      "[data-aetherio-big-picture] [data-aetherio-scroll-shell]",
    );
    if (!shell) return;
    let timer = 0;
    const SNAP_ZONE = 140;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (shell.scrollTop > 0 && shell.scrollTop < SNAP_ZONE) {
          tweenTo(shell, { scrollTop: 0 }, 0.25);
        }
      }, 150);
    };
    shell.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      shell.removeEventListener("scroll", onScroll);
    };
  }, [genre]);

  useEffect(() => {
    if (isLoading || items.length === 0) return;
    const t = window.setTimeout(() => {
      document.querySelector<HTMLElement>("[data-bp-genre-primary]")?.focus({ preventScroll: true });
    }, 70);
    return () => window.clearTimeout(t);
  }, [isLoading, items.length, genre]);

  return (
    <div className="bp-genre" data-bp-genre>
      <div className="bp-genre__header" key={genre}>
        <h1 className="bp-genre__title">{displayTitle || "Género"}</h1>
        <p className="bp-genre__subtitle">
          {isLoading ? "Cargando…" : `${items.length} animes`}
        </p>
      </div>

      {isLoading ? (
        <div className="bp-genre__grid" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="bp-genre__skeleton" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="bp-genre__status">No se encontraron animes para este género.</p>
      ) : (
        <div className="bp-genre__grid" key={genre}>
          {items.map((item, index) => (
            <GenreCard
              key={`${item.id}-${index}`}
              item={item}
              index={index}
              isPrimary={index === 0}
              onOpen={(detailId) => navigate(buildDetailPath("anime", detailId))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GenreCard({
  item,
  index,
  isPrimary,
  onOpen,
}: {
  item: MediaItem;
  index: number;
  isPrimary: boolean;
  onOpen: (detailId: string) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const image = item.poster ?? item.background ?? "";

  const openDetail = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      const tmdbId = await resolveTmdbId(item.name);
      const detailId = tmdbId ?? item.id;
      writeDetailMediaMeta({
        id: detailId,
        type: "anime",
        name: item.name,
        description: item.description,
        year: item.year,
      });
      onOpen(detailId);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div
      className="bp-genre__cell"
      style={{ ["--bp-genre-i" as string]: Math.min(index, 11) }}
    >
      <button
        type="button"
        data-bp-genre-primary={isPrimary ? true : undefined}
        className="bp-genre__poster"
        aria-label={`${item.name}${item.year ? `, ${item.year}` : ""}`}
        disabled={resolving}
        onFocus={event => snapTopIfFirstRow(event.currentTarget)}
        onClick={() => void openDetail()}
      >
        {image ? (
          <img src={image} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <span className="bp-genre__fallback">{item.name}</span>
        )}
      </button>
      <p className="bp-genre__name" title={item.name}>{item.name}</p>
    </div>
  );
}
