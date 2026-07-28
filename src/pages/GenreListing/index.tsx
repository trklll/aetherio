import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import { tmdbFetch } from "../../config/apiKeys";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { useProfileGradient } from "../../hooks/useProfileGradient";
import { gsap } from "../../utils/motion";
import { readPageDataCache, writePageDataCache } from "../../utils/pageDataCache";
import type { MediaItem } from "../../types/ui";

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

export default function GenreListingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const genre = params.get("genre") ?? "";
  const { gradient } = useProfileGradient();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollShellRef = useRef<HTMLElement | null>(null);
  const restoredScrollRef = useRef(false);

  useEffect(() => {
    if (gradient) {
      document.documentElement.style.setProperty("--aetherio-page-bg", gradient);
    }
    return () => {
      document.documentElement.style.removeProperty("--aetherio-page-bg");
    };
  }, [gradient]);

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

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    scrollShellRef.current = shell;
    if (!shell || restoredScrollRef.current) return;
    const saved = genre ? readPageDataCache<number>("genre-scroll", genre) : null;
    if (typeof saved === "number" && saved > 0) {
      shell.scrollTo({ top: saved, behavior: "instant" as ScrollBehavior });
      restoredScrollRef.current = true;
    }
  }, [genre]);

  useEffect(() => {
    const shell = scrollShellRef.current;
    if (!shell || !genre) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        writePageDataCache("genre-scroll", genre, shell.scrollTop);
      });
    };
    shell.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      shell.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [genre]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || isLoading) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(":scope > *"));
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline.fromTo(
      items,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.055, clearProps: "transform" },
    );
    return () => {
      timeline.kill();
      gsap.set(items, { clearProps: "opacity,transform" });
    };
  }, [isLoading, items]);

  const displayTitle = GENRE_LABELS[genre] ?? genre;

  return (
    <PageContainer>
      <div ref={rootRef} className="relative flex min-h-full flex-col" style={{ padding: "24px var(--app-safe-x) 56px" }}>
        <div style={{ marginBottom: 26, display: "flex", alignItems: "center", gap: 14 }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Volver"
            title="Volver"
            style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.08)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <ChevronLeft size={19} />
          </button>
          <div style={{ textAlign: "center", flex: 1 }}>
            <h1 style={{ fontSize: 32, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>{displayTitle}</h1>
            <p style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.46)" }}>
              {isLoading ? "Cargando..." : `${items.length} animes`}
            </p>
          </div>
          <div style={{ width: 40, flexShrink: 0 }} />
        </div>

        {!isLoading && items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.4)", fontSize: 15 }}>
            No se encontraron animes para este género.
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 180px))",
            gap: 14,
            alignItems: "start",
            justifyContent: "center",
          }}
        >
          {items.map((item, index) => (
            <GridCard key={`${item.id}-${index}`} item={item} />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

function GridCard({ item }: { item: MediaItem }) {
  const navigate = useNavigate();
  const image = item.poster ?? item.background ?? "";
  const [resolving, setResolving] = useState(false);

  const openDetail = async () => {
    if (resolving) return;
    setResolving(true);
    const tmdbId = await resolveTmdbId(item.name);
    const detailId = tmdbId ?? item.id;
    writeDetailMediaMeta({
      id: detailId,
      type: "anime",
      name: item.name,
      description: item.description,
      year: item.year,
    });
    navigate(`/detail/anime/${encodeURIComponent(detailId)}`);
  };

  return (
    <div style={{ width: 180 }}>
      <button
        type="button"
        onClick={openDetail}
        disabled={resolving}
        style={{ position: "relative", width: 180, height: 271, borderRadius: 10, overflow: "hidden", background: "#1c1c1e", border: "none", padding: 0, cursor: resolving ? "wait" : "pointer", textAlign: "left", opacity: resolving ? 0.6 : 1, transition: "opacity 0.2s" }}
      >
        {image ? (
          <img src={image} alt={item.name} loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : null}
      </button>
      <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
        {item.name}
      </div>
    </div>
  );
}
