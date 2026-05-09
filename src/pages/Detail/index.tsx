import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Play, X, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { getTmdbApiKey } from "../../config/apiKeys";
import { useAddonStore } from "../../store/addonStore";
import type { MediaStream } from "../../types/stream";
import {
  buildMediaKey,
  formatResumeTime,
  getLatestResumeForMedia,
  progressPercent,
  readContinueWatchingEntries,
  type ContinueWatchingEntry,
} from "../../utils/continueWatching";
import { readCachedLogo, sanitizeLogoUrl, writeCachedLogo } from "../../utils/artwork";
import { SELECTED_ENGINE_KEY, SELECTED_MEDIA_META_KEY, SELECTED_STREAM_KEY } from "../Player/utils";

const TMDB     = "https://api.themoviedb.org/3";
const IMG      = "https://image.tmdb.org/t/p";
const DEBUG_LOGO = false;
const DETAIL_LOGO_KEY = "aetherio-detail-logo";

function getDetailLogoKey(type?: string, id?: string) {
  return type && id ? `${DETAIL_LOGO_KEY}:${type}:${id}` : DETAIL_LOGO_KEY;
}

function addonSupportsMeta(addon: any, type: string, id: string) {
  const resources = addon.manifest?.resources ?? [];
  const supportsMeta = resources.some((resource: any) => {
    if (typeof resource === "string") return resource === "meta";
    return resource?.name === "meta";
  });
  if (!supportsMeta && resources.length > 0) return false;

  const types = addon.manifest?.types;
  if (Array.isArray(types) && types.length > 0 && !types.includes(type)) return false;

  const prefixes = addon.manifest?.idPrefixes;
  if (id.startsWith("tmdb:") && (!Array.isArray(prefixes) || !prefixes.includes("tmdb"))) return false;
  if (Array.isArray(prefixes) && prefixes.length > 0 && !prefixes.some((prefix: string) => id.startsWith(prefix))) return false;

  return true;
}

interface CastMember { id:number;name:string;character:string;profile_path?:string; }
interface Trailer    { key:string;name:string; }
interface Related    { id:number;title?:string;poster_path?:string;media_type:string; }
interface Episode    { id:string;episode:number;season:number;name?:string;overview?:string;still?:string;runtime?:number; }
interface DetailData {
  id:string;name:string;type:string;
  backdrop?:string;poster?:string;logo?:string;
  description?:string;year?:number;runtime?:string;
  genres?:string[];rating?:string;cast?:CastMember[];
  director?:string;trailers?:Trailer[];related?:Related[];
  seasons?:{number:number;episodes:Episode[]}[];
}

