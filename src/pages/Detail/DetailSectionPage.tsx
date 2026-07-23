import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Play } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import { tmdbFetch } from "../../config/apiKeys";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { pickPreferredTmdbBackdrop } from "../../utils/tmdbArtwork";
import { SELECTED_ENGINE_KEY, SELECTED_MEDIA_META_KEY, SELECTED_STREAM_KEY } from "../Player/utils";
import type { MediaStream } from "../../types/stream";

const IMG = "https://image.tmdb.org/t/p";

type SectionKind = "trailers" | "cast" | "related";

interface TrailerItem {
  key: string;
  name: string;
  thumbnail: string;
}

interface PersonItem {
  id: number;
  name: string;
  role: string;
  image?: string;
}

interface RelatedItem {
  id: number;
  name: string;
  type: string;
  poster?: string;
  background?: string;
}

interface MediaHeader {
  name: string;
  logo?: string;
  background?: string;
  poster?: string;
}

export default function DetailSectionPage() {
  const { type = "", id = "", section = "" } = useParams<{ type: string; id: string; section: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sectionKind = normalizeSection(section);
  const [media, setMedia] = useState<MediaHeader>({ name: params.get("title") ?? "" });
  const [trailers, setTrailers] = useState<TrailerItem[]>([]);
  const [people, setPeople] = useState<PersonItem[]>([]);
  const [related, setRelated] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const title = sectionKind === "trailers"
    ? "Tráilers"
    : sectionKind === "cast"
      ? "Reparto"
      : "Más como esto";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        let tmdbType = type === "movie" ? "movie" : "tv";
        const tmdbId = await resolveTmdbId(type, id, params.get("title"));
        if (!tmdbId) {
          setError("No se encontró este título en TMDB.");
          return;
        }

        const append = sectionKind === "trailers"
          ? "videos,images"
          : sectionKind === "cast"
            ? "credits,images"
            : "similar,recommendations,images";
        let data = await tmdbFetch<any>(`/${tmdbType}/${tmdbId}`, { params: { language: "es-ES", append_to_response: append } });
        if (!data && tmdbType === "tv") {
          tmdbType = "movie";
          data = await tmdbFetch<any>(`/${tmdbType}/${tmdbId}`, { params: { language: "es-ES", append_to_response: append } });
        }
        if (!data) {
          data = await tmdbFetch<any>(`/${tmdbType}/${tmdbId}`, { params: { language: "en-US", append_to_response: append } });
        }
        if (!data) {
          setError("No se pudo cargar la sección.");
          return;
        }
        const logoPath = pickLogoPath(data.images?.logos);
        const nextMedia = {
          name: data.title ?? data.name ?? params.get("title") ?? "",
          logo: sanitizeLogoUrl(imageUrl(logoPath, "w500")),
          background: pickPreferredTmdbBackdrop(data.images?.backdrops, data.backdrop_path),
          poster: imageUrl(data.poster_path, "w780"),
        };
        if (!cancelled) setMedia(nextMedia);

        if (sectionKind === "trailers") {
          const items = mapTrailers(data.videos?.results);
          if (!items.length) {
            const fallbackData = await tmdbFetch<any>(`/${tmdbType}/${tmdbId}/videos`, { params: { language: "en-US" } });
            if (!cancelled) setTrailers(mapTrailers(fallbackData?.results));
          } else if (!cancelled) {
            setTrailers(items);
          }
        } else if (sectionKind === "cast") {
          const items = mapPeople(data.credits);
          if (!cancelled) setPeople(items);
        } else {
          const items = mapRelated(data, tmdbType);
          if (!cancelled) setRelated(items);
        }
      } catch {
        if (!cancelled) setError("No se pudo cargar la sección.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, params, sectionKind, type]);

  const count = useMemo(() => {
    if (sectionKind === "trailers") return trailers.length;
    if (sectionKind === "cast") return people.length;
    return related.length;
  }, [people.length, related.length, sectionKind, trailers.length]);

  return (
    <PageContainer>
      <div style={{ minHeight: "100vh", background: "#1f1f1f", padding: "34px var(--app-safe-x) 64px" }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{title}</h1>
          <p style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.46)" }}>
            {loading ? "Cargando..." : `${count} elementos`}
          </p>
        </header>

        {error ? <div className="liquid-glass-dark rounded-[18px] p-5 text-sm text-white/68">{error}</div> : null}

        {sectionKind === "trailers" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(302px, 302px))", gap: 18 }}>
            {trailers.map(item => <TrailerGridCard key={item.key} item={item} media={media} type={type} id={id} />)}
          </div>
        ) : null}

        {sectionKind === "cast" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(204px, 204px))", gap: "34px 40px" }}>
            {people.map(person => <PersonGridCard key={`${person.id}-${person.role}`} person={person} />)}
          </div>
        ) : null}

        {sectionKind === "related" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 180px))", gap: "22px 24px" }}>
            {related.map(item => (
              <RelatedGridCard
                key={`${item.type}-${item.id}`}
                item={item}
                onOpen={() => {
                  writeDetailMediaMeta({
                    id: `tmdb:${item.id}`,
                    type: item.type,
                    name: item.name,
                    poster: item.poster,
                    background: item.background,
                  });
                  navigate(`/detail/${item.type}/tmdb:${item.id}`);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}

function TrailerGridCard({ item, media, type, id }: { item: TrailerItem; media: MediaHeader; type: string; id: string }) {
  const navigate = useNavigate();
  const stream: MediaStream = {
    id: `tmdb-trailer-${item.key}`,
    addonId: "tmdb",
    addonName: "TMDB",
    name: "Trailer",
    title: item.name,
    description: `Trailer - ${media.name}`,
    ytId: item.key,
    behaviorHints: { background: media.background, poster: media.poster },
  };

  return (
    <button
      type="button"
      onClick={() => {
        sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(stream));
        sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
        sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
          name: `${media.name} - Trailer`,
          logo: media.logo,
          background: media.background ?? media.poster,
        }));
        navigate(`/player?${new URLSearchParams({ type, id, trailer: "1" }).toString()}`);
      }}
      style={{ position: "relative", width: 302, height: 196, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(225,230,238,0.12)", background: "#1c1c1e", padding: 0, cursor: "pointer", textAlign: "left" }}
    >
      <img src={item.thumbnail} alt={item.name} loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.28) 48%, transparent 100%)" }} />
      <div style={{ position: "absolute", left: 12, right: 12, bottom: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</p>
        <p style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}><Play size={10} fill="white" /> Trailer</p>
      </div>
    </button>
  );
}

function PersonGridCard({ person }: { person: PersonItem }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/person/${person.id}`)} style={{ width: 204, border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "center" }}>
      {person.image ? (
        <img src={person.image} alt={person.name} loading="lazy" decoding="async" style={{ width: 180, height: 180, borderRadius: "50%", objectFit: "cover", margin: "0 auto 12px" }} />
      ) : (
        <div style={{ width: 180, height: 180, borderRadius: "50%", background: "#9da3af", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", fontSize: 58, fontWeight: 500 }}>
          {initials(person.name)}
        </div>
      )}
      <p style={{ fontSize: 14.4, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>{person.name}</p>
      <p style={{ marginTop: 4, fontSize: 14.4, color: "rgba(255,255,255,0.68)", lineHeight: 1.2 }}>{person.role}</p>
    </button>
  );
}

function RelatedGridCard({ item, onOpen }: { item: RelatedItem; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} style={{ position: "relative", width: 180, height: 271, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(225,230,238,0.12)", background: "#1c1c1e", padding: 0, cursor: "pointer" }}>
      {item.poster ? <img src={item.poster} alt={item.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
    </button>
  );
}

function normalizeSection(value: string): SectionKind {
  return value === "cast" || value === "related" || value === "trailers" ? value : "trailers";
}

async function resolveTmdbId(type: string, id: string, title?: string | null) {
  if (id.startsWith("tmdb:")) {
    const value = Number(id.slice(5).split(":")[0]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (id.startsWith("tt")) {
    const data = await tmdbFetch<any>(`/find/${encodeURIComponent(id.split(":")[0])}`, { params: { external_source: "imdb_id", language: "es-ES" } });
    const preferredResults = type === "movie" ? data?.movie_results : data?.tv_results;
    const results = preferredResults?.length ? preferredResults : (data?.movie_results?.length ? data.movie_results : data?.tv_results);
    const value = Number(results?.[0]?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const cleanTitle = title?.trim();
  if (cleanTitle) {
    const tmdbType = type === "movie" ? "movie" : "tv";
    const data = await tmdbFetch<any>(`/search/${tmdbType}`, { params: { query: cleanTitle, language: "es-ES", page: "1" } })
      ?? await tmdbFetch<any>(`/search/${tmdbType}`, { params: { query: cleanTitle, language: "en-US", page: "1" } });
    const value = Number(data?.results?.[0]?.id);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

function mapTrailers(results: unknown): TrailerItem[] {
  if (!Array.isArray(results)) return [];
  return results
    .filter((item: any) => item?.site === "YouTube" && (item?.type === "Trailer" || item?.type === "Teaser") && typeof item?.key === "string")
    .map((item: any) => ({
      key: item.key,
      name: item.name ?? "Trailer",
      thumbnail: `https://img.youtube.com/vi/${item.key}/maxresdefault.jpg`,
    }));
}

