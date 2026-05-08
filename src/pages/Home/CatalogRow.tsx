import { useNavigate } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import type { CatalogRowData, MediaItem } from "../../types/ui";
import { sanitizeLogoUrl } from "../../utils/artwork";

function cleanTitle(name: string): string {
  return name.replace(/\s*[|·\-]\s*.+$/, "").replace(/\s*(ElfHosted|AIOMetadata|Cinemeta)\s*$/i,"").trim();
}

const CARD_W = 302;
const CARD_H = 196;
const GAP    = 10;

export default function CatalogRow({ row }: { row: CatalogRowData }) {
  const navigate   = useNavigate();
  const scrollRef  = useRef<HTMLDivElement>(null);
  const [hovered, setHovered]     = useState(false);
  const [showLeft, setShowLeft]   = useState(false);
  const [showRight, setShowRight] = useState(false);
  const title = cleanTitle(row.name);

  // Calcular visibilidad de flechas al montar y al scroll
  function updateArrows() {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 10);
    setShowRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }

  useEffect(() => {
    // Pequeño delay para que el DOM esté pintado
    setTimeout(updateArrows, 100);
  }, [row.items.length]);

  function scroll(dir: "left" | "right") {
    scrollRef.current?.scrollBy({ left: dir === "right" ? (CARD_W + GAP) * 3 : -(CARD_W + GAP) * 3, behavior: "smooth" });
  }

  return (
    <section style={{ paddingLeft:48, paddingRight:48 }}>
      {/* Header */}
      <button onClick={()=>{}}
        style={{ display:"flex",alignItems:"center",gap:4,marginBottom:14,background:"none",border:"none",cursor:"pointer",padding:0 }}>
        <span style={{ fontSize:17, fontWeight:700, color:"#fff" }}>{title}</span>
        <ChevronRight size={15} style={{ color:"rgba(255,255,255,0.4)", marginTop:1 }} />
      </button>

      {/* Row con flechas estilo Apple TV */}
      <div
        style={{ position:"relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Flecha IZQUIERDA — solo si hay scroll y está hovereado */}
        <div style={{
          position:"absolute", left:-48, top:0, bottom:0, width:80, zIndex:10,
          background:"linear-gradient(to right, #1f1f1f 30%, transparent 100%)",
          display:"flex", alignItems:"center", justifyContent:"flex-start",
          paddingLeft:6,
          opacity: hovered && showLeft ? 1 : 0,
          pointerEvents: hovered && showLeft ? "auto" : "none",
          transition:"opacity 0.2s",
        }}>
          <button onClick={()=>scroll("left")} style={{
            width:34, height:34, borderRadius:6,
            background:"rgba(245,245,247,0.82)", backdropFilter:"blur(10px)",
            border:"1px solid rgba(255,255,255,0.22)",
            color:"#fff", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:28, fontWeight:600, lineHeight:1,
            boxShadow:"0 2px 12px rgba(0,0,0,0.5)",
            transition:"background 0.15s",
            textShadow:"0 1px 4px rgba(0,0,0,0.7)",
          }}
            onMouseEnter={e=>(e.currentTarget.style.background="rgba(255,255,255,0.95)")}
            onMouseLeave={e=>(e.currentTarget.style.background="rgba(245,245,247,0.82)")}
          >‹</button>
        </div>

        {/* Scroll container */}
        <div
          ref={scrollRef}
          onScroll={updateArrows}
          style={{ display:"flex", gap:GAP, overflowX:"auto", overflowY:"visible", paddingBottom:12, scrollbarWidth:"none" }}
        >
          {row.items.map((item, idx) => (
            <CinematicCard
              key={`${item.id}-${row.catalogId}-${idx}`}
              item={item}
              onClick={() => navigate(`/detail/${row.type}/${item.id}`)}
            />
          ))}
        </div>

        {/* Flecha DERECHA — solo si hay más contenido y está hovereado */}
        <div style={{
          position:"absolute", right:-48, top:0, bottom:0, width:80, zIndex:10,
          background:"linear-gradient(to left, #1f1f1f 30%, transparent 100%)",
          display:"flex", alignItems:"center", justifyContent:"flex-end",
          paddingRight:6,
          opacity: hovered && showRight ? 1 : 0,
          pointerEvents: hovered && showRight ? "auto" : "none",
          transition:"opacity 0.2s",
        }}>
          <button onClick={()=>scroll("right")} style={{
            width:34, height:34, borderRadius:6,
            background:"rgba(245,245,247,0.82)", backdropFilter:"blur(10px)",
            border:"1px solid rgba(255,255,255,0.22)",
            color:"#fff", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:28, fontWeight:600, lineHeight:1,
            boxShadow:"0 2px 12px rgba(0,0,0,0.5)",
            transition:"background 0.15s",
            textShadow:"0 1px 4px rgba(0,0,0,0.7)",
          }}
            onMouseEnter={e=>(e.currentTarget.style.background="rgba(255,255,255,0.95)")}
            onMouseLeave={e=>(e.currentTarget.style.background="rgba(245,245,247,0.82)")}
          >›</button>
        </div>
      </div>
    </section>
  );
}

function CinematicCard({ item, onClick }: { item: MediaItem; onClick: () => void }) {
  const image = item.background ?? item.poster ?? "";
  const logo = sanitizeLogoUrl(item.logo);
  return (
    <div onClick={onClick}
      style={{ position:"relative",flexShrink:0,width:CARD_W,height:CARD_H,borderRadius:10,overflow:"hidden",cursor:"pointer",
        transition:"transform 0.25s,box-shadow 0.25s",background:"#1c1c1e" }}
      onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.transform="scale(1.04)";(e.currentTarget as HTMLDivElement).style.boxShadow="0 8px 32px rgba(0,0,0,0.7)";}}
      onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.transform="scale(1)";(e.currentTarget as HTMLDivElement).style.boxShadow="none";}}
    >
      {image && <img src={image} alt={item.name} loading="lazy"
        style={{ position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover" }} />}
      <div style={{ position:"absolute",bottom:0,left:0,right:0,height:"45%",
        background:"linear-gradient(to top,rgba(0,0,0,0.82) 0%,transparent 100%)",pointerEvents:"none" }} />
      <div style={{ position:"absolute",bottom:0,left:0,right:0,padding:"0 10px 9px" }}>
        {logo ? (
          <img src={logo} alt={item.name}
            style={{ maxHeight:28,maxWidth:140,objectFit:"contain",filter:"drop-shadow(0 1px 6px rgba(0,0,0,0.95))",marginBottom:3 }} />
        ) : (
          <span style={{ fontSize:13,fontWeight:600,color:"#fff",textShadow:"0 1px 8px rgba(0,0,0,0.95)",
            display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden" }}>
            {item.name}
          </span>
        )}
        {(item.year || item.imdbRating) && (
          <div style={{ fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:2 }}>
            {item.year}{item.imdbRating?` · ★ ${item.imdbRating}`:""}
          </div>
        )}
      </div>
    </div>
  );
}
