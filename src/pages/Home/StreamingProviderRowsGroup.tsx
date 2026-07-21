import { ChevronRight } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import appleTvPlusLogo from "../../assets/apple-tv-plus-logo.png";
import disneyPlusLogo from "../../assets/disney-plus-logo.png";
import hboMaxLogo from "../../assets/hbo-max-logo.png";
import netflixLogo from "../../assets/netflix-logo.png";
import primeVideoLogo from "../../assets/prime-video-logo.png";
import type { HomePosterLayout } from "../../config/homePreferences";
import type { CatalogRowData } from "../../types/ui";
import { tweenTo } from "../../utils/motion";
import CatalogRow from "./CatalogRow";

export interface StreamingProviderTheme {
  id: "netflix" | "prime-video" | "disney-plus" | "hbo-max" | "apple-tv-plus";
  name: string;
  matchers: readonly string[];
  logo: string;
  accent: string;
  accentSoft: string;
  background: string;
  logoStyle: CSSProperties;
}

export const STREAMING_PROVIDERS: readonly StreamingProviderTheme[] = [
  {
    id: "netflix",
    name: "Netflix",
    matchers: ["netflix"],
    logo: netflixLogo,
    accent: "rgb(229, 9, 20)",
    accentSoft: "rgba(229, 9, 20, 0.20)",
    background: "radial-gradient(ellipse at 7% 34%, rgba(229,9,20,0.18), transparent 25%), linear-gradient(145deg, rgba(36,36,38,0.78), rgba(21,21,23,0.92))",
    logoStyle: {
      top: "23.75%",
      left: 0,
      width: 180,
      height: "auto",
      filter: "drop-shadow(0 24px 38px rgba(0,0,0,0.46)) drop-shadow(0 0 28px rgba(229,9,20,0.12))",
    },
  },
  {
    id: "hbo-max",
    name: "HBO Max",
    matchers: ["hbo max"],
    logo: hboMaxLogo,
    accent: "rgb(153, 92, 255)",
    accentSoft: "rgba(153, 92, 255, 0.20)",
    background: "radial-gradient(ellipse at 7% 34%, rgba(111,45,189,0.25), transparent 27%), linear-gradient(145deg, rgba(35,29,43,0.84), rgba(20,20,23,0.94))",
    logoStyle: {
      top: "38%",
      left: 0,
      width: 180,
      height: "auto",
      filter: "invert(1) drop-shadow(0 22px 34px rgba(0,0,0,0.42)) drop-shadow(0 0 24px rgba(153,92,255,0.20))",
    },
  },
  {
    id: "disney-plus",
    name: "Disney+",
    matchers: ["disney"],
    logo: disneyPlusLogo,
    accent: "rgb(72, 136, 255)",
    accentSoft: "rgba(72, 136, 255, 0.20)",
    background: "radial-gradient(ellipse at 7% 34%, rgba(29,78,216,0.24), transparent 27%), linear-gradient(145deg, rgba(26,31,47,0.86), rgba(19,20,24,0.94))",
    logoStyle: {
      top: "41%",
      left: 0,
      width: 180,
      height: "auto",
      filter: "brightness(1.65) saturate(1.25) drop-shadow(0 22px 34px rgba(0,0,0,0.40)) drop-shadow(0 0 24px rgba(72,136,255,0.16))",
    },
  },
  {
    id: "prime-video",
    name: "Prime Video",
    matchers: ["prime video"],
    logo: primeVideoLogo,
    accent: "rgb(0, 168, 225)",
    accentSoft: "rgba(0, 168, 225, 0.20)",
    background: "radial-gradient(ellipse at 7% 34%, rgba(0,168,225,0.20), transparent 27%), linear-gradient(145deg, rgba(24,35,43,0.86), rgba(19,21,24,0.94))",
    logoStyle: {
      top: "34%",
      left: 0,
      width: 180,
      height: "auto",
      filter: "drop-shadow(0 22px 34px rgba(0,0,0,0.42)) drop-shadow(0 0 24px rgba(0,168,225,0.16))",
    },
  },
  {
    id: "apple-tv-plus",
    name: "Apple TV+",
    matchers: ["apple tv"],
    logo: appleTvPlusLogo,
    accent: "rgb(235, 235, 240)",
    accentSoft: "rgba(235, 235, 240, 0.15)",
    background: "radial-gradient(ellipse at 7% 34%, rgba(255,255,255,0.12), transparent 27%), linear-gradient(145deg, rgba(39,39,42,0.88), rgba(18,18,20,0.95))",
    logoStyle: {
      top: "43%",
      left: 0,
      width: 180,
      height: "auto",
      filter: "invert(1) drop-shadow(0 22px 34px rgba(0,0,0,0.44)) drop-shadow(0 0 22px rgba(255,255,255,0.08))",
    },
  },
];

interface StreamingProviderRowsGroupProps {
  provider: StreamingProviderTheme;
  seriesRow: CatalogRowData;
  moviesRow: CatalogRowData;
  posterLayout: HomePosterLayout;
}

function catalogUrl(row: CatalogRowData, title: string) {
  const params = new URLSearchParams({
    addon: row.addonId,
    type: row.type,
    catalog: row.catalogId,
    title,
  });
  if (row.extraParams && Object.keys(row.extraParams).length) {
    params.set("extras", JSON.stringify(row.extraParams));
  }
  return `/catalog?${params.toString()}`;
}

