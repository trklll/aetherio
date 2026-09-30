import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { tmdbFetch } from "../../config/apiKeys";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import { useProfileGradient } from "../../hooks/useProfileGradient";
import CatalogRow from "../Home/CatalogRow";
import { rankEntityRows, type EntityPopularityCandidate, type EntityPopularityRow } from "./entityRanking";
import { rowKey as makeRowKey } from "../../store/homeScrollStore";
import { getEntityScroll, saveEntityScroll } from "../../store/entityScrollStore";
import { openPictureRail } from "../../navigation/spatialNav.ts";
import { isBigPictureMode } from "../../runtime/platform.ts";
import { isContextMenuOpen } from "../../components/ui/ContextMenu.tsx";

const IMG = "https://image.tmdb.org/t/p";

// La página de entidad no tiene héroe: vive siempre en "zona de contenido",
// así que el fondo va con el blur de contenido del Detail (28) desde el
// primer frame, incluso durante el skeleton loader.

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
  const location = useLocation();
  const { gradient } = useProfileGradient();
  const [entity, setEntity] = useState<EntityData | null>(null);
  const [rows, setRows] = useState<EntityRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedEntityKeyRef = useRef<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const bgTokenRef = useRef(0);

  const entityKind = normalizeEntityKind(rawKind);
  const entityKey = entityKind && id ? `${entityKind}:${id}` : "";
  const entityKeyRef = useRef(entityKey);
  entityKeyRef.current = entityKey;
  // Fondo heredado del Detail de origen (si se vino desde uno). Se siembra en
  // el estado inicial para que el primer frame (skeleton incluido) ya salga
  // blureado, sin esperar a la probe ni a las rows.
  const fromDetailBackground = (() => {
    const state = location.state as { fromDetailBackground?: unknown } | null;
    const value = state?.fromDetailBackground;
    return typeof value === "string" && value.trim() ? value.trim() : "";
  })();
  const [bgStack, setBgStack] = useState<{ prev: string | null; curr: string }>(() => ({
    prev: null,
    curr: shrinkBackdrop(fromDetailBackground),
  }));

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
    const kind = normalizeEntityKind(rawKind);
    if (!kind || !id) {
      setEntity(null);
      setRows([]);
      setLoading(false);
      return;
    }

    const key = `${kind}:${id}`;
    if (loadedEntityKeyRef.current === key) return;

    const controller = new AbortController();
    void loadEntity(kind, id, controller.signal);
    return () => controller.abort();
  }, [id, rawKind]);

  // Fondo: el del Detail de origen si se vino desde uno; si no, el backdrop
  // más popular de la entidad (misma fuente que las rows).
  useEffect(() => {
    const next = shrinkBackdrop(fromDetailBackground) || pickEntityBackdrop(rows);
    if (!next || next === bgStack.curr) return;
    const token = ++bgTokenRef.current;
    let cancelled = false;
    const commit = () => {
      if (cancelled || bgTokenRef.current !== token) return;
      setBgStack(latest => (latest.curr === next ? latest : { prev: latest.curr || null, curr: next }));
    };
    const probe = new Image();
    probe.decoding = "async";
    probe.src = next;
    if (probe.complete && probe.naturalWidth > 0) {
      commit();
    } else {
      probe.onload = commit;
      probe.onerror = commit;
    }
    return () => { cancelled = true; };
  }, [rows, fromDetailBackground, bgStack.curr]);

  // Tras el fundido se suelta el frame previo (como el Detail).
  useEffect(() => {
    if (!bgStack.prev) return;
    const t = window.setTimeout(() => {
      setBgStack(latest => (latest.prev ? { prev: null, curr: latest.curr } : latest));
    }, 700);
    return () => window.clearTimeout(t);
  }, [bgStack.prev, bgStack.curr]);

  // Guardado continuo del vertical (el cleanup al navegar corre después del
  // reset del AppShell y no puede ser la única fuente de memoria).
  useEffect(() => {
    if (loading || !entityKey) return;
    const root = pageRef.current;
    const shell = getEntityShell(root);
    if (!shell) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const key = entityKeyRef.current;
        if (key) saveEntityScroll(key, { vertical: Math.max(0, shell.scrollTop) });
      });
    };
    shell.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      shell.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [loading, entityKey]);

  // Restaurar el scroll vertical propio (el AppShell restaura el suyo en su
  // layout effect: se re-aplica después con timeout para no perderlo).
  useEffect(() => {
    if (loading || !entity || !entityKey) return;
    const saved = getEntityScroll(entityKey);
    if (!saved || saved.vertical <= 0) return;
    const root = pageRef.current;
    const shell = getEntityShell(root);
    if (!shell) return;
    const apply = () => {
      const current = getEntityScroll(entityKey);
      if (current && current.vertical > 0 && Math.abs(shell.scrollTop - current.vertical) > 2) {
        shell.scrollTo({ top: current.vertical, behavior: "instant" as ScrollBehavior });
      }
    };
    apply();
    const t1 = window.setTimeout(apply, 60);
    const t2 = window.setTimeout(apply, 220);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [loading, entity, entityKey]);

  // Snapshot de las rows (horizontal + foco) al hacer click y al pasar el
  // foco por las rows con el mando ("scroll de home"). El vertical se guarda
  // en continuo en el listener del shell; en el cleanup solo se salvan las
  // rows para no pisar la memoria con el reset del AppShell al navegar.
  useEffect(() => {
    if (!entityKey) return;
    const snapshot = () => snapshotEntityScroll(pageRef.current, entityKey, { includeVertical: false });
    const root = pageRef.current;
    root?.addEventListener("focusin", snapshot);
    return () => {
      root?.removeEventListener("focusin", snapshot);
      snapshot();
    };
  }, [entityKey, loading]);

  // Big Picture: en la primera card de una row, izquierda abre la sidebar
  // (pill/rail), igual que en la page detail (TvPagePillScaffold nativo).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft") return;
      if (!isBigPictureMode()) return;
      if (isContextMenuOpen()) return;
      const root = pageRef.current;
      if (!root) return;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) return;
      const holder = active.closest("[data-item-index]");
      if (!holder || !root.contains(holder)) return;
      if ((holder.getAttribute("data-item-index") ?? "") !== "0") return;
      if (!document.querySelector(".bp-rail")) return;
      event.preventDefault();
      event.stopPropagation();
      openPictureRail();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const savedRows = entityKey ? getEntityScroll(entityKey)?.rows : undefined;

  return (
    <div
      ref={pageRef}
      style={{ position: "relative", width: "100%", height: "100vh", marginTop: "calc(-1 * var(--app-shell-nav-height))", overflow: "hidden", background: "#1f1f1f" }}
    >
      <div
        data-aetherio-scroll-shell
        data-entity-scroll
        className="entity-scroll"
        style={{ position: "absolute", inset: 0, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain" }}
      >
      {bgStack.curr ? (
        <div
          aria-hidden="true"
          style={{ position: "sticky", top: 0, height: "100vh", marginBottom: "-100vh", zIndex: 0, overflow: "hidden", pointerEvents: "none", background: "#1f1f1f" }}
        >
          <div style={{ position: "absolute", inset: 0, filter: "blur(28px) saturate(1.15)", transform: "scale(1.15)" }}>
            {bgStack.prev && bgStack.prev !== bgStack.curr ? (
              <img src={bgStack.prev} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 1 }} />
            ) : null}
            <img
              src={bgStack.curr}
              alt=""
              draggable={false}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: bgStack.prev ? 0 : 1, transition: bgStack.prev ? "opacity 0.62s ease" : undefined }}
              onLoad={event => { (event.currentTarget as HTMLImageElement).style.opacity = "1"; }}
            />
          </div>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,1)", opacity: 0.6 }} />
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 85% at center, transparent 42%, rgba(0,0,0,0.30) 68%, rgba(0,0,0,0.88) 100%)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 0%, transparent 62%, rgba(31,31,31,0.55) 100%)" }} />
        </div>
      ) : null}

      {loading || !entity ? (
        <EntitySkeletonContent showEmpty={!loading && !entity} />
      ) : (
      <div
        className="entity-page-scale min-h-screen text-white"
        style={{ position: "relative", zIndex: 1, paddingTop: "var(--app-shell-nav-height)", paddingBottom: "var(--app-gutter-bottom)" }}
        onClickCapture={() => snapshotEntityScroll(pageRef.current, entityKey)}
      >
        <header style={{ width: "100%", padding: "var(--app-hero-top) var(--app-gutter-x) 0", marginBottom: "var(--app-gutter-bottom)", display: "grid", gridTemplateColumns: "minmax(180px, 260px) minmax(0, 1fr)", gap: "var(--app-gutter-x)", alignItems: "center" }}>
          <div style={{ height: 150, borderRadius: 22, padding: 26, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.78)", background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,242,246,0.9))", boxShadow: "0 18px 44px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.92)" }}>
            {entity.logo ? (
              <img src={entity.logo} alt={entity.name} decoding="async" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.16))" }} />
            ) : (
              <span style={{ fontSize: 28, fontWeight: 800, color: "rgba(22,24,28,0.92)", textAlign: "center", lineHeight: 1.1 }}>{entity.name}</span>
            )}
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.42)", marginBottom: 8, textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
              {rawKind === "network" ? "Cadena" : "Producción"}
            </p>
            <h1 style={{ fontSize: "2.35rem", fontWeight: 800, color: "#fff", lineHeight: 1.05, marginBottom: 14, textShadow: "0 2px 18px rgba(0,0,0,0.6)" }}>{entity.name}</h1>
            <p style={{ maxWidth: 720, fontSize: 15, lineHeight: 1.72, color: "rgba(255,255,255,0.68)", fontWeight: 400, textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>{entity.description}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              {entity.headquarters ? <EntityMetaPill>{entity.headquarters}</EntityMetaPill> : null}
              {entity.originCountry ? <EntityMetaPill>{entity.originCountry}</EntityMetaPill> : null}
              {entity.homepage ? <EntityMetaPill>{safeHomepageHost(entity.homepage)}</EntityMetaPill> : null}
            </div>
          </div>
        </header>

        <div>
          {rows.map(row => {
            const catalogRow = toCatalogRow(row, entity, rawKind ?? "company", id ?? "");
            const rowKey = makeRowKey(catalogRow.addonId, catalogRow.catalogId, catalogRow.type);
            return (
              <CatalogRow
                key={row.title}
                row={catalogRow}
                posterLayout="vertical"
                titleOverride={row.title}
                disableHeaderNavigation
                persistHomeScroll={false}
                restoreScrollLeft={savedRows?.[rowKey]}
              />
            );
          })}
          {rows.length === 0 ? (
            <div className="liquid-glass-dark" style={{ margin: "0 var(--app-gutter-x)", borderRadius: 18, padding: 22, color: "rgba(255,255,255,0.54)", fontSize: 14 }}>
              No se encontraron títulos asociados.
            </div>
          ) : null}
        </div>
      </div>
      )}
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

