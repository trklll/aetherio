import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { tmdbFetch } from "../../config/apiKeys";
import { tweenTo, gsap } from "../../utils/motion";
import { readPageDataCache, writePageDataCache } from "../../utils/pageDataCache";
import { GENRE_SHOWCASE_MOVE_EVENT, useBigPictureActive } from "../../navigation/spatialNav.ts";

const ANILIST_URL = "https://graphql.anilist.co";
const POSTER_COUNT = 6;
const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy",
  "Horror", "Mecha", "Music", "Psychological",
  "Romance", "Sci-Fi", "Slice of Life", "Sports",
  "Supernatural", "Thriller",
];
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

interface GenreData {
  titles: string[];
  posters: (string | null)[];
  backdrop: string | null;
}

interface AnilistMedia {
  id: number;
  title: { romaji?: string; english?: string };
}

async function anilistTopN(genre: string, need: number, usedIds: Set<number>): Promise<{ titles: string[]; ids: number[] }> {
  const q = `query { Page(page: 1, perPage: 80) { media(genre: "${genre}", type: ANIME, sort: POPULARITY_DESC) { id title { romaji english } } } }`;
  try {
    const r = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: q }),
    });
    const json = await r.json();
    const all: AnilistMedia[] = json?.data?.Page?.media ?? [];

    const titles: string[] = [];
    const ids: number[] = [];
    const franchiseKeys = new Set<string>();

    for (const m of all) {
      if (titles.length >= need) break;
      if (usedIds.has(m.id)) continue;
      const t = m.title.romaji || m.title.english || "";
      if (!t) continue;

      const key = normalizeFranchiseKey(t);
      if (franchiseKeys.has(key)) continue;
      franchiseKeys.add(key);

      titles.push(t);
      ids.push(m.id);
    }
    return { titles, ids };
  } catch {
    return { titles: [], ids: [] };
  }
}

function normalizeFranchiseKey(title: string): string {
  let k = title
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  k = k
    .replace(/\b(season|part| cour| ova| ona| special| movie| film| theatrical| musical| Chronicle| recap| specials)\b/g, "")
    .replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\b/g, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return k;
}

async function searchTmdbPosters(title: string, usedPosters: Set<string>): Promise<string | null> {
  for (const type of ["tv", "movie"] as const) {
    const result = await tmdbFetch<{ results?: Array<{ poster_path?: string; genre_ids?: number[]; original_language?: string }> }>(
      `/search/${type}`, { params: { query: title, language: "en-US", page: "1", with_original_language: "ja" } },
    );
    const items = result?.results ?? [];
    for (const item of items) {
      if (!item?.poster_path) continue;
      const genreIds = item.genre_ids ?? [];
      if (!genreIds.includes(16)) continue;
      const url = `https://image.tmdb.org/t/p/w500${item.poster_path}`;
      if (usedPosters.has(url)) continue;
      usedPosters.add(url);
      return url;
    }
  }
  return null;
}

async function searchTmdbBackdrop(title: string, usedBackdrop: string | null): Promise<string | null> {
  for (const type of ["tv", "movie"] as const) {
    const result = await tmdbFetch<{ results?: Array<{ backdrop_path?: string; genre_ids?: number[]; original_language?: string }> }>(
      `/search/${type}`, { params: { query: title, language: "en-US", page: "1", with_original_language: "ja" } },
    );
    const items = result?.results ?? [];
    for (const item of items) {
      if (!item?.backdrop_path) continue;
      const genreIds = item.genre_ids ?? [];
      if (!genreIds.includes(16)) continue;
      const url = `https://image.tmdb.org/t/p/original${item.backdrop_path}`;
      if (usedBackdrop !== url) return url;
    }
  }
  return null;
}

async function fetchGenreData(
  genre: string,
  usedIds: Set<number>,
  usedPosters: Set<string>,
  usedBackdrops: Set<string>,
): Promise<GenreData> {
  const { titles, ids } = await anilistTopN(genre, 60, usedIds);
  ids.forEach(id => usedIds.add(id));

  const posters: (string | null)[] = [];
  let backdrop: string | null = null;

  for (const title of titles) {
    if (posters.length >= POSTER_COUNT && backdrop) break;
    if (posters.length < POSTER_COUNT) {
      const poster = await searchTmdbPosters(title, usedPosters);
      if (poster) posters.push(poster);
    }
    if (!backdrop) {
      const bd = await searchTmdbBackdrop(title, null);
      if (bd && !usedBackdrops.has(bd)) {
        usedBackdrops.add(bd);
        backdrop = bd;
      }
    }
  }

  while (posters.length < POSTER_COUNT) posters.push(null);

  return { titles, posters, backdrop };
}