export default function StreamingProviderRowsGroup({ provider, seriesRow, moviesRow, posterLayout }: StreamingProviderRowsGroupProps) {
  const navigate = useNavigate();
  const logoRef = useRef<HTMLImageElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const seriesAtOriginRef = useRef(true);
  const moviesAtOriginRef = useRef(true);
  const [rowsExpanded, setRowsExpanded] = useState(false);
  const openCatalog = useCallback((row: CatalogRowData, title: string) => {
    navigate(catalogUrl(row, title));
  }, [navigate]);

  const handleSeriesOriginChange = useCallback((atOrigin: boolean) => {
    seriesAtOriginRef.current = atOrigin;
    setRowsExpanded(!atOrigin || !moviesAtOriginRef.current);
  }, []);

  const handleMoviesOriginChange = useCallback((atOrigin: boolean) => {
    moviesAtOriginRef.current = atOrigin;
    setRowsExpanded(!seriesAtOriginRef.current || !atOrigin);
  }, []);

  useLayoutEffect(() => {
    const logoTween = tweenTo(logoRef.current, {
      x: rowsExpanded ? -190 : 0,
      opacity: rowsExpanded ? 0 : 1,
      scale: rowsExpanded ? 0.94 : 1,
    }, 0.48);
    const contentTween = tweenTo(contentRef.current, {
      marginLeft: rowsExpanded ? 0 : 200,
      width: rowsExpanded ? "100%" : "calc(100% - 200px)",
    }, 0.52);
    const headerTween = tweenTo(headerRef.current, {
      paddingLeft: rowsExpanded ? 0 : 68,
    }, 0.52);

    return () => {
      logoTween.kill();
      contentTween.kill();
      headerTween.kill();
    };
  }, [rowsExpanded]);

  const seriesTitle = `${provider.name} - Series`;
  const moviesTitle = `${provider.name} - Películas`;

  return (
    <section
      data-streaming-provider={provider.id}
      data-rows-expanded={rowsExpanded ? "true" : "false"}
      style={{
        position: "relative",
        display: "block",
        margin: "12px 48px 34px",
        padding: "30px 42px 28px 32px",
        overflow: "visible",
        borderRadius: 26,
        border: "1px solid rgba(255,255,255,0.075)",
        background: provider.background,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045), 0 24px 60px rgba(0,0,0,0.18)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 30,
          bottom: 28,
          left: 32,
          width: 200,
          zIndex: 0,
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        <img
          ref={logoRef}
          src={provider.logo}
          alt=""
          style={{
            position: "absolute",
            maxWidth: "none",
            objectFit: "contain",
            ...provider.logoStyle,
          }}
        />
      </div>

      <div
        ref={contentRef}
        style={{
          position: "relative",
          zIndex: 2,
          minWidth: 0,
          width: "calc(100% - 200px)",
          marginLeft: 200,
        }}
      >
        <header ref={headerRef} style={{ minHeight: 48, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "0 2px 2px 68px" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, color: "#fff", fontSize: 20, lineHeight: 1.15, fontWeight: 750, letterSpacing: -0.25 }}>
              {provider.name} <span style={{ color: "rgba(255,255,255,0.48)", fontWeight: 600 }}>— Series y películas</span>
            </h2>
          </div>

          <nav aria-label={`Catálogos de ${provider.name}`} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <ProviderLink label="Series" accentSoft={provider.accentSoft} onClick={() => openCatalog(seriesRow, seriesTitle)} />
            <ProviderLink label="Películas" accentSoft={provider.accentSoft} onClick={() => openCatalog(moviesRow, moviesTitle)} />
          </nav>
        </header>

        <div aria-label={seriesTitle}>
          <CatalogRow
            row={seriesRow}
            posterLayout={posterLayout}
            hideHeader
            embedded
            onScrollOriginChange={handleSeriesOriginChange}
          />
        </div>
        <div style={{ height: 1, margin: "0 0 0 2px", background: `linear-gradient(to right, ${provider.accent} 0%, rgba(255,255,255,0.07) 22%, transparent 82%)`, opacity: 0.32 }} />
        <div aria-label={moviesTitle}>
          <CatalogRow
            row={moviesRow}
            posterLayout={posterLayout}
            hideHeader
            embedded
            onScrollOriginChange={handleMoviesOriginChange}
          />
        </div>
      </div>
    </section>
  );
}

function ProviderLink({ label, accentSoft, onClick }: { label: string; accentSoft: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 34,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 10px 0 12px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.09)",
        background: "rgba(255,255,255,0.055)",
        color: "rgba(255,255,255,0.72)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
      onMouseEnter={event => tweenTo(event.currentTarget, { backgroundColor: accentSoft, color: "rgba(255,255,255,0.96)", y: -1 })}
      onMouseLeave={event => tweenTo(event.currentTarget, { backgroundColor: "rgba(255,255,255,0.055)", color: "rgba(255,255,255,0.72)", y: 0 })}
    >
      {label}
      <ChevronRight size={13} style={{ opacity: 0.62 }} />
    </button>
  );
}
