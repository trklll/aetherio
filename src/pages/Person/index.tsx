import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTmdbApiKey } from "../../config/apiKeys";

const TMDB     = "https://api.themoviedb.org/3";
const IMG      = "https://image.tmdb.org/t/p";

interface PersonData {
  id: number;
  name: string;
  biography: string;
  profile_path?: string;
  birthday?: string;
  place_of_birth?: string;
  known_for_department?: string;
}

interface CreditItem {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string;
  media_type: "movie" | "tv";
  department?: string;
  character?: string;
  job?: string;
  vote_average?: number;
}

interface CreditGroup {
  label: string;
  items: CreditItem[];
}

// Categorías a mostrar (sin "Para toda la familia")
const DEPT_LABELS: Record<string,string> = {
  Acting:    "Actuación",
  Directing: "Dirección",
  Writing:   "Escritor",
  Production:"Producción",
  Sound:     "Sonido",
  Crew:      "Equipo técnico",
};

export default function PersonPage() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();
  const [person, setPerson]   = useState<PersonData | null>(null);
  const [groups, setGroups]   = useState<CreditGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [bioExpanded, setBioExpanded] = useState(false);

  useEffect(() => { if (id) load(Number(id)); }, [id]);

  async function load(personId: number) {
    setLoading(true);
    try {
      const tmdbKey = getTmdbApiKey();
      if (!tmdbKey) {
        setPerson(null);
        setGroups([]);
        setLoading(false);
        return;
      }
      const [personRes, creditsRes] = await Promise.all([
        fetch(`${TMDB}/person/${personId}?api_key=${tmdbKey}&language=es-ES`),
        fetch(`${TMDB}/person/${personId}/combined_credits?api_key=${tmdbKey}&language=es-ES`),
      ]);

      const personData  = await personRes.json();
      const creditsData = await creditsRes.json();

      setPerson({
        id:          personData.id,
        name:        personData.name,
        biography:   personData.biography ?? "",
        profile_path:personData.profile_path ? `${IMG}/w185${personData.profile_path}` : undefined,
        birthday:    personData.birthday,
        place_of_birth: personData.place_of_birth,
        known_for_department: personData.known_for_department,
      });

      // Agrupar créditos por departamento
      const allCredits: CreditItem[] = [
        ...(creditsData.cast ?? []).map((c: any) => ({ ...c, department: "Acting" })),
        ...(creditsData.crew ?? []).map((c: any) => ({ ...c, department: c.department ?? "Crew" })),
      ];

      // Dedup por id+department
      const seen = new Set<string>();
      const deduped = allCredits.filter(c => {
        const k = `${c.id}:${c.department}`;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });

      // Filtrar solo los que tienen poster y ordenar por popularidad
      const withPoster = deduped.filter(c => c.poster_path);

      // Agrupar
      const deptMap = new Map<string, CreditItem[]>();
      for (const c of withPoster) {
        const dept = c.department ?? "Crew";
        if (!deptMap.has(dept)) deptMap.set(dept, []);
        deptMap.get(dept)!.push(c);
      }

      // Ordenar cada grupo por vote_average desc, max 20 items
      const groupList: CreditGroup[] = [];
      for (const [dept, items] of deptMap.entries()) {
        if (!DEPT_LABELS[dept]) continue; // ignorar departamentos sin etiqueta
        const sorted = items
          .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
          .slice(0, 20);
        groupList.push({ label: DEPT_LABELS[dept], items: sorted });
      }

      // Acting primero
      groupList.sort((a, b) => {
        if (a.label === "Actuación") return -1;
        if (b.label === "Actuación") return 1;
        return 0;
      });

      setGroups(groupList);
    } catch (e) {
      console.warn("Person load error:", e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <LoadingSkeleton />;
  if (!person) return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"80vh",color:"rgba(255,255,255,0.4)" }}>
      No se encontró la persona.
    </div>
  );

  const BIO_MAX = 280;
  const bioShort = person.biography.length > BIO_MAX
    ? person.biography.slice(0, BIO_MAX) + "…"
    : person.biography;
  const hasBioMore = person.biography.length > BIO_MAX;

  return (
    <div style={{ minHeight:"100vh", background:"#1f1f1f", paddingBottom:60 }}>

      {/* ══ HEADER DEL PERSONAJE ══════════════════════════════ */}
      <div style={{
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        gap:32,
        padding:"48px 80px 40px",
        background:"linear-gradient(to bottom,rgba(0,0,0,0.3) 0%,transparent 100%)",
      }}>
        {/* Foto */}
        <div style={{ flexShrink:0 }}>
          {person.profile_path ? (
            <img
              src={person.profile_path}
              alt={person.name}
              decoding="async"
              style={{ width:120,height:120,borderRadius:"50%",objectFit:"cover",border:"3px solid rgba(255,255,255,0.15)" }}
            />
          ) : (
            <div style={{ width:120,height:120,borderRadius:"50%",background:"#2c2c2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:42,color:"rgba(255,255,255,0.5)",fontWeight:700,border:"3px solid rgba(255,255,255,0.1)" }}>
              {person.name.charAt(0)}
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ maxWidth:560 }}>
          <h1 style={{ fontSize:"1.9rem",fontWeight:800,color:"#fff",marginBottom:8,lineHeight:1.1 }}>{person.name}</h1>
          {person.known_for_department && (
            <p style={{ fontSize:14,color:"rgba(255,255,255,0.45)",marginBottom:10 }}>{person.known_for_department}</p>
          )}
          {person.biography && (
            <div>
              <p style={{ fontSize:14,color:"rgba(255,255,255,0.65)",lineHeight:1.7 }}>
                {bioShort}
                {hasBioMore && (
                  <button
                    onClick={() => setBioExpanded(true)}
                    style={{ fontSize:12,color:"rgba(255,255,255,0.5)",background:"none",border:"none",cursor:"pointer",marginLeft:6 }}
                  >
                    MÁS
                  </button>
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ══ GRUPOS DE CRÉDITOS ════════════════════════════════ */}
      <div style={{ display:"flex",flexDirection:"column",gap:40,padding:"0 48px" }}>
        {groups.map(group => (
          <CreditsRow key={group.label} group={group} navigate={navigate} />
        ))}
        {groups.length === 0 && (
          <div style={{ textAlign:"center",color:"rgba(255,255,255,0.3)",paddingTop:40,fontSize:15 }}>
            No se encontraron créditos para esta persona.
          </div>
        )}
      </div>

      {/* BIO POPUP */}
      {bioExpanded && (
        <div
          onClick={() => setBioExpanded(false)}
          style={{ position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.75)",backdropFilter:"blur(3px)",WebkitBackdropFilter:"blur(3px)" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background:"rgba(20,20,22,0.97)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,padding:36,maxWidth:560,margin:"0 20px",position:"relative",maxHeight:"70vh",overflowY:"auto" }}
          >
            <button onClick={() => setBioExpanded(false)}
              style={{ position:"absolute",top:16,right:16,background:"none",border:"none",color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:20 }}>✕</button>
            <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:20 }}>
              {person.profile_path && (
                <img src={person.profile_path} alt="" loading="lazy" decoding="async" style={{ width:56,height:56,borderRadius:"50%",objectFit:"cover" }} />
              )}
              <h2 style={{ fontSize:18,fontWeight:700,color:"#fff" }}>{person.name}</h2>
            </div>
            <p style={{ fontSize:15,color:"rgba(255,255,255,0.75)",lineHeight:1.8,paddingRight:20 }}>{person.biography}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fila de créditos con posters verticales ─────────────────
function CreditsRow({ group, navigate }: { group: CreditGroup; navigate: (to: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scroll(dir: "left" | "right") {
    scrollRef.current?.scrollBy({ left: dir === "right" ? 600 : -600, behavior:"smooth" });
  }

  return (
    <section>
      <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:14 }}>
        <h2 style={{ fontSize:17,fontWeight:700,color:"#fff" }}>{group.label}</h2>
        <ChevronRight size={15} style={{ color:"rgba(255,255,255,0.35)",marginTop:1 }} />
      </div>

      <div style={{ position:"relative" }}>
        <ScrollArrow dir="left"  onClick={() => scroll("left")} />
        <div ref={scrollRef}
          style={{ display:"flex",gap:10,overflowX:"auto",paddingBottom:10,scrollbarWidth:"none" }}>
          {group.items.map((item, idx) => (
            <PosterCard
              key={`${item.id}-${idx}`}
              item={item}
              onClick={() => navigate(`/detail/${item.media_type}/tmdb:${item.id}`)}
            />
          ))}
        </div>
        <ScrollArrow dir="right" onClick={() => scroll("right")} />
      </div>
    </section>
  );
}

// ── Poster vertical 180x271 ─────────────────────────────────
function PosterCard({ item, onClick }: { item: CreditItem; onClick: () => void }) {
  const title = item.title ?? item.name ?? "";
  return (
    <div
      onClick={onClick}
      style={{ flexShrink:0,width:180,height:271,borderRadius:10,overflow:"hidden",cursor:"pointer",position:"relative",background:"#2c2c2e",transition:"transform 0.25s" }}
      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.transform="scale(1.05)"}
      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform="scale(1)"}
    >
      {item.poster_path ? (
        <img
          src={`${IMG}/w185${item.poster_path}`}
          alt={title}
          loading="lazy"
          decoding="async"
          style={{ width:"100%",height:"100%",objectFit:"cover" }}
        />
      ) : (
        <div style={{ width:"100%",height:"100%",background:"#2c2c2e",display:"flex",alignItems:"center",justifyContent:"center" }}>
          <p style={{ fontSize:12,color:"rgba(255,255,255,0.4)",textAlign:"center",padding:"0 10px" }}>{title}</p>
        </div>
      )}
    </div>
  );
}

// ── Flecha de scroll ────────────────────────────────────────
function ScrollArrow({ dir, onClick }: { dir: "left"|"right"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position:"absolute",
        [dir==="left"?"left":"right"]:-18,
        top:"50%",transform:"translateY(-50%)",zIndex:10,
        width:36,height:36,borderRadius:"50%",
        background:"rgba(255,255,255,0.12)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",
        border:"1px solid rgba(255,255,255,0.2)",color:"#fff",
        cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
        transition:"background 0.2s",
      }}
      onMouseEnter={e=>(e.currentTarget.style.background="rgba(255,255,255,0.22)")}
      onMouseLeave={e=>(e.currentTarget.style.background="rgba(255,255,255,0.12)")}
    >
      {dir==="left"?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}
    </button>
  );
}

// ── Skeleton ────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div style={{ padding:"48px 80px" }}>
      <div style={{ display:"flex",alignItems:"center",gap:32,marginBottom:48 }}>
        <div className="skeleton" style={{ width:120,height:120,borderRadius:"50%",flexShrink:0 }} />
        <div style={{ flex:1 }}>
          <div className="skeleton" style={{ height:28,width:200,borderRadius:8,marginBottom:12 }} />
          <div className="skeleton" style={{ height:14,width:"100%",borderRadius:6,marginBottom:8 }} />
          <div className="skeleton" style={{ height:14,width:"80%",borderRadius:6 }} />
        </div>
      </div>
      {[0,1,2].map(i=>(
        <div key={i} style={{ marginBottom:40 }}>
          <div className="skeleton" style={{ height:18,width:130,borderRadius:6,marginBottom:16 }} />
          <div style={{ display:"flex",gap:10 }}>
            {[0,1,2,3,4,5].map(j=>(
              <div key={j} className="skeleton" style={{ flexShrink:0,width:180,height:271,borderRadius:10 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// necesario para useRef en CreditsRow (import al inicio del archivo)
import { useRef } from "react";