export default function DetailPage() {
  const { type, id } = useParams<{type:string;id:string}>();
  const navigate = useNavigate();
  const [data, setData]         = useState<DetailData|null>(null);
  const [loading, setLoading]   = useState(true);
  const [season, setSeason]     = useState(1);
  const [showMore, setShowMore] = useState(false);
  const [logoStatus, setLogoStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [cachedLogo, setCachedLogo] = useState<string | null>(() => readCachedLogo(getDetailLogoKey(type, id)));
  const getEnabled = useAddonStore(s => s.getEnabledAddons);

  function logoLog(event: string, extra?: Record<string, unknown>) {
    if (!DEBUG_LOGO) return;
    console.info("[AETHERIO:DETAIL:LOGO]", {
      event,
      ts: Number(performance.now().toFixed(1)),
      mediaType: type,
      mediaId: id,
      dataLogo: data?.logo ?? null,
      logoStatus,
      ...extra,
    });
  }

  useEffect(() => { if (type && id) load(type, id); }, [type, id]);
  useEffect(() => {
    if (data?.logo || cachedLogo) setLogoStatus("loaded");
    else setLogoStatus("idle");
  }, [data?.id, data?.logo, cachedLogo]);

  useEffect(() => {
    setCachedLogo(readCachedLogo(getDetailLogoKey(type, id)));
  }, [type, id]);

  async function load(t:string, mediaId:string) {
    setLoading(true);
    const cachedMediaLogo = readCachedLogo(getDetailLogoKey(t, mediaId)) ?? undefined;
    let d:DetailData = {
      id: mediaId,
      name: "",
      type: t,
      logo: cachedMediaLogo,
    };
    for (const addon of getEnabled()) {
      try {
        if (!addonSupportsMeta(addon, t, mediaId)) continue;
        const base = addon.url.replace(/\/manifest\.json$/,"").replace(/\/$/,"");
        const endpoint = `${base}/meta/${t}/${encodeURIComponent(mediaId)}.json`;
        logoLog("meta request start", { addonId: addon.id, endpoint });
        const res  = await fetch(endpoint);
        logoLog("meta response", { addonId: addon.id, endpoint, status: res.status, ok: res.ok });
        if (!res.ok) continue;
        const json = await res.json();
        const m    = json.meta ?? json;
        logoLog("meta payload mapped", {
          addonId: addon.id,
          payloadKeys: Object.keys(m ?? {}),
          rawLogo: m?.logo ?? null,
          background: m?.background ?? m?.backdrop ?? null,
          poster: m?.poster ?? null,
        });
        d = { ...d, name:m.name??d.name, backdrop:m.background??m.backdrop, poster:m.poster, logo:sanitizeLogoUrl(m.logo) ?? d.logo,
          description:m.description, year:m.year, runtime:m.runtime, genres:m.genres, rating:m.imdbRating,
          cast:Array.isArray(m.cast)?m.cast.map((c:any)=>({ id:c.id??Math.random(), name:typeof c==="string"?c:c.name, character:c.character??"", profile_path:c.image })):undefined,
          director:Array.isArray(m.director)?m.director.join(", "):m.director };
        break;
      } catch {}
    }

    try {
      const tmdbKey = getTmdbApiKey();
      if (!tmdbKey) {
        setData(d);
        setLoading(false);
        return;
      }
      let tmdbId:number|null = null;
      if (mediaId.startsWith("tt")) {
        const fr = await fetch(`${TMDB}/find/${mediaId}?api_key=${tmdbKey}&external_source=imdb_id&language=es-ES`);
        const fd = await fr.json();
        const rs = fd.movie_results?.length?fd.movie_results:fd.tv_results??[];
        tmdbId = rs[0]?.id??null;
      } else if (mediaId.startsWith("tmdb:")) {
        tmdbId = parseInt(mediaId.replace("tmdb:",""),10);
      }
      if (!tmdbId && d.name) {
        const ep = t==="movie"
          ?`${TMDB}/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(d.name)}&language=es-ES`
          :`${TMDB}/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(d.name)}&language=es-ES`;
        const sr=await fetch(ep); const sd=await sr.json(); tmdbId=sd.results?.[0]?.id??null;
      }
      if (!tmdbId) { setData(d); setLoading(false); return; }

      const ep2 = t==="movie"?`${TMDB}/movie/${tmdbId}`:`${TMDB}/tv/${tmdbId}`;
      const [mainRes,imgRes]=await Promise.all([
        fetch(`${ep2}?api_key=${tmdbKey}&language=es-ES&append_to_response=credits,videos,similar`),
        fetch(`${ep2}/images?api_key=${tmdbKey}&include_image_language=en,es,null`),
      ]);
      const main=await mainRes.json(); const imgs=await imgRes.json();

      const logo=imgs.logos?.[0];
      if (logo&&!d.logo)              d.logo=`${IMG}/w500${logo.file_path}`;
      logoLog("tmdb logo fallback", { tmdbLogoPath: logo?.file_path ?? null, resolvedLogo: d.logo ?? null });
      if (!d.backdrop&&main.backdrop_path) d.backdrop=`${IMG}/original${main.backdrop_path}`;
      if (!d.poster&&main.poster_path)     d.poster=`${IMG}/w780${main.poster_path}`;
      if (!d.description) d.description=main.overview;
      if (!d.year) d.year=parseInt((main.release_date??main.first_air_date??"").slice(0,4),10)||undefined;
      if (!d.genres?.length) d.genres=main.genres?.map((g:any)=>g.name);
      if (!d.name) d.name=main.title??main.name??"";
      if (!d.runtime){ const mins=t==="movie"?main.runtime:main.episode_run_time?.[0]; if(mins) d.runtime=`${Math.floor(mins/60)}h ${mins%60}min`; }
      if (!d.cast?.length) d.cast=(main.credits?.cast??[]).slice(0,14).map((c:any)=>({ id:c.id,name:c.name,character:c.character,profile_path:c.profile_path?`${IMG}/w185${c.profile_path}`:undefined }));
      if (!d.director){ const dir=(main.credits?.crew??[]).find((c:any)=>c.job==="Director"); if(dir) d.director=dir.name; }
      d.trailers=(main.videos?.results??[]).filter((v:any)=>v.site==="YouTube"&&(v.type==="Trailer"||v.type==="Teaser")).slice(0,5).map((v:any)=>({key:v.key,name:v.name}));
      d.related=(main.similar?.results??[]).slice(0,14).map((r:any)=>({ id:r.id, title:r.title??r.name, poster_path:r.poster_path?`${IMG}/w342${r.poster_path}`:undefined, media_type:t }));

      if (t!=="movie"&&main.seasons) {
        const seasons=[];
        for (const s of (main.seasons??[]).filter((s:any)=>s.season_number>0).slice(0,8)) {
          try {
            const sr2=await fetch(`${TMDB}/tv/${tmdbId}/season/${s.season_number}?api_key=${tmdbKey}&language=es-ES`);
            const sd2=await sr2.json();
            seasons.push({ number:s.season_number, episodes:(sd2.episodes??[]).map((e:any)=>({ id:`${tmdbId}:${s.season_number}:${e.episode_number}`, episode:e.episode_number, season:s.season_number, name:e.name, overview:e.overview, still:e.still_path?`${IMG}/w500${e.still_path}`:undefined, runtime:e.runtime })) });
          } catch {}
        }
        d.seasons=seasons;
      }
    } catch(e){ console.warn("TMDB:",e); }

    logoLog("detail data ready", { resolvedLogo: d.logo ?? null });
    if (d.logo) setCachedLogo(writeCachedLogo(getDetailLogoKey(t, mediaId), d.logo) ?? null);
    setData(d); setLoading(false);
  }

  const episodeProgressMap = useMemo(() => {
    if (!data || data.type === "movie") return new Map<string, ContinueWatchingEntry>();
    const mediaKey = buildMediaKey(data.type, data.id);
    const map = new Map<string, ContinueWatchingEntry>();
    for (const entry of readContinueWatchingEntries()) {
      if (entry.mediaKey !== mediaKey) continue;
      if (!entry.season || !entry.episode) continue;
      const key = `${entry.season}:${entry.episode}`;
      if (!map.has(key)) map.set(key, entry);
    }
    return map;
  }, [data]);

  if (loading) return <div className="skeleton" style={{ width:"100vw", height:"100vh", marginTop:"calc(-1 * var(--app-shell-nav-height))" }} />;
  if (!data)   return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"80vh",color:"rgba(255,255,255,0.4)" }}>Error cargando.</div>;

  const isMovie = data.type==="movie";
  const typeLabel = isMovie?"Película":data.type==="anime"?"Anime":"Programa de TV";
  const DESC_MAX  = 180;
  const descShort = (data.description??"").length>DESC_MAX?(data.description??"").slice(0,DESC_MAX)+"…":(data.description??"");
  const hasMore   = (data.description??"").length>DESC_MAX;
  const curSeason = data.seasons?.find(s=>s.number===season)??data.seasons?.[0];
  const displayLogo = sanitizeLogoUrl(data.logo) || cachedLogo;
  const resumeEntry = getLatestResumeForMedia(data.type, data.id);
  const playLabel = resumeEntry ? `Continuar ${formatResumeTime(resumeEntry.currentTime)}` : "Reproducir";

  // Navegar al selector de fuentes
  function goToStreams(season?: number, ep?: number) {
    const q = new URLSearchParams({ type: data!.type, id: data!.id });
    if (season) q.set("season", String(season));
    if (ep)     q.set("ep", String(ep));
    navigate(`/streams?${q.toString()}`);
  }

  function playFromDetail() {
    const current = data;
    if (!current) return;
    const resume = getLatestResumeForMedia(current.type, current.id);
    if (resume) {
      goToStreams(resume.season, resume.episode);
      return;
    }

    if (isMovie) {
      goToStreams();
      return;
    }

    const firstSeason = current.seasons?.[0];
    const firstEpisode = firstSeason?.episodes?.[0];
    if (firstSeason?.number && firstEpisode?.episode) {
      goToStreams(firstSeason.number, firstEpisode.episode);
      return;
    }

    goToStreams();
  }

  return (
    <div style={{ minHeight:"100vh", background:"#1f1f1f" }}>

      {/* ══ HERO — full-bleed ════════════════════════════════ */}
      <div style={{ position:"relative", width:"100vw", left:"50%", marginLeft:"-50vw", height:"calc(92vh + var(--app-shell-nav-height))", minHeight:600, marginTop:"calc(-1 * var(--app-shell-nav-height))", overflow:"hidden" }}>
        {(data.backdrop??data.poster)&&(
          <img src={data.backdrop??data.poster} alt=""
            style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",objectPosition:"center top" }} />
        )}
        <div style={{ position:"absolute",inset:0,background:"linear-gradient(to right,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.4) 40%,transparent 65%)",pointerEvents:"none" }} />
        <div style={{ position:"absolute",inset:0,background:"linear-gradient(to top,rgba(31,31,31,1) 0%,rgba(31,31,31,0.55) 22%,transparent 52%)",pointerEvents:"none" }} />

        <div style={{ position:"absolute",bottom:0,left:0,padding:"0 var(--app-safe-x) 36px",maxWidth:520 }}>
          {displayLogo && logoStatus !== "error" ? (
            <div style={{ minHeight:100,display:"flex",alignItems:"center",marginBottom:14,position:"relative" }}>
              <img
                src={displayLogo}
                alt={data.name}
                onLoad={() => {
                  logoLog("logo img onLoad", { url: displayLogo });
                  setLogoStatus("loaded");
                }}
                onError={() => {
                  logoLog("logo img onError", { url: displayLogo });
                  setLogoStatus("error");
                }}
                style={{ maxHeight:100,maxWidth:300,objectFit:"contain",filter:"drop-shadow(0 2px 10px rgba(0,0,0,0.75))",opacity:1, transition:"opacity 0.35s ease", display:"block" }}
              />
            </div>
          ) : (
            <h1 style={{ fontSize:"2.6rem",fontWeight:900,color:"#fff",marginBottom:14,lineHeight:1.05,textShadow:"0 2px 20px rgba(0,0,0,0.8)" }}>{data.name}</h1>
          )}
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap" }}>
            <span style={{ fontSize:15,color:"rgba(255,255,255,0.65)",fontWeight:500 }}>{typeLabel}</span>
            {data.genres?.slice(0,2).map(g=><span key={g} style={{ fontSize:15,color:"rgba(255,255,255,0.55)" }}>· {g}</span>)}
            {data.rating&&<span style={{ fontSize:13,color:"rgba(255,255,255,0.5)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:4,padding:"2px 7px" }}>{data.rating}+</span>}
          </div>
          <div style={{ marginBottom:12 }}>
            <span style={{ fontSize:15,color:"rgba(255,255,255,0.65)",lineHeight:1.6 }}>{descShort}</span>
            {hasMore&&<button onClick={()=>setShowMore(true)} style={{ fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.7)",background:"none",border:"none",cursor:"pointer",marginLeft:6 }}>MÁS</button>}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:18,flexWrap:"wrap" }}>
            {data.year&&<span style={{ fontSize:13,color:"rgba(255,255,255,0.5)" }}>{data.year}</span>}
            {data.runtime&&<span style={{ fontSize:13,color:"rgba(255,255,255,0.5)" }}>· {data.runtime}</span>}
            {["4K","DV","Atmos","CC","SDH"].map(b=>(
              <span key={b} style={{ fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.4)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:4,padding:"2px 5px",letterSpacing:0 }}>{b}</span>
            ))}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            {/* Reproducir → /streams */}
            <button onClick={playFromDetail}
              style={{ display:"flex",alignItems:"center",gap:8,padding:"11px 30px",background:"#fff",color:"#000",fontWeight:700,borderRadius:999,fontSize:15,border:"none",cursor:"pointer",boxShadow:"0 3px 12px rgba(0,0,0,0.38)" }}>
              <Play size={16} fill="black" /> {playLabel}
            </button>
          </div>
        </div>

        {(data.cast?.length||data.director)&&(
          <div style={{ position:"absolute",bottom:0,right:0,padding:"0 var(--app-safe-x) 36px",textAlign:"right",maxWidth:300 }}>
            {!!data.cast?.length&&<p style={{ fontSize:13,color:"rgba(255,255,255,0.55)",marginBottom:5 }}><span style={{ color:"rgba(255,255,255,0.3)" }}>Reparto </span>{data.cast.slice(0,3).map(c=>c.name).join(", ")}</p>}
            {data.director&&<p style={{ fontSize:13,color:"rgba(255,255,255,0.55)" }}><span style={{ color:"rgba(255,255,255,0.3)" }}>Dirección </span>{data.director}</p>}
          </div>
        )}
      </div>

      {/* ══ SECCIONES INFERIORES ═════════════════════════════ */}
      <div style={{ padding:"36px var(--app-safe-x)",display:"flex",flexDirection:"column",gap:44,background:"#1f1f1f" }}>

        {/* Episodios */}
        {!isMovie&&curSeason&&(
          <section>
            <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:18 }}>
              <h2 style={{ fontSize:17,fontWeight:700,color:"#fff" }}>Temporada {season}</h2>
              {(data.seasons?.length??0)>1&&(
                <select value={season} onChange={e=>setSeason(Number(e.target.value))}
                  style={{ background:"rgba(255,255,255,0.1)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:999,color:"#fff",fontSize:13,padding:"5px 14px",cursor:"pointer" }}>
                  {data.seasons?.map(s=><option key={s.number} value={s.number} style={{background:"#1c1c1e"}}>Temporada {s.number}</option>)}
                </select>
              )}
            </div>
            <ScrollRow gap={10}>
              {curSeason.episodes.map(ep=>(
                <EpCard
                  key={ep.id}
                  ep={ep}
                  progressEntry={episodeProgressMap.get(`${ep.season}:${ep.episode}`)}
                  onPlay={()=>goToStreams(ep.season,ep.episode)}
                />
              ))}
            </ScrollRow>
          </section>
        )}

        {!!data.trailers?.length&&(
          <section>
            <SectionH title="Tráilers" />
            <ScrollRow gap={10}>
              {data.trailers.map(t=><TrailerCard key={t.key} trailer={t} media={data} />)}
            </ScrollRow>
          </section>
        )}

        {!!data.cast?.length&&(
          <section>
            <SectionH title="Reparto y equipo" />
            <ScrollRow gap={18}>
              {data.cast.map(c=><CastCard key={c.id} member={c} onPress={()=>navigate(`/person/${c.id}`)} />)}
            </ScrollRow>
          </section>
        )}

        {!!data.related?.length&&(
          <section>
            <SectionH title="Títulos relacionados" />
            <ScrollRow gap={8}>
              {data.related.map(r=>(
                <div key={r.id}
                  onClick={()=>navigate(`/detail/${r.media_type}/tmdb:${r.id}`)}
                  style={{ flexShrink:0,width:180,height:271,borderRadius:10,overflow:"hidden",cursor:"pointer",transition:"transform 0.25s",background:"#1c1c1e" }}
                  onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.transform="scale(1.04)"}
                  onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.transform="scale(1)"}
                >
                  {r.poster_path?<img src={r.poster_path} alt="" loading="lazy" decoding="async" style={{ width:"100%",height:"100%",objectFit:"cover" }} />:<div style={{ width:"100%",height:"100%",background:"#2c2c2e" }}/>}
                </div>
              ))}
            </ScrollRow>
          </section>
        )}
      </div>

      {showMore&&(
        <div onClick={()=>setShowMore(false)}
          style={{ position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.75)",backdropFilter:"blur(3px)",WebkitBackdropFilter:"blur(3px)" }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:"rgba(20,20,22,0.95)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,padding:36,maxWidth:500,margin:"0 16px",position:"relative" }}>
            <button onClick={()=>setShowMore(false)} style={{ position:"absolute",top:16,right:16,background:"none",border:"none",color:"rgba(255,255,255,0.5)",cursor:"pointer" }}><X size={18}/></button>
            <p style={{ fontSize:15,color:"rgba(255,255,255,0.8)",lineHeight:1.7,paddingRight:28 }}>{data.description}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionH({ title }:{title:string}) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:16 }}>
      <h2 style={{ fontSize:17,fontWeight:700,color:"#fff" }}>{title}</h2>
      <ChevronRight size={15} style={{ color:"rgba(255,255,255,0.35)",marginTop:1 }} />
    </div>
  );
}

