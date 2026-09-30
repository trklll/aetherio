import { useEffect, useMemo, useRef, useState } from "react";
import { Check, EyeOff } from "lucide-react";
import ContextMenu from "../../components/ui/ContextMenu";
import { useLongPressAction } from "../../hooks/useLongPressAction.ts";
import { useBigPictureActive } from "../../navigation/spatialNav.ts";
import { prefersReducedMotion } from "../../utils/motion.ts";
import "./SeasonTabs.css";

interface SeasonTabsProps {
  seasons: number[];
  selectedSeason: number;
  onSeasonSelected: (season: number) => void;
  seasonWatched: (season: number) => boolean;
  onMarkSeasonWatched: (season: number) => void;
  onMarkSeasonUnwatched: (season: number) => void;
}

export function seasonTabLabel(season: number) {
  return season === 0 ? "Especiales" : `Temporada ${season}`;
}

/**
 * Port 1:1 de SeasonTabs nativo (Aetherio Tv Native DetailScreen.kt):
 * pills 34px radio 999 sin anillo; reposo solo texto; seleccionada blanco
 * 13%; enfocada #F8F8F9 con escala 1.025. Especiales (0) al final. La
 * temporada se elige con click/Enter (sin cambio por foco); mantener abre
 * las opciones de la temporada.
 */
export default function SeasonTabs({
  seasons,
  selectedSeason,
  onSeasonSelected,
  seasonWatched,
  onMarkSeasonWatched,
  onMarkSeasonUnwatched,
}: SeasonTabsProps) {
  // Orden nativo: regulares asc + Especiales al final.
  const sortedSeasons = useMemo(() => {
    const regular = seasons.filter(season => season > 0).sort((a, b) => a - b);
    return seasons.includes(0) ? [...regular, 0] : regular;
  }, [seasons]);

  // En Big Picture la row es solo indicador (cambio por LB/RB): se excluye
  // de la navegación espacial para que el analógico la ignore.
  const bigPictureList = useBigPictureActive();
  const rowRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<number, HTMLButtonElement>());
  const [menuSeason, setMenuSeason] = useState<number | null>(null);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const prevSelectedRef = useRef(selectedSeason);

  // Como el nativo al cambiar de temporada: si la tab queda fuera de vista,
  // se trae (en el montaje inicial la fila ya arranca en 0, no se toca).
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedSeason;
    if (prev === selectedSeason) return;
    const row = rowRef.current;
    const tab = tabRefs.current.get(selectedSeason);
    if (!row || !tab) return;
    const rowRect = row.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    if (tabRect.left < rowRect.left || tabRect.right > rowRect.right) {
      tab.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedSeason, sortedSeasons]);

  const openMenu = (season: number, element: HTMLButtonElement | null) => {
    menuAnchorRef.current = element;
    setMenuSeason(season);
  };

  if (!sortedSeasons.length) return null;

  const menuWatched = menuSeason !== null && seasonWatched(menuSeason);

  return (
    <>
      <div ref={rowRef} className="season-tabs" data-season-tabs data-row-scroller data-focus-center role="tablist" aria-label="Temporadas" data-spatial-ignore={bigPictureList ? true : undefined}>
        {sortedSeasons.map(season => (
          <SeasonTab
            key={season}
            season={season}
            selected={season === selectedSeason}
            onSelect={onSeasonSelected}
            onOpenMenu={openMenu}
            registerRef={(element) => {
              if (element) tabRefs.current.set(season, element);
              else tabRefs.current.delete(season);
            }}
          />
        ))}
      </div>
      <ContextMenu
        open={menuSeason !== null}
        anchorRef={menuAnchorRef}
        onClose={() => setMenuSeason(null)}
        placement="below-start"
        width={238}
        items={[
          menuWatched
            ? { label: "Marcar temporada como no vista", icon: <EyeOff size={15} />, onSelect: () => menuSeason !== null && onMarkSeasonUnwatched(menuSeason) }
            : { label: "Marcar temporada como vista", icon: <Check size={15} />, onSelect: () => menuSeason !== null && onMarkSeasonWatched(menuSeason) },
        ]}
      />
    </>
  );
}

function SeasonTab({
  season,
  selected,
  onSelect,
  onOpenMenu,
  registerRef,
}: {
  season: number;
  selected: boolean;
  onSelect: (season: number) => void;
  onOpenMenu: (season: number, element: HTMLButtonElement | null) => void;
  registerRef: (element: HTMLButtonElement | null) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // En Big Picture la row de temporadas es solo indicador: no focuseable,
  // el cambio va por LB/RB desde el Detail.
  const bigPictureTabs = useBigPictureActive();
  // Corto = elegir (como el onClick nativo); mantenido 500ms = opciones.
  const longPress = useLongPressAction(!bigPictureTabs, {
    onActivate: () => onSelect(season),
    onLongPress: () => onOpenMenu(season, ref.current),
  });

  return (
    <button
      ref={(element) => {
        ref.current = element;
        registerRef(element);
      }}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={seasonTabLabel(season)}
      aria-disabled={bigPictureTabs ? true : undefined}
      tabIndex={bigPictureTabs ? -1 : undefined}
      className={`season-tab${selected ? " is-selected" : ""}`}
      style={bigPictureTabs ? { pointerEvents: "none" } : undefined}
      onClick={() => {
        if (!bigPictureTabs) onSelect(season);
      }}
      onContextMenu={(event) => {
        if (bigPictureTabs) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu(season, ref.current);
      }}
      onKeyDown={bigPictureTabs ? undefined : longPress.onKeyDown}
      onKeyUp={bigPictureTabs ? undefined : longPress.onKeyUp}
    >
      {seasonTabLabel(season)}
    </button>
  );
}