function GenreShowcase() {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const posterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const checkOverlapRef = useRef<() => void>(() => {});
  const backdropRef = useRef(null);
  const labelTextRef = useRef(null);
  const bigPicture = useBigPictureActive();

  const cachedGenreMap = readPageDataCache<Record<string, GenreData>>("genre-showcase", "v4");
  const { data: genreMap = cachedGenreMap ?? {} } = useQuery({
    queryKey: ["genre-showcase", "v4"],
    queryFn: async () => {
      const map: Record<string, GenreData> = {};
      const usedIds = new Set<number>();
      const usedPosters = new Set<string>();
      const usedBackdrops = new Set<string>();
      for (const genre of GENRES) {
        const data = await fetchGenreData(genre, usedIds, usedPosters, usedBackdrops);
        map[genre] = data;
        await new Promise(r => setTimeout(r, 600));
      }
      writePageDataCache("genre-showcase", "v4", map);
      return map;
    },
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    initialData: cachedGenreMap ?? undefined,
  });

  const currentGenre = GENRES[activeIndex];
  const currentData = genreMap[currentGenre];

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const next = (activeIndex + 1) % GENRES.length;
       posterRefs.current.forEach(el => { if (el) tweenTo(el, { opacity: 0, y: 8 }, 0.25); });
       if (labelRef.current) tweenTo(labelRef.current, { opacity: 0, x: -12 }, 0.25);
       setTimeout(() => {
         setActiveIndex(next);
         gsap.set(posterRefs.current.filter(Boolean), { opacity: 0, y: 8 });
         if (labelRef.current) gsap.set(labelRef.current, { opacity: 0, x: -12 });
setTimeout(() => {
           posterRefs.current.forEach(el => { if (el) tweenTo(el, { opacity: 1, y: 0 }, 0.35); });
           if (labelRef.current) tweenTo(labelRef.current, { opacity: 1, x: 0 }, 0.4);
           requestAnimationFrame(() => checkOverlapRef.current());
         }, 50);
       }, 300);
     }, 6000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeIndex]);

  const handleClick = useCallback(() => {
    if (cardRef.current) tweenTo(cardRef.current, { scale: 0.985 }, 0.12);
    // En Big Picture la lista vive en /big-picture/genre (page 10-foot):
    // /genre saldría del modo inmersivo (App.tsx solo captura /big-picture).
    if (bigPicture) {
      navigate(`/big-picture/genre?genre=${encodeURIComponent(currentGenre)}`);
      return;
    }
    navigate(`/genre?genre=${encodeURIComponent(currentGenre)}`);
  }, [bigPicture, currentGenre, navigate]);

  const handleArrow = useCallback((direction: number) => {
    const next = (activeIndex + direction + GENRES.length) % GENRES.length;
    if (next === activeIndex) return;
    posterRefs.current.forEach(el => { if (el) tweenTo(el, { opacity: 0, y: 8 }, 0.25); });
    if (labelRef.current) tweenTo(labelRef.current, { opacity: 0, x: -12 }, 0.25);
    setTimeout(() => {
      setActiveIndex(next);
      gsap.set(posterRefs.current.filter(Boolean), { opacity: 0, y: 8 });
      if (labelRef.current) gsap.set(labelRef.current, { opacity: 0, x: -12 });
      setTimeout(() => {
        posterRefs.current.forEach(el => { if (el) tweenTo(el, { opacity: 1, y: 0 }, 0.35); });
        if (labelRef.current) tweenTo(labelRef.current, { opacity: 1, x: 0 }, 0.4);
        requestAnimationFrame(() => checkOverlapRef.current());
      }, 50);
    }, 300);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, [activeIndex]);

  useEffect(() => {
    if (!bigPicture) return;
    const onMove = (event: Event) => {
      const direction = (event as CustomEvent<{ direction?: "left" | "right" }>).detail?.direction;
      if (direction) handleArrow(direction === "right" ? 1 : -1);
    };
    window.addEventListener(GENRE_SHOWCASE_MOVE_EVENT, onMove);
    return () => window.removeEventListener(GENRE_SHOWCASE_MOVE_EVENT, onMove);
  }, [bigPicture, handleArrow]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const label = labelRef.current;
    if (!card || !label) return;

    const entries = posterRefs.current.filter(Boolean) as HTMLDivElement[];

    function checkOverlap() {
      const text = labelTextRef.current ?? label!;
      const labelRight = text.getBoundingClientRect().right + 12;
      for (const poster of entries) {
        const posterRect = poster.getBoundingClientRect();
        const collides = posterRect.left < labelRight;
        if (collides) {
          poster.style.visibility = "hidden";
          poster.style.pointerEvents = "none";
          gsap.set(poster, { opacity: 0 });
        } else {
          poster.style.visibility = "";
          poster.style.pointerEvents = "";
          gsap.to(poster, { opacity: 1, duration: 0.3, ease: "power2.out" });
        }
      }
    }

    checkOverlapRef.current = checkOverlap;

    const ro = new ResizeObserver(() => checkOverlap());
    ro.observe(card);
    ro.observe(label);
    if (labelTextRef.current) ro.observe(labelTextRef.current);
    entries.forEach(poster => ro.observe(poster));
    checkOverlap();
    return () => {
      ro.disconnect();
      checkOverlapRef.current = () => {};
    };
  }, [activeIndex, currentData]);

  useEffect(() => {
    const img = backdropRef.current;
    if (!img) return;
    gsap.killTweensOf(img);
    gsap.fromTo(
      img,
      { opacity: 0, scale: 1.14, filter: "blur(18px) brightness(0.35)" },
      {
        opacity: 1,
        scale: 1.1,
        filter: "blur(10px) brightness(0.5)",
        duration: 1.1,
        ease: "power2.out",
        overwrite: true,
      },
    );
  }, [activeIndex, currentData?.backdrop]);

  if (!currentData) return null;

  const hasPosters = currentData.posters.some(p => p);

  return (
    <section data-row-key="genre-showcase" data-row-count={1} style={{ paddingLeft: 48, paddingRight: 48, paddingTop: 8, paddingBottom: 28 }}>
      <div data-row-header style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: "var(--home-h, rgba(255,255,255,0.6))" }}>Explorar géneros - Anime</span>
      </div>
      <div
        ref={cardRef}
        onClick={handleClick}
        data-genre-showcase={bigPicture ? "true" : undefined}
        data-row-card
        data-item-index={0}
        aria-label={bigPicture ? `Explorar género ${GENRE_LABELS[currentGenre] ?? currentGenre}` : undefined}
        role={bigPicture ? "button" : undefined}
        tabIndex={bigPicture ? 0 : undefined}
        onKeyDown={bigPicture ? event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
          }
        } : undefined}
        onFocus={bigPicture ? event => {
          const card = event.currentTarget as HTMLDivElement;
          tweenTo(card, { scale: 1.012, y: -3, zIndex: 5 }, 0.28);
          gsap.set(card, { boxShadow: "0 22px 56px rgba(0,0,0,0.62)" });
        } : undefined}
        onBlur={bigPicture ? event => {
          const card = event.currentTarget as HTMLDivElement;
          tweenTo(card, { scale: 1, y: 0, zIndex: 1 }, 0.28);
          gsap.set(card, { boxShadow: "0 16px 48px rgba(0,0,0,0.5)" });
        } : undefined}
        style={{
          position: "relative",
          width: "100%",
          height: 340,
          borderRadius: 16,
          overflow: "hidden",
          cursor: "pointer",
          background: "#08090c",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
      >
        {currentData.backdrop ? (
          <>
            <img
              ref={backdropRef}
              src={currentData.backdrop}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "top",
                filter: "blur(10px) brightness(0.5)",
                willChange: "transform, opacity, filter",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(90deg, rgba(8,9,12,0.97) 0%, rgba(8,9,12,0.7) 20%, rgba(8,9,12,0.25) 50%, rgba(8,9,12,0) 70%)",
              }}
            />
          </>
        ) : (
          <div style={{ position: "absolute", inset: 0, background: "#08090c" }} />
        )}

        <div
          ref={labelRef}
          style={{
            position: "absolute",
            left: 36,
            top: 0,
            bottom: 0,
            zIndex: 3,
            opacity: 1,
            maxWidth: "45%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 104, fontWeight: 800, color: "#fff", lineHeight: 0.95, letterSpacing: -3 }}>
            {GENRE_LABELS[currentGenre] ?? currentGenre}
          </div>
          <div
            style={{
              width: 48,
              height: 4,
              borderRadius: 2,
              background: "rgba(255,255,255,0.5)",
              marginTop: 14,
            }}
          />
        </div>


        {hasPosters ? (
          <div
            style={{
              position: "absolute",
              right: 36,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            {currentData.posters.slice(0, POSTER_COUNT).map((poster, idx) => {
              if (!poster) return null;
              return (
                <div
                  key={idx}
                  ref={el => { posterRefs.current[idx] = el; }}
                  style={{
                    flexShrink: 0,
                    width: 130,
                    height: 200,
                    borderRadius: 10,
                    overflow: "hidden",
                    boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <img
                    src={poster}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
              );
            })}
          </div>
        ) : null}

        {!bigPicture ? (
          <div
            style={{
              position: "absolute",
              right: 24,
              bottom: 16,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <button
              onClick={e => { e.stopPropagation(); handleArrow(-1); }}
              aria-label="Género anterior"
              style={{
                width: 36, height: 36, borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", padding: 0,
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 500, minWidth: 28, textAlign: "center" }}>
              {activeIndex + 1}/{GENRES.length}
            </span>
            <button
              onClick={e => { e.stopPropagation(); handleArrow(1); }}
              aria-label="Género siguiente"
              style={{
                width: 36, height: 36, borderRadius: "50%",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", padding: 0,
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default memo(GenreShowcase);
