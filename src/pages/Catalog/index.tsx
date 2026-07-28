import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import { tmdbFetch } from "../../config/apiKeys";
import { useAddonStore } from "../../store/addonStore";
import type { MediaItem } from "../../types/ui";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { useProfileGradient } from "../../hooks/useProfileGradient";
import { gsap } from "../../utils/motion";
import { readPageDataCache, writePageDataCache } from "../../utils/pageDataCache";

const IMG = "https://image.tmdb.org/t/p";
const PAGE_LIMIT = 20;
const MAX_ITEMS = 240;

function upgradeTmdbImage(url: string | undefined, size: "w780" | "w500" = "w500") {
  if (!url) return url;
  return url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `${IMG}/${size}/`);
}

function normalizeMediaItem(item: MediaItem): MediaItem {
  return {
    ...item,
    poster: upgradeTmdbImage(item.poster, "w500"),
    background: upgradeTmdbImage(item.background, "w780"),
    logo: sanitizeLogoUrl(upgradeTmdbImage(item.logo, "w500")),
  };
}

function readExtraParams(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0),
    );
  } catch {
    return {};
  }
}

function catalogEndpoint(base: string, type: string, catalogId: string, extraParams?: Record<string, string>) {
  const extras = Object.entries(extraParams ?? {})
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}${extras ? `/${extras}` : ""}.json`;
}

function isoDate(daysFromNow: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

const STREAMING_PROVIDERS: Record<string, { providerIds: string[]; networkIds: string[]; companyIds: string[] }> = {
  netflix: { providerIds: ["8"], networkIds: ["213"], companyIds: ["213"] },
  hbo_max: { providerIds: ["1899", "384"], networkIds: ["49", "3186"], companyIds: ["174", "3268"] },
  disney: { providerIds: ["337"], networkIds: ["2739"], companyIds: ["2", "6125"] },
  prime_video: { providerIds: ["9"], networkIds: ["1024"], companyIds: ["1024"] },
  apple_tv: { providerIds: ["350"], networkIds: ["2552"], companyIds: ["2552"] },
};

function providerDiscoverParams(providerId: string, kind: "movie" | "series") {
  const provider = STREAMING_PROVIDERS[providerId];
  if (!provider) return null;
  const providerIds = provider.providerIds.join("|");
  const networkIds = provider.networkIds.join("|");
  const companyIds = provider.companyIds.join("|");
  return {
    primary: {
      sort_by: "popularity.desc",
      with_watch_monetization_types: "flatrate",
      with_watch_providers: providerIds,
      region: "PE",
      watch_region: "PE",
    } as Record<string, string>,
    fallbacks: [
      {
        sort_by: "popularity.desc",
        with_watch_monetization_types: "flatrate",
        with_watch_providers: providerIds,
        region: "US",
        watch_region: "US",
      } as Record<string, string>,
      (kind === "series"
        ? { sort_by: "popularity.desc", with_networks: networkIds }
        : { sort_by: "popularity.desc", with_companies: companyIds }) as Record<string, string>,
    ],
  };
}

function tmdbCatalogParams(catalogId: string): { path: string; type: "movie" | "series"; params: Record<string, string>; fallbacks?: Array<{ path?: string; params: Record<string, string> }> } | null {
  if (catalogId === "tmdb.top_series") return { path: "/tv/popular", type: "series", params: {} };
  if (catalogId === "tmdb.trending_movie") return { path: "/trending/movie/day", type: "movie", params: {} };
  if (catalogId === "tmdb.top_movie") return { path: "/movie/popular", type: "movie", params: {} };
  if (catalogId === "tmdb.trending_series") return { path: "/trending/tv/day", type: "series", params: {} };

  const streamingMatch = catalogId.match(/^tmdb\.discover\.(movie|series)\.streaming_(.+)$/);
  if (streamingMatch) {
    const kind = streamingMatch[1] as "movie" | "series";
    const providerId = streamingMatch[2];
    const discover = providerDiscoverParams(providerId, kind);
    if (!discover) return null;
    const path = kind === "movie" ? "/discover/movie" : "/discover/tv";
    return { path, type: kind, params: discover.primary, fallbacks: discover.fallbacks.map(f => ({ path, params: f })) };
  }

  const animeBase = { with_genres: "16", with_original_language: "ja" };
  switch (catalogId) {
    case "mal.airing_anime":
      return { path: "/discover/tv", type: "series", params: { sort_by: "popularity.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90), ...animeBase } };
    case "mal.top_anime":
      return { path: "/discover/tv", type: "series", params: { sort_by: "vote_average.desc", "vote_count.gte": "200", ...animeBase } };
    case "mal.most_favorites_anime":
      return { path: "/discover/tv", type: "series", params: { sort_by: "vote_count.desc", ...animeBase } };
    case "mal.top_airing_anime":
      return { path: "/discover/tv", type: "series", params: { sort_by: "vote_average.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90), "vote_count.gte": "10", ...animeBase } };
    case "jikan.top_airing":
      return { path: "/discover/tv", type: "series", params: { sort_by: "vote_count.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90), "vote_count.gte": "5", ...animeBase } };
    case "jikan.upcoming":
      return { path: "/discover/tv", type: "series", params: { sort_by: "popularity.desc", "air_date.gte": isoDate(1), "air_date.lte": isoDate(180), ...animeBase } };
    case "jikan.top_movies":
      return { path: "/discover/movie", type: "movie", params: { sort_by: "popularity.desc", with_genres: "16,12" } };
    case "jikan.recommendations":
      return { path: "/discover/tv", type: "series", params: { sort_by: "vote_average.desc", "vote_count.gte": "200", ...animeBase } };
    case "jikan.top_favorites":
      return { path: "/discover/tv", type: "series", params: { sort_by: "vote_average.desc", "vote_count.gte": "150", ...animeBase } };
    case "jikan.most_popular":
      return { path: "/discover/tv", type: "series", params: { sort_by: "vote_count.desc", "vote_count.gte": "100", ...animeBase } };
    default:
      return null;
  }
}

function normalizeTmdbCatalogItem(item: any, type: string): MediaItem | null {
  const id = Number(item?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = item?.title ?? item?.name;
  if (!name) return null;
  return normalizeMediaItem({
    id: `tmdb:${id}`,
    type,
    name,
    poster: item.poster_path ? `${IMG}/w500${item.poster_path}` : undefined,
    background: item.backdrop_path ? `${IMG}/original${item.backdrop_path}` : undefined,
    description: item.overview,
    rating: typeof item.vote_average === "number" && item.vote_average > 0 ? item.vote_average.toFixed(1) : undefined,
    year: Number((item.release_date ?? item.first_air_date ?? "").slice(0, 4)) || undefined,
  });
}

export default function CatalogPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const addons = useAddonStore(state => state.addons);
  const addonId = params.get("addon") ?? "";
  const type = params.get("type") ?? "";
  const catalogId = params.get("catalog") ?? "";
  const title = params.get("title") ?? "Catálogo";
  const extraParams = useMemo(() => readExtraParams(params.get("extras")), [params]);
  const addon = useMemo(() => addons.find(item => item.id === addonId), [addonId, addons]);
  const rootRef = useRef<HTMLDivElement>(null);
  const { gradient } = useProfileGradient();
  const cacheKey = `${addonId}:${catalogId}:${type}:${JSON.stringify(extraParams)}`;

  useEffect(() => {
    if (gradient) {
      document.documentElement.style.setProperty("--aetherio-page-bg", gradient);
    }
    return () => {
      document.documentElement.style.removeProperty("--aetherio-page-bg");
    };
  }, [gradient]);

  const cachedItems = readPageDataCache<MediaItem[]>("catalog", cacheKey);
  const [items, setItems] = useState<MediaItem[]>(() => cachedItems ?? []);
  const [loading, setLoading] = useState(() => !cachedItems);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || items.length === 0) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(
      ":scope > div:not([data-catalog-header]) > div",
    ));
    if (!els.length) return;
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline.fromTo(
      els,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.04, clearProps: "transform" },
    );
    return () => {
      timeline.kill();
      gsap.set(els, { clearProps: "opacity,transform" });
    };
  }, [items, loading]);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setLoading(true);
      setError("");
      setItems([]);

      let collected: MediaItem[] = [];

      if ((!addon && addonId !== "tmdb" && addonId !== "aetherio-starter") || !type || !catalogId) {
        setError("No se encontró el catálogo.");
        setLoading(false);
        return;
      }

      try {
        const seen = new Set<string>();
        collected = [];

        if (addonId === "tmdb" || addonId === "aetherio-starter") {
          const tmdbCatalog = tmdbCatalogParams(catalogId);
          if (!tmdbCatalog) {
            setError("No se encontró el catálogo.");
            setLoading(false);
            return;
          }
          const variants = [
            { path: tmdbCatalog.path, params: tmdbCatalog.params },
            ...(tmdbCatalog.fallbacks ?? []).map(fb => ({ path: fb.path ?? tmdbCatalog.path, params: fb.params })),
          ];
          for (let page = 1; collected.length < MAX_ITEMS; page += 1) {
            let added = 0;
            let lastResults: any[] = [];
            for (const variant of variants) {
              const data = await tmdbFetch<any>(variant.path, {
                params: { language: "es-ES", page: String(page), region: "PE", ...variant.params },
              });
              const results = Array.isArray(data?.results) ? data.results : [];
              lastResults = results;
              for (const result of results) {
                const item = normalizeTmdbCatalogItem(result, tmdbCatalog.type);
                if (!item || seen.has(item.id)) continue;
                seen.add(item.id);
                collected.push(item);
                added += 1;
              }
              if (results.length) break;
            }
            if (!cancelled) setItems([...collected]);
            if (lastResults.length < PAGE_LIMIT || added === 0) break;
          }
        } else if (addon) {
          const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
          for (let skip = 0; skip < MAX_ITEMS; skip += PAGE_LIMIT) {
            const requestExtras = skip === 0 ? extraParams : { ...extraParams, skip: String(skip) };
            const endpoint = catalogEndpoint(base, type, catalogId, requestExtras);
            const response = await fetch(endpoint);
            if (!response.ok) break;
            const data = await response.json();
            const metas = Array.isArray(data.metas) ? data.metas : [];
            let added = 0;

            for (const meta of metas) {
              if (!meta?.id || seen.has(meta.id)) continue;
              seen.add(meta.id);
              collected.push(normalizeMediaItem(meta));
              added += 1;
            }

            if (!cancelled) setItems([...collected]);
            if (metas.length < PAGE_LIMIT || added === 0) break;
          }
        }

        if (!cancelled && collected.length === 0) {
          setError("Este catálogo no devolvió contenido.");
        }
      } catch {
        if (!cancelled) setError("No se pudo cargar el catálogo.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (collected.length > 0) {
            writePageDataCache("catalog", cacheKey, collected);
          }
        }
      }
    }

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [addon, addonId, catalogId, extraParams, type]);

  return (
    <PageContainer>
      <div ref={rootRef} className="relative flex min-h-full flex-col" style={{ padding: "24px var(--app-safe-x) 56px" }}>
        <div data-catalog-header style={{ marginBottom: 26, display: "flex", alignItems: "center", gap: 14 }}>
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
            <h1 style={{ fontSize: 32, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>{title}</h1>
            <p style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.46)" }}>
              {loading ? "Cargando..." : `${items.length} títulos`}
            </p>
          </div>
          <div style={{ width: 40, flexShrink: 0 }} />
        </div>

        {error ? (
          <div className="liquid-glass-dark rounded-[18px] p-5 text-sm text-white/68">{error}</div>
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
            <CatalogGridCard
              key={`${item.id}-${index}`}
              item={item}
              type={item.type || type}
            />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

function CatalogGridCard({ item, type }: { item: MediaItem; type: string }) {
  const navigate = useNavigate();
  const image = item.poster ?? item.background ?? "";
  const openDetail = () => {
    writeDetailMediaMeta({
      id: item.id,
      type,
      name: item.name,
      poster: item.poster,
      background: item.background,
      logo: item.logo,
      description: item.description,
      year: item.year,
    });
    navigate(`/detail/${encodeURIComponent(type)}/${encodeURIComponent(item.id)}`);
  };

  return (
    <div style={{ width: 180 }}>
      <button
        type="button"
        onClick={openDetail}
        style={{ position: "relative", width: 180, height: 271, borderRadius: 10, overflow: "hidden", background: "#1c1c1e", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
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