function mapPeople(credits: any): PersonItem[] {
  const cast = (credits?.cast ?? []).map((item: any) => ({
    id: item.id,
    name: item.name,
    role: item.character ?? "",
    image: imageUrl(item.profile_path, "w185"),
  }));
  const crew = (credits?.crew ?? [])
    .filter((item: any) => ["Director", "Writer", "Producer", "Executive Producer", "Creator"].includes(item?.job))
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      role: translateJob(item.job),
      image: imageUrl(item.profile_path, "w185"),
    }));
  const seen = new Set<string>();
  return [...cast, ...crew].filter((item: PersonItem) => {
    if (!item.id || !item.name) return false;
    const key = `${item.id}:${item.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}

function mapRelated(data: any, fallbackType: string): RelatedItem[] {
  const results = [
    ...(Array.isArray(data?.recommendations?.results) ? data.recommendations.results : []),
    ...(Array.isArray(data?.similar?.results) ? data.similar.results : []),
  ];
  const ownGenres = new Set((data?.genres ?? []).map((genre: any) => Number(genre?.id)).filter(Boolean));
  const seen = new Set<string>();
  return results
    .filter((item: any) => item?.id && item?.poster_path)
    .map((item: any) => ({
      item,
      score: (Array.isArray(item.genre_ids) ? item.genre_ids.filter((genreId: number) => ownGenres.has(Number(genreId))).length : 0) * 20
        + Number(item.vote_average ?? 0)
        + Math.log10(Math.max(1, Number(item.popularity ?? 0)) + 1),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => {
      const mediaType = item.media_type === "movie" || item.media_type === "tv" ? item.media_type : fallbackType;
      return {
        id: item.id,
        name: item.title ?? item.name ?? "",
        type: mediaType === "tv" ? "series" : mediaType,
        poster: imageUrl(item.poster_path, "w500"),
        background: imageUrl(item.backdrop_path, "w780"),
      };
    })
    .filter((item: RelatedItem) => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

function pickLogoPath(logos: unknown) {
  if (!Array.isArray(logos)) return undefined;
  return (logos.find((item: any) => item?.iso_639_1 === "es" && item?.file_path)
    ?? logos.find((item: any) => item?.iso_639_1 === "en" && item?.file_path)
    ?? logos.find((item: any) => item?.iso_639_1 === null && item?.file_path)
    ?? logos.find((item: any) => item?.file_path))?.file_path;
}

function imageUrl(path: string | undefined | null, size: "original" | "w780" | "w500" | "w185") {
  return path ? `${IMG}/${size}${path}` : undefined;
}

function translateJob(value: string) {
  if (value === "Executive Producer") return "Producción ejecutiva";
  if (value === "Producer") return "Producción";
  if (value === "Director") return "Dirección";
  if (value === "Writer") return "Guion";
  if (value === "Creator") return "Creación";
  return value;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("");
}