function getEntityShell(root: HTMLElement | null): HTMLElement | null {
  // Shell propio (como el Detail): scroll programático del motor + memoria.
  return root?.querySelector<HTMLElement>("[data-entity-scroll]") ?? null;
}

function snapshotEntityScroll(root: HTMLElement | null, entityKey: string, options?: { includeVertical?: boolean }) {
  if (!root || !entityKey || !root.isConnected) return;
  const shell = getEntityShell(root);
  const rowsMap: Record<string, number> = {};
  root.querySelectorAll<HTMLElement>("[data-row-key]").forEach(row => {
    const key = row.getAttribute("data-row-key");
    const scroller = row.querySelector<HTMLElement>("[data-row-scroller]");
    if (key && scroller) rowsMap[key] = scroller.scrollLeft;
  });
  saveEntityScroll(entityKey, {
    ...(options?.includeVertical === false ? null : { vertical: shell?.scrollTop ?? 0 }),
    rows: rowsMap,
  });
}

// Backdrop propio: el primer fondo disponible de la row más popular
// (las rows ya vienen rankeadas). Versión w1280: basta para un fondo blureado.
function pickEntityBackdrop(rows: EntityRowData[]): string {
  for (const row of rows) {
    const item = row.items.find(entry => entry.background) ?? row.items[0];
    const background = item?.background;
    if (background) return shrinkBackdrop(background);
  }
  return "";
}

