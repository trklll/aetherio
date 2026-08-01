import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { tmdbFetch } from "../../config/apiKeys";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import { useProfileGradient } from "../../hooks/useProfileGradient";
import CatalogRow from "../Home/CatalogRow";
import { rankEntityRows, type EntityPopularityCandidate, type EntityPopularityRow } from "./entityRanking";

const IMG = "https://image.tmdb.org/t/p";

type EntityKind = "network" | "company";

interface EntityData {
  id: number;
  name: string;
  description: string;
  logo?: string;
  homepage?: string;
  headquarters?: string;
  originCountry?: string;
}

interface EntityMediaItem extends MediaItem, EntityPopularityCandidate {
  id: string;
  tmdbId: number;
  type: "movie" | "series";
  sourceIndex: number;
  popularity: number;
  voteCount: number;
  voteAverage: number;
}

type EntityRowData = EntityPopularityRow<EntityMediaItem>;

export default function EntityPage() {
  const { kind: rawKind, id } = useParams<{ kind: EntityKind; id: string }>();
  const { gradient } = useProfileGradient();
  const [entity, setEntity] = useState<EntityData | null>(null);
  const [rows, setRows] = useState<EntityRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedEntityKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (gradient) {
      document.documentElement.style.setProperty("--aetherio-page-bg", gradient);
    } else {
      document.documentElement.style.removeProperty("--aetherio-page-bg");
    }
    return () => {
      document.documentElement.style.removeProperty("--aetherio-page-bg");
    };
  }, [gradient]);

  useEffect(() => {
    const entityKind = normalizeEntityKind(rawKind);
    if (!entityKind || !id) {
      setEntity(null);
      setRows([]);
      setLoading(false);
      return;
    }

    const entityKey = `${entityKind}:${id}`;
    if (loadedEntityKeyRef.current === entityKey) return;

    const controller = new AbortController();
    void loadEntity(entityKind, id, controller.signal);
    return () => controller.abort();
  }, [id, rawKind]);

  if (loading) return <EntitySkeleton />;
  if (!entity) {
    return (
      <div className="entity-page-scale min-h-screen text-white" style={{ paddingTop: "var(--app-shell-nav-height)" }}>
        <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.42)" }}>
          No se encontró esta entidad.
        </div>
      </div>
    );
  }

  return (
    <div
      className="entity-page-scale min-h-screen text-white"
      style={{ marginTop: "calc(-1 * var(--app-shell-nav-height))", paddingTop: "var(--app-shell-nav-height)", paddingBottom: 56 }}
    >
      <header style={{ width: "100%", padding: "40px 48px 0", marginBottom: 48, display: "grid", gridTemplateColumns: "minmax(180px, 260px) minmax(0, 1fr)", gap: 32, alignItems: "center" }}>
        <div style={{ height: 150, borderRadius: 22, padding: 26, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.78)", background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,242,246,0.9))", boxShadow: "0 18px 44px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.92)" }}>
          {entity.logo ? (
            <img src={entity.logo} alt={entity.name} decoding="async" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.16))" }} />
          ) : (
            <span style={{ fontSize: 28, fontWeight: 800, color: "rgba(22,24,28,0.92)", textAlign: "center", lineHeight: 1.1 }}>{entity.name}</span>
          )}
        </div>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.42)", marginBottom: 8 }}>
            {rawKind === "network" ? "Cadena" : "Producción"}
          </p>
          <h1 style={{ fontSize: "2.35rem", fontWeight: 800, color: "#fff", lineHeight: 1.05, marginBottom: 14 }}>{entity.name}</h1>
          <p style={{ maxWidth: 720, fontSize: 15, lineHeight: 1.72, color: "rgba(255,255,255,0.68)", fontWeight: 400 }}>{entity.description}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            {entity.headquarters ? <EntityMetaPill>{entity.headquarters}</EntityMetaPill> : null}
            {entity.originCountry ? <EntityMetaPill>{entity.originCountry}</EntityMetaPill> : null}
            {entity.homepage ? <EntityMetaPill>{safeHomepageHost(entity.homepage)}</EntityMetaPill> : null}
          </div>
        </div>
      </header>

      <div>
        {rows.map(row => (
          <CatalogRow
            key={row.title}
            row={toCatalogRow(row, entity, rawKind ?? "company", id ?? "")}
            posterLayout="vertical"
            titleOverride={row.title}
            disableHeaderNavigation
            persistHomeScroll={false}
          />
        ))}
        {rows.length === 0 ? (
          <div className="liquid-glass-dark" style={{ margin: "0 48px", borderRadius: 18, padding: 22, color: "rgba(255,255,255,0.54)", fontSize: 14 }}>
            No se encontraron títulos asociados.
          </div>
        ) : null}
      </div>
    </div>
  );

  async function loadEntity(entityKind: EntityKind, rawId: string, signal: AbortSignal) {
    setLoading(true);
    setEntity(null);
    setRows([]);
    try {
      const entityId = Number(rawId);
      if (!Number.isFinite(entityId) || entityId <= 0) return;

      const tvDiscover = buildDiscoverParams(entityKind, "tv", entityId);
      const movieDiscover = entityKind === "company" ? buildDiscoverParams(entityKind, "movie", entityId) : null;
      const requests = [
        tmdbFetch(`/${entityKind}/${entityId}`, { signal }),
        tmdbFetch(tvDiscover.path, { params: tvDiscover.params, signal }),
        movieDiscover
          ? tmdbFetch(movieDiscover.path, { params: movieDiscover.params, signal })
          : Promise.resolve(null),
      ];
      const [detailResult, tvResult, movieResult] = await Promise.allSettled(requests);
      if (signal.aborted) return;

      const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
      if (!detail) return;

      const nextEntity: EntityData = {
        id: entityId,
        name: String(detail.name ?? ""),
        description: buildEntityDescription(entityKind, detail),
        logo: detail.logo_path ? `${IMG}/w500${detail.logo_path}` : undefined,
        homepage: typeof detail.homepage === "string" ? detail.homepage : undefined,
        headquarters: typeof detail.headquarters === "string" ? detail.headquarters : undefined,
        originCountry: typeof detail.origin_country === "string" ? detail.origin_country : undefined,
      };
      const tvData = tvResult.status === "fulfilled" ? tvResult.value : null;
      const movieData = movieResult.status === "fulfilled" ? movieResult.value : null;
      const nextRows = rankEntityRows([
        { title: "Programas de TV", items: mapEntityResults(tvData?.results, "series") },
        ...(entityKind === "company" ? [{ title: "Películas", items: mapEntityResults(movieData?.results, "movie") }] : []),
      ]).filter(row => row.items.length > 0);

      setEntity(nextEntity);
      setRows(nextRows);
      loadedEntityKeyRef.current = `${entityKind}:${rawId}`;
    } catch (error) {
      if (!signal.aborted) console.warn("Entity load error:", error);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
}

function normalizeEntityKind(value: string | undefined): EntityKind | null {
  return value === "network" || value === "company" ? value : null;
}

function buildDiscoverParams(kind: EntityKind, mediaType: "movie" | "tv", id: number) {
  const params: Record<string, string> = {
    language: "es-ES",
    sort_by: "popularity.desc",
    include_adult: "false",
    page: "1",
  };
  if (kind === "network") {
    if (mediaType !== "tv") throw new Error("Networks do not support movie discovery");
    params.with_networks = String(id);
  } else {
    params.with_companies = String(id);
  }
  return { path: `/discover/${mediaType}` as const, params };
}

function buildEntityDescription(kind: EntityKind, detail: any) {
  const description = String(detail.description ?? detail.overview ?? "").trim();
  if (description) return description;
  const name = String(detail.name ?? "").trim() || (kind === "network" ? "esta cadena" : "esta productora");
  const country = detail.origin_country ? ` de ${detail.origin_country}` : "";
  const location = detail.headquarters ? ` con sede en ${detail.headquarters}` : "";
  return kind === "network"
    ? `${name} es una cadena${country}${location}. Explora sus programas y títulos relacionados disponibles en Aetherio.`
    : `${name} es una compañía de producción${country}${location}. Explora sus películas y programas relacionados disponibles en Aetherio.`;
}

function mapEntityResults(values: any[] | undefined, type: "movie" | "series"): EntityMediaItem[] {
  return (values ?? [])
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .filter(({ item }) => item?.id && (item.poster_path || item.backdrop_path))
    .slice(0, 24)
    .map(({ item, sourceIndex }) => ({
      id: `tmdb:${item.id}`,
      tmdbId: Number(item.id),
      type,
      name: item.title ?? item.name ?? "",
      poster: item.poster_path ? `${IMG}/original${item.poster_path}` : undefined,
      background: item.backdrop_path ? `${IMG}/original${item.backdrop_path}` : undefined,
      description: item.overview,
      year: Number(String(item.release_date ?? item.first_air_date ?? "").slice(0, 4)) || undefined,
      popularity: Number(item.popularity) || 0,
      voteCount: Number(item.vote_count) || 0,
      voteAverage: Number(item.vote_average) || 0,
      sourceIndex,
    }));
}

function toCatalogRow(row: EntityRowData, entity: EntityData, kind: EntityKind, id: string): CatalogRowData {
  const type = row.title === "Películas" ? "movie" : "series";
  return {
    addonId: `entity:${kind}:${id}`,
    addonName: entity.name,
    catalogId: `${kind}:${id}:${type}`,
    type,
    name: row.title,
    items: row.items,
  };
}

function safeHomepageHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function EntityMetaPill({ children }: { children: string }) {
  return (
    <span style={{ borderRadius: 999, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.08)", padding: "6px 10px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.58)" }}>
      {children}
    </span>
  );
}

function EntitySkeleton() {
  return (
    <div className="entity-page-scale min-h-screen pb-14 text-white" style={{ marginTop: "calc(-1 * var(--app-shell-nav-height))", paddingTop: "calc(var(--app-shell-nav-height) + 40px)" }}>
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 32, alignItems: "center", padding: "0 48px", marginBottom: 48 }}>
          <div className="skeleton" style={{ height: 150, borderRadius: 22 }} />
          <div>
            <div className="skeleton" style={{ height: 34, width: 260, borderRadius: 10, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 14, width: "70%", borderRadius: 8, marginBottom: 9 }} />
            <div className="skeleton" style={{ height: 14, width: "58%", borderRadius: 8 }} />
          </div>
        </div>
        {[0, 1].map(row => (
          <div key={row} style={{ marginBottom: 42 }}>
            <div className="skeleton" style={{ height: 20, width: 170, borderRadius: 8, margin: "0 48px 16px" }} />
            <div style={{ display: "flex", gap: 22, overflow: "hidden", padding: "0 48px" }}>
              {[0, 1, 2, 3, 4].map(item => <div key={item} className="skeleton" style={{ width: 180, height: 271, borderRadius: 10, flexShrink: 0 }} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
