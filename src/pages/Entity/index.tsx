import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import { tmdbFetch } from "../../config/apiKeys";
import { useHorizontalVirtualWindow } from "../../hooks/useHorizontalVirtualWindow";
import { buildMediaKey, CONTINUE_WATCHING_EVENT, readPlaybackStateEntries } from "../../utils/continueWatching";
import { writeDetailMediaMeta } from "../../utils/mediaMetadata";
import { scrollByGsap, tweenTo, useGsapState } from "../../utils/motion";

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

interface EntityMediaItem {
  id: number;
  name: string;
  type: "movie" | "series";
  poster?: string;
  background?: string;
  description?: string;
  year?: number;
}

interface EntityRowData {
  title: string;
  items: EntityMediaItem[];
}

export default function EntityPage() {
  const { kind, id } = useParams<{ kind: EntityKind; id: string }>();
  const navigate = useNavigate();
  const [entity, setEntity] = useState<EntityData | null>(null);
  const [rows, setRows] = useState<EntityRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [watchedVersion, setWatchedVersion] = useState(0);
  const watchedMediaKeys = useMemo(() => new Set(
    readPlaybackStateEntries()
      .filter(entry => entry.completed)
      .map(entry => entry.mediaKey),
  ), [watchedVersion]);

  useEffect(() => {
    if (!kind || !id) return;
    void load(kind, id);
  }, [kind, id]);

  useEffect(() => {
    const refresh = () => setWatchedVersion(version => version + 1);
    window.addEventListener(CONTINUE_WATCHING_EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CONTINUE_WATCHING_EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function load(rawKind: string, rawId: string) {
    setLoading(true);
    try {
      const entityKind = rawKind === "network" ? "network" : "company";
      const entityId = Number(rawId);
      if (!Number.isFinite(entityId) || entityId <= 0) {
        setEntity(null);
        setRows([]);
        return;
      }

      const tvDiscover = buildDiscoverParams(entityKind, "tv", entityId);
      const movieDiscover = buildDiscoverParams(entityKind, "movie", entityId);
      const [detailRes, tvRes, movieRes] = await Promise.all([
        tmdbFetch(`/${entityKind}/${entityId}`),
        tmdbFetch(tvDiscover.path, { params: tvDiscover.params }),
        tmdbFetch(movieDiscover.path, { params: movieDiscover.params }),
      ]);
      if (!detailRes) {
        setEntity(null);
        setRows([]);
        return;
      }

      const detail = detailRes;
      const tvData = tvRes;
      const movieData = movieRes;

      const nextEntity: EntityData = {
        id: entityId,
        name: detail.name ?? "",
        description: buildEntityDescription(entityKind, detail),
        logo: detail.logo_path ? `${IMG}/w500${detail.logo_path}` : undefined,
        homepage: detail.homepage,
        headquarters: detail.headquarters,
        originCountry: detail.origin_country,
      };

      const nextRows: EntityRowData[] = [
        {
          title: "Programas de TV",
          items: mapEntityResults(tvData?.results, "series"),
        },
        {
          title: "Películas",
          items: mapEntityResults(movieData?.results, "movie"),
        },
      ].filter(row => row.items.length > 0);

      setEntity(nextEntity);
      setRows(nextRows);
    } catch (error) {
      console.warn("Entity load error:", error);
      setEntity(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <EntitySkeleton />;
  if (!entity) {
    return (
      <div style={{ minHeight:"80vh",display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.42)" }}>
        No se encontró esta entidad.
      </div>
    );
  }

  return (
    <PageContainer fullBleed className="min-h-screen bg-[#1f1f1f] pb-14 pt-24 text-white">
      <div style={{ width:"min(1180px, calc(100vw - var(--app-safe-x) * 2))",margin:"0 auto" }}>
        <header style={{ display:"grid",gridTemplateColumns:"minmax(180px, 260px) minmax(0, 1fr)",gap:32,alignItems:"center",marginBottom:48 }}>
          <div style={{ height:150,borderRadius:22,padding:26,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid rgba(255,255,255,0.78)",background:"linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,242,246,0.9))",boxShadow:"0 18px 44px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.92)" }}>
            {entity.logo ? (
              <img src={entity.logo} alt={entity.name} decoding="async" style={{ maxWidth:"100%",maxHeight:"100%",objectFit:"contain",filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.16))" }} />
            ) : (
              <span style={{ fontSize:28,fontWeight:800,color:"rgba(22,24,28,0.92)",textAlign:"center",lineHeight:1.1 }}>{entity.name}</span>
            )}
          </div>
          <div>
            <p style={{ fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.42)",marginBottom:8 }}>
              {kind === "network" ? "Cadena" : "Producción"}
            </p>
            <h1 style={{ fontSize:"2.35rem",fontWeight:800,color:"#fff",lineHeight:1.05,marginBottom:14 }}>{entity.name}</h1>
            <p style={{ maxWidth:720,fontSize:15,lineHeight:1.72,color:"rgba(255,255,255,0.68)",fontWeight:400 }}>{entity.description}</p>
            <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginTop:16 }}>
              {entity.headquarters ? <EntityMetaPill>{entity.headquarters}</EntityMetaPill> : null}
              {entity.originCountry ? <EntityMetaPill>{entity.originCountry}</EntityMetaPill> : null}
              {entity.homepage ? <EntityMetaPill>{new URL(entity.homepage).hostname.replace(/^www\./, "")}</EntityMetaPill> : null}
            </div>
          </div>
        </header>

        <div style={{ display:"flex",flexDirection:"column",gap:42 }}>
          {rows.map(row => <EntityMediaRow key={row.title} row={row} watchedMediaKeys={watchedMediaKeys} onOpen={item => openMedia(item, navigate)} />)}
          {rows.length === 0 ? (
            <div className="liquid-glass-dark" style={{ borderRadius:18,padding:22,color:"rgba(255,255,255,0.54)",fontSize:14 }}>
              No se encontraron títulos asociados.
            </div>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}

function buildDiscoverParams(kind: EntityKind, mediaType: "movie" | "tv", id: number) {
  const params: Record<string, string> = {
    language: "es-ES",
    sort_by: "popularity.desc",
    include_adult: "false",
    page: "1",
  };
  if (kind === "network" && mediaType === "tv") params.with_networks = String(id);
  else params.with_companies = String(id);
  return { path: `/discover/${mediaType}` as const, params };
}

function buildEntityDescription(kind: EntityKind, detail: any) {
  const description = String(detail.description ?? "").trim();
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
    .filter(item => item?.id && (item.poster_path || item.backdrop_path))
    .slice(0, 24)
    .map(item => ({
      id: item.id,
      type,
      name: item.title ?? item.name ?? "",
      poster: item.poster_path ? `${IMG}/original${item.poster_path}` : undefined,
      background: item.backdrop_path ? `${IMG}/original${item.backdrop_path}` : undefined,
      description: item.overview,
      year: Number(String(item.release_date ?? item.first_air_date ?? "").slice(0, 4)) || undefined,
    }));
}

function openMedia(item: EntityMediaItem, navigate: ReturnType<typeof useNavigate>) {
  const mediaId = `tmdb:${item.id}`;
  writeDetailMediaMeta({
    id: mediaId,
    type: item.type,
    name: item.name,
    poster: item.poster,
    background: item.background,
    description: item.description,
    year: item.year,
  });
  navigate(`/detail/${item.type}/${mediaId}`);
}

function EntityMetaPill({ children }: { children: string }) {
  return (
    <span style={{ borderRadius:999,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.08)",padding:"6px 10px",fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.58)" }}>
      {children}
    </span>
  );
}

function EntityMediaRow({ row, watchedMediaKeys, onOpen }: { row: EntityRowData; watchedMediaKeys: Set<string>; onOpen: (item: EntityMediaItem) => void }) {
  const [hovered, setHovered] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const virtualWindow = useHorizontalVirtualWindow({
    itemCount: row.items.length,
    itemWidth: 184,
    gap: 12,
    overscan: 4,
  });
  const visibleItems = useMemo(
    () => row.items.slice(virtualWindow.start, virtualWindow.end),
    [row.items, virtualWindow.end, virtualWindow.start],
  );
  const { scrollRef } = virtualWindow;

  const updateArrows = () => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScroll = element.scrollWidth - element.clientWidth;
    setShowLeft(element.scrollLeft > 4);
    setShowRight(maxScroll > 4 && element.scrollLeft < maxScroll - 4);
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const timeout = window.setTimeout(updateArrows, 0);
    element.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      window.clearTimeout(timeout);
      element.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [row.items.length]);

  const scroll = (direction: "left" | "right") => {
    const element = scrollRef.current;
    if (!element) return;
    scrollByGsap(element, (direction === "right" ? 1 : -1) * element.clientWidth * 0.82);
  };

  return (
    <section>
      <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16 }}>
        <h2 style={{ fontSize:19,fontWeight:800,color:"#fff" }}>{row.title}</h2>
        <ChevronRight size={16} style={{ color:"rgba(255,255,255,0.34)",marginTop:1 }} />
      </div>
      <div
        style={{ position:"relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <EntityScrollFade side="left" visible={showLeft} />
        <EntityScrollArrow direction="left" visible={hovered && showLeft} onClick={() => scroll("left")} />
        <div ref={scrollRef} style={{ display:"flex",gap:0,overflowX:"auto",paddingBottom:10,scrollbarWidth:"none" }}>
          {virtualWindow.beforeWidth > 0 ? <div aria-hidden="true" style={{ flex:`0 0 ${virtualWindow.beforeWidth}px` }} /> : null}
          {visibleItems.map((item, offset) => {
            const index = virtualWindow.start + offset;
            return (
              <div key={`${row.title}-${item.id}`} style={{ flex:"0 0 auto",marginRight:index === row.items.length - 1 ? 0 : 12 }}>
                <EntityPosterCard item={item} watched={watchedMediaKeys.has(buildMediaKey(item.type, `tmdb:${item.id}`))} onClick={() => onOpen(item)} />
              </div>
            );
          })}
          {virtualWindow.afterWidth > 0 ? <div aria-hidden="true" style={{ flex:`0 0 ${virtualWindow.afterWidth}px` }} /> : null}
        </div>
        <EntityScrollFade side="right" visible={showRight} />
        <EntityScrollArrow direction="right" visible={hovered && showRight} onClick={() => scroll("right")} />
      </div>
    </section>
  );
}

function EntityPosterCard({ item, watched, onClick }: { item: EntityMediaItem; watched: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width:184,height:276,flexShrink:0,border:"1px solid rgba(225,230,238,0.08)",borderRadius:12,overflow:"hidden",background:"#242426",padding:0,cursor:"pointer",position:"relative",textAlign:"left" }}
      onMouseEnter={event => {
        tweenTo(event.currentTarget, { y: -2, borderColor: "rgba(225,230,238,0.14)" });
        const image = event.currentTarget.querySelector("img");
        if (image) tweenTo(image, { scale: 1.045 });
      }}
      onMouseLeave={event => {
        tweenTo(event.currentTarget, { y: 0, borderColor: "rgba(225,230,238,0.08)" });
        const image = event.currentTarget.querySelector("img");
        if (image) tweenTo(image, { scale: 1 });
      }}
    >
      {watched ? (
        <div
          style={{
            position:"absolute",
            top:10,
            right:10,
            zIndex:2,
            width:28,
            height:28,
            borderRadius:999,
            border:"1px solid rgba(255,255,255,0.72)",
            background:"linear-gradient(180deg, rgba(255,255,255,0.96), rgba(242,244,247,0.88))",
            boxShadow:"0 10px 24px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.92)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            backdropFilter:"blur(10px)",
            WebkitBackdropFilter:"blur(10px)",
          }}
        >
          <Check size={15} style={{ color:"rgba(16,18,20,0.94)" }} />
        </div>
      ) : null}
      {item.poster ? (
        <img src={item.poster} alt={item.name} loading="lazy" decoding="async" style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",transform:"scale(1)" }} />
      ) : null}
      {!item.poster ? (
        <div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}>
          <span style={{ color:"rgba(255,255,255,0.64)",fontSize:13,fontWeight:700,textAlign:"center" }}>{item.name}</span>
        </div>
      ) : null}
    </button>
  );
}

function EntityScrollFade({ side, visible }: { side: "left" | "right"; visible: boolean }) {
  const motionRef = useGsapState<HTMLDivElement>({ opacity: visible ? 1 : 0 }, [visible], 0.2);
  return (
    <div
      ref={motionRef}
      aria-hidden="true"
      style={{
        position:"absolute",
        top:0,
        bottom:10,
        [side]:0,
        width:62,
        zIndex:4,
        pointerEvents:"none",
        opacity:0,
        background:side === "left"
          ? "linear-gradient(90deg, rgba(31,31,31,0.96), rgba(31,31,31,0))"
          : "linear-gradient(270deg, rgba(31,31,31,0.96), rgba(31,31,31,0))",
      }}
    />
  );
}

function EntityScrollArrow({ direction, visible, onClick }: { direction: "left" | "right"; visible: boolean; onClick: () => void }) {
  const motionRef = useGsapState<HTMLButtonElement>({ opacity: visible ? 1 : 0 }, [visible]);
  return (
    <button
      ref={motionRef}
      type="button"
      onClick={onClick}
      aria-label={direction === "left" ? "Anterior" : "Siguiente"}
      className="gsap-transition"
      style={{ position:"absolute",top:"50%",[direction === "left" ? "left" : "right"]:8,zIndex:5,width:38,height:38,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.16)",background:"rgba(18,18,18,0.72)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transform:"translateY(-50%)",opacity:0,pointerEvents:visible ? "auto" : "none" }}
    >
      {direction === "left" ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );
}

function EntitySkeleton() {
  return (
    <PageContainer fullBleed className="min-h-screen bg-[#1f1f1f] pb-14 pt-24">
      <div style={{ width:"min(1180px, calc(100vw - var(--app-safe-x) * 2))",margin:"0 auto" }}>
        <div style={{ display:"grid",gridTemplateColumns:"260px 1fr",gap:32,alignItems:"center",marginBottom:48 }}>
          <div className="skeleton" style={{ height:150,borderRadius:22 }} />
          <div>
            <div className="skeleton" style={{ height:34,width:260,borderRadius:10,marginBottom:16 }} />
            <div className="skeleton" style={{ height:14,width:"70%",borderRadius:8,marginBottom:9 }} />
            <div className="skeleton" style={{ height:14,width:"58%",borderRadius:8 }} />
          </div>
        </div>
        {[0, 1].map(row => (
          <div key={row} style={{ marginBottom:42 }}>
            <div className="skeleton" style={{ height:20,width:150,borderRadius:8,marginBottom:16 }} />
            <div style={{ display:"flex",gap:12 }}>
              {[0, 1, 2, 3, 4].map(item => <div key={item} className="skeleton" style={{ width:184,height:276,borderRadius:12 }} />)}
            </div>
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
