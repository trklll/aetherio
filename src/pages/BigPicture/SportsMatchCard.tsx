import { Radio } from "lucide-react";
import { useId, useState, type CSSProperties, type SyntheticEvent } from "react";
import { useLongPressAction } from "../../hooks/useLongPressAction.ts";
import type { SportsMatchSide } from "../../types/sportsMatch.ts";
import type { MediaItem } from "../../types/ui.ts";
import { NEUTRAL_CREST_COLOR, sampleCrestImage } from "../../utils/crestColor.ts";
import "./SportsMatchCard.css";

function TeamCrest({ team, onColorExtracted }: { team: SportsMatchSide; onColorExtracted: (color: string) => void }) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [imageStyle, setImageStyle] = useState<CSSProperties>();
  const source = [team.crest, team.fallbackCrest].find(url => url && !failedSources.includes(url));

  const alignVisibleMark = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const sample = sampleCrestImage(image);
    if (!sample) return;
    onColorExtracted(sample.color);
    let left = sample.width;
    let top = sample.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < sample.height; y += 1) {
      for (let x = 0; x < sample.width; x += 1) {
        if (sample.pixels[(y * sample.width + x) * 4 + 3] < 24) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return;

    const boxSize = 112;
    const contentWidth = (right - left + 1) / sample.scale;
    const contentHeight = (bottom - top + 1) / sample.scale;
    left /= sample.scale;
    top /= sample.scale;
    // Keep the *visible* mark comfortably inside the 112px slot. Some crests
    // (notably Espanyol's shield) have little transparent padding, so sizing
    // them to almost the full slot makes them look much larger than others.
    const scale = boxSize * 0.70 / Math.max(contentWidth, contentHeight);
    setImageStyle({
      position: "absolute",
      width: image.naturalWidth * scale,
      height: image.naturalHeight * scale,
      left: boxSize / 2 - (left + contentWidth / 2) * scale,
      top: boxSize / 2 - (top + contentHeight / 2) * scale,
      maxWidth: "none",
      objectFit: "fill",
    });
  };

  return (
    <span className="sports-match-card__crest">
      {source ? (
        <img src={source} alt="" loading="lazy" decoding="async" draggable={false}
          style={imageStyle}
          onLoad={alignVisibleMark}
          onError={() => { setImageStyle(undefined); setFailedSources(previous => [...previous, source]); }} />
      ) : <span className="sports-match-card__initials">{team.initials}</span>}
    </span>
  );
}

interface SportsMatchCardProps {
  item: MediaItem;
  onOpenItem: (item: MediaItem) => void;
  onChooseSources?: (item: MediaItem) => void;
  onTeamColorSample?: (itemId: string, side: "home" | "away", color: string) => void;
}

/** The row retains virtualization/focus geometry; this component owns match art only. */
export default function SportsMatchCard({ item, onOpenItem, onChooseSources, onTeamColorSample }: SportsMatchCardProps) {
  const [sampledColors, setSampledColors] = useState<{ home?: string; away?: string }>({});
  const descriptionId = useId();
  const match = item.sportsMatch;
  const teams = [match?.home, match?.away].filter((side): side is SportsMatchSide => Boolean(side));
  const metadata = [item.genres?.[0], item.runtime, ...(item.genres?.slice(1) ?? [])].filter(Boolean).join(" · ");
  const isLive = item.genres?.[0] === "En directo";
  const longPress = useLongPressAction(true, {
    onActivate: () => onOpenItem(item),
    onLongPress: () => onChooseSources?.(item),
  });
  const style = {
    "--match-home-color": sampledColors.home ?? teams[0]?.color ?? NEUTRAL_CREST_COLOR,
    "--match-away-color": sampledColors.away ?? teams[1]?.color ?? teams[0]?.color ?? NEUTRAL_CREST_COLOR,
  } as CSSProperties;

  return (
    <article className="sports-match-card" style={style}>
      <button type="button" className="media-card-frame sports-match-card__frame" data-row-card data-long-press
        aria-label={item.name} aria-describedby={metadata ? descriptionId : undefined}
        onClick={() => onOpenItem(item)} onKeyDown={longPress.onKeyDown} onKeyUp={longPress.onKeyUp}>
        <span className={`sports-match-card__art${teams.length === 2 ? " sports-match-card__art--versus" : ""}`} aria-hidden="true">
          <span className="sports-match-card__field sports-match-card__field--home" />
          {teams.length === 2 && <span className="sports-match-card__field sports-match-card__field--away" />}
          {teams.length ? teams.map((team, index) => (
            <span className={`sports-match-card__team sports-match-card__team--${index === 0 ? "home" : "away"}${teams.length === 1 ? " sports-match-card__team--solo" : ""}`} key={`${team.name}:${team.crest ?? "initials"}`}>
              <TeamCrest team={team} onColorExtracted={color => {
                const side = index === 0 ? "home" : "away";
                setSampledColors(previous => previous[side] === color ? previous : { ...previous, [side]: color });
                onTeamColorSample?.(item.id, side, color);
              }} />
            </span>
          )) : <span className="sports-match-card__event-label">{match?.label ?? "Deportes"}</span>}
        </span>
      </button>
      <div className="sports-match-card__caption">
        <div className="sports-match-card__copy">
          <p className="sports-match-card__title" title={item.name}>{item.name}</p>
          {metadata && <p id={descriptionId} className="sports-match-card__metadata" title={metadata}>{metadata}</p>}
        </div>
        {onChooseSources && !isLive && <button type="button" className="sports-match-card__sources" aria-label={`Elegir fuentes para ${item.name}`}
          title="Elegir fuentes" onClick={() => onChooseSources(item)}><Radio size={20} aria-hidden="true" /></button>}
      </div>
    </article>
  );
}