// w1280 basta para un fondo blureado (no-op si no es URL TMDB original).
function shrinkBackdrop(url: string): string {
  if (!url) return "";
  return url.includes("/original/") ? url.replace("/original/", "/w1280/") : url;
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

function EntitySkeletonContent({ showEmpty }: { showEmpty: boolean }) {
  if (showEmpty) {
    return (
      <div className="entity-page-scale min-h-screen text-white" style={{ position: "relative", zIndex: 1, paddingTop: "var(--app-shell-nav-height)", paddingBottom: "var(--app-gutter-bottom)" }}>
        <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.42)" }}>
          No se encontró esta entidad.
        </div>
      </div>
    );
  }
  return (
    <div className="entity-page-scale min-h-screen pb-14 text-white" style={{ position: "relative", zIndex: 1, paddingTop: "var(--app-shell-nav-height)" }}>
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "var(--app-gutter-x)", alignItems: "center", padding: "var(--app-hero-top) var(--app-gutter-x) 0", marginBottom: "var(--app-gutter-bottom)" }}>
          <div className="skeleton" style={{ height: 150, borderRadius: 22 }} />
          <div>
            <div className="skeleton" style={{ height: 34, width: 260, borderRadius: 10, marginBottom: 16 }} />
            <div className="skeleton" style={{ height: 14, width: "70%", borderRadius: 8, marginBottom: 9 }} />
            <div className="skeleton" style={{ height: 14, width: "58%", borderRadius: 8 }} />
          </div>
        </div>
        {[0, 1].map(row => (
          <div key={row} style={{ marginBottom: 42 }}>
            <div className="skeleton" style={{ height: 20, width: 170, borderRadius: 8, margin: "0 var(--app-gutter-x) 16px" }} />
            <div style={{ display: "flex", gap: 22, overflow: "hidden", padding: "0 var(--app-gutter-x)" }}>
              {[0, 1, 2, 3, 4].map(item => <div key={item} className="skeleton" style={{ width: 207, height: 312, borderRadius: 10, flexShrink: 0 }} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

