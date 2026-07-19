import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import { tmdbFetch } from "../../config/apiKeys";
import { useHomePreferences } from "../../config/homePreferences";
import { useAddonStore } from "../../store/addonStore";
import type { MediaItem } from "../../types/ui";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";

const IMG = "https://image.tmdb.org/t/p";
const PAGE_LIMIT = 20;
const MAX_ITEMS = 240;

const HORIZONTAL_CARD = { width: 302, height: 196 };
const VERTICAL_CARD = { width: 180, height: 271 };

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

function tmdbCatalogParams(catalogId: string): { path: string; type: "movie" | "series"; params: Record<string, string> } | null {
  switch (catalogId) {
    case "tmdb:series:trending":
      return { path: "/trending/tv/day", type: "series" as const, params: {} };
    case "tmdb:movie:trending":
      return { path: "/trending/movie/day", type: "movie" as const, params: {} };
    case "tmdb:series:anime":
      return { path: "/discover/tv", type: "series" as const, params: { sort_by: "popularity.desc", with_genres: "16", with_original_language: "ja" } };
    case "tmdb:movie:anime":
      return { path: "/discover/movie", type: "movie" as const, params: { sort_by: "popularity.desc", with_genres: "16", with_original_language: "ja" } };
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
  const preferences = useHomePreferences();
  const addonId = params.get("addon") ?? "";
  const type = params.get("type") ?? "";
  const catalogId = params.get("catalog") ?? "";
  const title = params.get("title") ?? "Catálogo";
  const extraParams = useMemo(() => readExtraParams(params.get("extras")), [params]);
  const addon = useMemo(() => addons.find(item => item.id === addonId), [addonId, addons]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const cardSize = preferences.posterLayout === "vertical" ? VERTICAL_CARD : HORIZONTAL_CARD;

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      setLoading(true);
      setError("");
      setItems([]);

      if ((!addon && addonId !== "tmdb") || !type || !catalogId) {
        setError("No se encontró el catálogo.");
        setLoading(false);
        return;
      }

      try {
        const seen = new Set<string>();
        const collected: MediaItem[] = [];

        if (addonId === "tmdb") {
          const tmdbCatalog = tmdbCatalogParams(catalogId);
          if (!tmdbCatalog) {
            setError("No se encontró el catálogo.");
            setLoading(false);
            return;
          }
          for (let page = 1; collected.length < MAX_ITEMS; page += 1) {
            const data = await tmdbFetch<any>(tmdbCatalog.path, {
              params: { language: "es-ES", page: String(page), ...tmdbCatalog.params },
            });
            const results = Array.isArray(data?.results) ? data.results : [];
            let added = 0;
            for (const result of results) {
              const item = normalizeTmdbCatalogItem(result, tmdbCatalog.type);
              if (!item || seen.has(item.id)) continue;
              seen.add(item.id);
              collected.push(item);
              added += 1;
            }
            if (!cancelled) setItems([...collected]);
            if (results.length < PAGE_LIMIT || added === 0) break;
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
        if (!cancelled) setLoading(false);
      }
    }

    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [addon, addonId, catalogId, extraParams, type]);

  return (
    <PageContainer>
      <div style={{ minHeight: "100vh", padding: "24px var(--app-safe-x) 56px", background: "#1f1f1f" }}>
        <div style={{ marginBottom: 26, display: "flex", alignItems: "center", gap: 14 }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Volver"
            title="Volver"
            style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.08)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <ChevronLeft size={19} />
          </button>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>{title}</h1>
            <p style={{ marginTop: 5, fontSize: 13, color: "rgba(255,255,255,0.46)" }}>
              {loading ? "Cargando..." : `${items.length} títulos`}
            </p>
          </div>
        </div>

        {error ? (
          <div className="liquid-glass-dark rounded-[18px] p-5 text-sm text-white/68">{error}</div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.width}px, ${cardSize.width}px))`,
            gap: 14,
            alignItems: "start",
          }}
        >
          {items.map((item, index) => (
            <CatalogGridCard
              key={`${item.id}-${index}`}
              item={item}
              type={type}
              width={cardSize.width}
              height={cardSize.height}
              posterLayout={preferences.posterLayout}
            />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

function CatalogGridCard({
  item,
  type,
  width,
  height,
  posterLayout,
}: {
  item: MediaItem;
  type: string;
  width: number;
  height: number;
  posterLayout: "horizontal" | "vertical";
}) {
  const navigate = useNavigate();
  const image = posterLayout === "vertical"
    ? item.poster ?? item.background ?? ""
    : item.background ?? item.poster ?? "";
  const logo = sanitizeLogoUrl(item.logo);
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
    <button
      type="button"
      onClick={openDetail}
      style={{ position: "relative", width, height, borderRadius: 10, overflow: "hidden", background: "#1c1c1e", border: "none", padding: 0, cursor: "pointer", textAlign: "left", contentVisibility: "auto", containIntrinsicSize: `${width}px ${height}px` }}
    >
      {image ? (
        <img src={image} alt={item.name} loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
      {posterLayout !== "vertical" ? <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top,rgba(0,0,0,0.86) 0%,rgba(0,0,0,0.12) 62%,transparent 100%)", pointerEvents: "none" }} /> : null}
      {posterLayout !== "vertical" ? <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 10px 10px" }}>
        {logo ? (
          <img src={logo} alt={item.name} loading="lazy" decoding="async" style={{ maxHeight: 28, maxWidth: 142, objectFit: "contain", filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.95))", marginBottom: 4 }} />
        ) : (
          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 13, fontWeight: 700, color: "#fff", textShadow: "0 1px 8px rgba(0,0,0,0.95)" }}>
            {item.name}
          </span>
        )}
      </div> : null}
    </button>
  );
}
