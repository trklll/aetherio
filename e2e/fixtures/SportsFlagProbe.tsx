import { useState } from "react";
import { createRoot } from "react-dom/client";
import SportsMatchSurface from "../../src/pages/Sports/SportsMatchSurface";
import type { SportsMatchDetail } from "../../src/pages/Sports/matchDetail";
import SportsFlag from "../../src/pages/Sports/SportsFlag";

const followed = new Set<string>();
const details: SportsMatchDetail[] = Array.from({ length: 24 }, (_, index) => ({
  match: { id: `flag-probe:${index}`, sport: "futbol", timeValid: true, completed: false, live: false,
    date: "2026-12-07T20:00:00Z", competition: "Prueba de bandera",
    home: { name: "Local", entityId: "club:barcelona" }, away: { name: "Visitante", entityId: "club:real-madrid" } },
  standings: { name: "Prueba de bandera", rows: Array.from({ length: 48 }, (_, row) => ({ id: `probe-${row}`, name: `Equipo ${row + 1}`, rank: String(row + 1), points: "30" })) },
}));

function Probe() {
  const [active, setActive] = useState(0);
  return <>
    <nav aria-label="Partidos de prueba" style={{ position: "fixed", right: 8, top: 8, zIndex: 10, display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 280 }}>
      {details.map((_, index) => <button key={index} type="button" onClick={() => { window.scrollTo(0, 0); setActive(index); }}>Partido {index + 1}</button>)}
    </nav>
    {details.map((detail, index) => <div key={detail.match.id} data-probe-match={index} hidden={index !== active}>
      <SportsMatchSurface detail={detail} followed={followed} animated={index === active} previewOnly={index !== active} />
    </div>)}
  </>;
}

function MaterialProbe() {
  const [animated, setAnimated] = useState(false);
  return <div data-probe-match="0" style={{ position: "relative", height: "100vh" }}>
    <SportsFlag home="#c31524" away="#367ac5" animated={animated} />
    <button type="button" style={{ position: "absolute", top: 8, left: 8 }} onClick={() => setAnimated(value => !value)}>{animated ? "Congelar tela" : "Iniciar tela"}</button>
  </div>;
}

export function mountSportsFlagProbe() {
  document.body.style.cssText = "margin:0;background:#191d22;font-family:Arial,sans-serif";
  const root = document.createElement("main");
  document.body.replaceChildren(root);
  createRoot(root).render(new URLSearchParams(location.search).has("material") ? <MaterialProbe /> : <Probe />);
}
