import { useState, type SyntheticEvent } from "react";
import aetherioLogo from "../../assets/aetheriologo.png";
import type { SportsMatchArtwork } from "../../types/sportsMatch.ts";
import { extractCrestColor, NEUTRAL_CREST_COLOR } from "../../utils/crestColor.ts";
import "./PlayerLoadingOverlay.css";

interface PlayerLoadingOverlayProps {
  visible: boolean;
  artwork: string | null;
  title: string;
  message?: string | null;
  hideMessage?: boolean;
  p2p?: boolean;
  sportsMatch?: SportsMatchArtwork;
  compactSports?: boolean;
}

export default function PlayerLoadingOverlay({ visible, artwork, title, message, hideMessage, sportsMatch, compactSports = false }: PlayerLoadingOverlayProps) {
  const [crestSample, setCrestSample] = useState<{ key: string; home?: string; away?: string }>({ key: "" });
  const crestKey = `${sportsMatch?.home?.crest ?? sportsMatch?.home?.fallbackCrest ?? ""}|${sportsMatch?.away?.crest ?? sportsMatch?.away?.fallbackCrest ?? ""}`;
  const sampledColors = crestSample.key === crestKey ? crestSample : undefined;
  const sampleCrest = (event: SyntheticEvent<HTMLImageElement>, side: "home" | "away") => {
    const image = event.currentTarget;
    try {
      const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const color = extractCrestColor(context.getImageData(0, 0, canvas.width, canvas.height).data);
      setCrestSample(previous => ({ ...(previous.key === crestKey ? previous : { key: crestKey }), key: crestKey, [side]: color }));
    } catch {
      // Cross-origin marks cannot always be sampled; retain the known club color.
    }
  };
  if (!visible) return null;

  return (
    <div className={`pointer-events-none absolute inset-0 z-30 grid place-items-center${sportsMatch ? " player-loading-overlay--sports" : ""}`}>
      <div className={sportsMatch ? "player-loading-overlay__sports-content" : "flex flex-col items-center gap-3"}>
        {sportsMatch && compactSports ? (
          <div className="player-loading-overlay__competition-only" role="status" aria-label="Cargando">
            <img className="aetherio-breathe" src={sportsMatch.competitionLogo ?? artwork ?? aetherioLogo} alt="" />
          </div>
        ) : sportsMatch ? (
          <div className="player-sports-loading-card" role="img" aria-label={title}>
            <div className="player-sports-loading-card__field player-sports-loading-card__field--home" style={{ backgroundColor: sampledColors?.home ?? sportsMatch.home?.color ?? NEUTRAL_CREST_COLOR }} />
            {sportsMatch.away && <div className="player-sports-loading-card__field player-sports-loading-card__field--away" style={{ backgroundColor: sampledColors?.away ?? sportsMatch.away.color }} />}
            {sportsMatch.home && <div className="player-sports-loading-card__team player-sports-loading-card__team--home">
              {sportsMatch.home.crest || sportsMatch.home.fallbackCrest
                ? <img src={sportsMatch.home.crest ?? sportsMatch.home.fallbackCrest} alt="" onLoad={event => sampleCrest(event, "home")} />
                : <span>{sportsMatch.home.initials}</span>}
            </div>}
            {sportsMatch.away && <div className="player-sports-loading-card__team player-sports-loading-card__team--away">
              {sportsMatch.away.crest || sportsMatch.away.fallbackCrest
                ? <img src={sportsMatch.away.crest ?? sportsMatch.away.fallbackCrest} alt="" onLoad={event => sampleCrest(event, "away")} />
                : <span>{sportsMatch.away.initials}</span>}
            </div>}
            {!sportsMatch.home && <span className="player-sports-loading-card__label">{sportsMatch.label}</span>}
            <span className="player-sports-loading-card__spinner">
              <img className="aetherio-breathe" src={sportsMatch.competitionLogo ?? artwork ?? aetherioLogo} alt="" />
            </span>
          </div>
        ) : <img
          src={artwork || aetherioLogo}
          alt={title}
          className="aetherio-breathe max-h-32 w-auto max-w-[520px] object-contain drop-shadow-[0_18px_44px_rgba(0,0,0,0.8)]"
        />}
        {message && !hideMessage ? (
          <p className={`${sportsMatch ? "player-sports-loading-card__message" : "text-center text-sm text-white/65 max-w-[380px] leading-snug"}`} style={{ textShadow: "0 1px 8px rgba(0,0,0,0.7)" }}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