function ScrollRow({ children, gap = 10 }:{children:ReactNode;gap?:number}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const row = rowRef.current;
    if (!row) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxLeft = row.scrollWidth - row.clientWidth;
    setCanScrollLeft(row.scrollLeft > 2);
    setCanScrollRight(maxLeft - row.scrollLeft > 2);
  }

  useEffect(() => {
    updateScrollState();
    const row = rowRef.current;
    if (!row) return;
    const onScroll = () => updateScrollState();
    row.addEventListener("scroll", onScroll, { passive: true });
    const onResize = () => updateScrollState();
    window.addEventListener("resize", onResize);
    const resizeObserver = new ResizeObserver(() => updateScrollState());
    resizeObserver.observe(row);
    return () => {
      row.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      resizeObserver.disconnect();
    };
  }, [children]);

  const move = (direction:"left"|"right") => {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction === "right" ? row.clientWidth * 0.82 : -row.clientWidth * 0.82, behavior:"smooth" });
  };

  return (
    <div style={{ position:"relative" }}>
      {canScrollLeft ? (
        <button
          onClick={()=>move("left")}
          title="Anterior"
          aria-label="Anterior"
          style={{ position:"absolute",left:0,top:"50%",zIndex:3,width:38,height:38,transform:"translate(-30%,-50%)",borderRadius:"50%",border:"1px solid rgba(255,255,255,0.18)",background:"rgba(18,18,18,0.72)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}
        >
          <ChevronLeft size={18} />
        </button>
      ) : null}
      <div ref={rowRef} style={{ display:"flex",gap,overflowX:"auto",paddingBottom:8,scrollbarWidth:"none",scrollBehavior:"smooth" }}>
        {children}
      </div>
      {canScrollRight ? (
        <button
          onClick={()=>move("right")}
          title="Siguiente"
          aria-label="Siguiente"
          style={{ position:"absolute",right:0,top:"50%",zIndex:3,width:38,height:38,transform:"translate(30%,-50%)",borderRadius:"50%",border:"1px solid rgba(255,255,255,0.18)",background:"rgba(18,18,18,0.72)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}
        >
          <ChevronRight size={18} />
        </button>
      ) : null}
    </div>
  );
}

function EpCard({
  ep,
  progressEntry,
  onPlay,
}:{ep:Episode; progressEntry?: ContinueWatchingEntry; onPlay:()=>void}) {
  const watched = Boolean(progressEntry?.completed);
  const progress = progressEntry ? progressPercent(progressEntry) : 0;
  const showProgress = !watched && progress > 0.5;

  return (
    <div onClick={onPlay}
      style={{ flexShrink:0,width:302,height:196,borderRadius:10,overflow:"hidden",cursor:"pointer",position:"relative",background:"#1c1c1e",transition:"transform 0.25s" }}
      onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.transform="scale(1.03)"}
      onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.transform="scale(1)"}
    >
      {ep.still&&<img src={ep.still} alt="" loading="lazy" decoding="async" style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover" }} />}
      <div style={{ position:"absolute",left:0,right:0,bottom:0,height:"25%",pointerEvents:"none",
        background:"linear-gradient(to top, rgba(31,31,31,1) 0%, rgba(31,31,31,1) 30%, rgba(31,31,31,0.9) 52%, rgba(31,31,31,0.58) 74%, rgba(31,31,31,0.18) 90%, rgba(31,31,31,0) 100%)" }} />
      {watched ? (
        <div style={{ position:"absolute",right:10,top:10,display:"flex",alignItems:"center",gap:5,borderRadius:999,padding:"3px 8px",background:"rgba(12,16,14,0.78)",border:"1px solid rgba(166,244,188,0.42)" }}>
          <Check size={13} style={{ color:"#9ef2b5" }} />
          <span style={{ fontSize:10,fontWeight:700,color:"#c8f7d7",letterSpacing:0 }}>VISTO</span>
        </div>
      ) : null}
      <div style={{ position:"absolute",bottom:0,left:0,right:0,
        padding:"22px 12px 10px" }}>
        <p style={{ fontSize:10,color:"rgba(255,255,255,0.5)",marginBottom:3,letterSpacing:0 }}>EPISODIO {ep.episode}</p>
        <p style={{ fontSize:14,fontWeight:700,color:"#fff",marginBottom:3,lineHeight:1.3 }}>{ep.name??`Episodio ${ep.episode}`}</p>
        {ep.overview&&<p style={{ fontSize:13,color:"rgba(255,255,255,0.55)",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",lineHeight:1.4,marginBottom:3 }}>{ep.overview}</p>}
        {ep.runtime&&<p style={{ fontSize:12,color:"rgba(255,255,255,0.4)" }}>{ep.runtime} min</p>}
        {showProgress ? (
          <div style={{ marginTop:6,height:2,overflow:"hidden",borderRadius:999,background:"rgba(255,255,255,0.24)" }}>
            <div style={{ width:`${progress}%`,height:"100%",borderRadius:999,background:"#fff" }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TrailerCard({ trailer, media }:{trailer:Trailer;media:DetailData}) {
  const navigate = useNavigate();
  const [thumbSrc, setThumbSrc] = useState(`https://img.youtube.com/vi/${trailer.key}/maxresdefault.jpg`);

  function playTrailer() {
    const stream: MediaStream = {
      id: `tmdb-trailer-${trailer.key}`,
      addonId: "tmdb",
      addonName: "TMDB",
      name: "Trailer",
      title: trailer.name,
      description: `Trailer - ${media.name}`,
      ytId: trailer.key,
      behaviorHints: {
        background: media.backdrop,
        poster: media.poster,
      },
    };

    sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(stream));
    sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
    sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
      name: `${media.name} - Trailer`,
      logo: sanitizeLogoUrl(media.logo),
      background: media.backdrop ?? media.poster,
    }));

    const q = new URLSearchParams({ type: media.type, id: media.id });
    navigate(`/player?${q.toString()}`);
  }

  return (
    <button
      type="button"
      onClick={playTrailer}
      style={{ flexShrink:0,width:302,height:232,borderRadius:10,overflow:"hidden",display:"block",position:"relative",cursor:"pointer",background:"#1c1c1e",textDecoration:"none",transition:"transform 0.25s",border:"none",padding:0,textAlign:"left" }}
      onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.transform="scale(1.03)"}
      onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.transform="scale(1)"}
    >
      <img src={thumbSrc} alt={trailer.name}
        onError={() => setThumbSrc(`https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg`)}
        loading="lazy"
        decoding="async"
        style={{ width:"100%",height:"100%",objectFit:"cover" }} />
      <div style={{ position:"absolute",left:0,right:0,bottom:0,height:"25%",pointerEvents:"none",
        background:"linear-gradient(to top, rgba(31,31,31,1) 0%, rgba(31,31,31,1) 30%, rgba(31,31,31,0.9) 52%, rgba(31,31,31,0.58) 74%, rgba(31,31,31,0.18) 90%, rgba(31,31,31,0) 100%)" }} />
      <div style={{ position:"absolute",bottom:0,left:0,right:0,
        padding:"32px 12px 10px" }}>
        <p style={{ fontSize:15,fontWeight:700,color:"#fff",marginBottom:4 }}>{media.name}</p>
        <p style={{ fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.5)" }}>▶ {trailer.name}</p>
      </div>
    </button>
  );
}

function CastCard({ member, onPress }:{member:CastMember;onPress:()=>void}) {
  return (
    <div onClick={onPress} style={{ flexShrink:0,width:142,display:"flex",flexDirection:"column",alignItems:"center",gap:8,cursor:"pointer" }}>
      {member.profile_path?(
        <img src={member.profile_path} alt={member.name} loading="lazy" decoding="async" style={{ width:142,height:142,borderRadius:"50%",objectFit:"cover",flexShrink:0 }} />
      ):(
        <div style={{ width:142,height:142,borderRadius:"50%",background:"#2c2c2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:40,color:"rgba(255,255,255,0.5)",fontWeight:700,flexShrink:0 }}>
          {member.name.charAt(0)}
        </div>
      )}
      <p style={{ fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.6)",textAlign:"center",lineHeight:1.3 }}>{member.name}</p>
      {member.character&&<p style={{ fontSize:12,fontWeight:700,color:"#fff",textAlign:"center",marginTop:-5,lineHeight:1.3 }}>{member.character}</p>}
    </div>
  );
}
