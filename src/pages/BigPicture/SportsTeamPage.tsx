import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { Flip } from "gsap/Flip";
import { gsap, prefersReducedMotion, scrollByGsap } from "../../utils/motion.ts";
import { useNavigate, useParams } from "react-router-dom";
import { UserRound } from "lucide-react";
import { SPORTS_COUNTRY_BY_ID, SPORTS_ENTITY_BY_ID } from "../../data/sports/catalog";
import { normalizeLiveTeamKey } from "../../types/liveSports";
import { resolveInsignia, initialsOf } from "../../data/sports/insignia";
import { TEAM_HONOURS } from "../../data/sports/teamHonours";
import { loadTeamOverview, type TeamOverview, type TeamPlayer, type TeamFixture } from "../../services/sportsTeamOverview";
import { loadTeamClubFacts, type TeamClubFacts } from "../../services/sportsTeamFacts";
import { LOCAL_PROFILES_CHANGED_EVENT } from "../../utils/localProfiles";
import { useLiveEvents } from "../../hooks/useLiveEvents";
import { GAMEPAD_ACTION_EVENT, type GamepadActionDetail } from "../../hooks/useGamepad";
import { resolveEvents, canonicalEventIsPlayable } from "../../data/sports/identity";
import { primeLivePlaybackSession } from "../../services/liveSportsService";
import { buildPlayerPath } from "../../utils/bigPictureDetail";
import { extractCrestColors, NEUTRAL_CREST_COLOR } from "../../utils/crestColor";
import { footballCompetitionTrophyUrl } from "../../data/sports/competitionTrophies";
import "./SportsTeamPage.css";

gsap.registerPlugin(Flip);

const SECTIONS = ["Clasificación", "Alineación", "Plantilla", "Partidos", "Títulos"] as const;
type Section = typeof SECTIONS[number];
const STANDING_ENTITIES_BY_NAME = new Map<string, string>();
for (const entity of SPORTS_ENTITY_BY_ID.values()) {
  for (const name of [entity.name, ...(entity.aliases ?? [])]) {
    const key = normalizeLiveTeamKey(name);
    if (key && !STANDING_ENTITIES_BY_NAME.has(key)) STANDING_ENTITIES_BY_NAME.set(key, entity.id);
  }
}

function dateLabel(value?: string, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Fecha por confirmar";
  return new Date(value).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}
function competitionIdForStanding(name: string): string | undefined {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const label = normalize(name.replace(/^acumulada\s*[·-]\s*/i, ""));
  const competitions = [...SPORTS_ENTITY_BY_ID.values()].filter(entity => entity.kind === "competition");
  const match = competitions.find(entity => [entity.name, entity.shortName, ...(entity.aliases ?? [])]
    .filter((value): value is string => Boolean(value))
    .some(value => normalize(value) === label));
  return match?.id;
}
function PlayerPhoto({ player }: { player: TeamPlayer }) {
  const [failed, setFailed] = useState(false);
  return <span className="team-page__photo">{player.photo && !failed ? <img src={player.photo} alt="" width={64} height={64} loading="lazy" onError={() => setFailed(true)} /> : <UserRound size={28} aria-hidden="true" />}</span>;
}
function HonourTrophy({ trophy }: { trophy: { name: string; count: number; seasons: string } }) {
  const key = trophy.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const competitionId = /champions league|copa de europa/.test(key) ? "comp:uefa-champions"
    : /la liga|laliga/.test(key) ? "comp:esp-laliga"
      : /copa del rey/.test(key) ? "comp:esp-copa"
        : /libertadores/.test(key) ? "comp:conmebol-libertadores"
          : /sudamericana/.test(key) ? "comp:conmebol-sudamericana"
            : /mundial de clubes|club world cup/.test(key) ? "comp:fifa-club-world-cup"
              : /europa league|copa uefa|uefa cup/.test(key) ? "comp:uefa-europa"
                : /supercopa de europa|uefa super cup/.test(key) ? "comp:uefa-super-cup"
                  : /community shield/.test(key) ? "comp:eng-community-shield"
                    : /bundesliga/.test(key) ? "comp:ger-bundesliga"
                      : /serie a|liga italiana/.test(key) ? "comp:ita-seriea"
                        : /copa italiana|coppa italia/.test(key) ? "comp:ita-coppa"
                          : /liga argentina|liga profesional/.test(key) ? "comp:arg-primera"
                            : "";
  const image = competitionId === "comp:uefa-super-cup"
    ? "/assets/football-logos/Trophies/UEFASuperCup.png"
    : competitionId ? footballCompetitionTrophyUrl(competitionId) : null;
  const seasons = trophy.seasons.split(",").map(season => season.trim()).filter(Boolean);
  return <article className="team-page__trophy" aria-label={`${trophy.count} títulos de ${trophy.name}`}>
    <h3>{trophy.name}</h3>
    <div className="team-page__trophy-wins">
      {Array.from({ length: Math.max(0, trophy.count) }, (_, index) => {
        const season = seasons[index] ?? "Año no informado";
        return <figure className="team-page__trophy-win" key={`${trophy.name}-${index}`}>
          {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : <span className="team-page__trophy-placeholder" aria-hidden="true">{trophy.name}</span>}
          <figcaption>{season}</figcaption>
        </figure>;
      })}
    </div>
  </article>;
}
function StandingMark({ id, name }: { id: string; name: string }) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const entityId = STANDING_ENTITIES_BY_NAME.get(normalizeLiveTeamKey(name));
  const insignia = resolveInsignia({ entityId, name, size: 64 });
  const sources = [insignia.src, `https://images.fotmob.com/image_resources/logo/teamlogo/${encodeURIComponent(id)}.png`]
    .filter((source): source is string => Boolean(source));
  const source = sources.find(candidate => !failedSources.includes(candidate));
  return <span className="team-page__standing-mark" style={{ "--team-standing-mark-color": insignia.color } as CSSProperties} aria-hidden="true">
    {source ? <img src={source} alt="" width={30} height={30} loading="lazy" decoding="async" onError={() => setFailedSources(previous => [...previous, source])} /> : insignia.initials}
  </span>;
}
function animateStandingRowFocus(row: HTMLTableRowElement, focused: boolean) {
  if (prefersReducedMotion()) return;
  const cells = Array.from(row.cells);
  if (!cells.length) return;
  gsap.killTweensOf(cells);
  const focusBackground = "rgba(255, 255, 255, 0.14)";
  const focusBorder = "rgba(255, 255, 255, 0.62)";
  gsap.fromTo(cells, {
    backgroundColor: focused ? "transparent" : focusBackground,
    borderTopStyle: "solid",
    borderTopColor: focused ? "transparent" : focusBorder,
    borderBottomStyle: "solid",
    borderBottomColor: focused ? "rgba(255, 255, 255, 0.1)" : focusBorder,
  }, {
    backgroundColor: focused ? focusBackground : "transparent",
    borderTopStyle: "solid",
    borderTopColor: focused ? focusBorder : "transparent",
    borderBottomStyle: "solid",
    borderBottomColor: focused ? focusBorder : "rgba(255, 255, 255, 0.1)",
    duration: 0.18,
    ease: "power2.out",
    overwrite: "auto",
    clearProps: "backgroundColor,borderTopStyle,borderTopColor,borderBottomStyle,borderBottomColor",
  });
  const leadingCell = cells[0];
  gsap.fromTo(leadingCell, {
    boxShadow: focused ? "inset 3px 0 0 rgba(255, 255, 255, 0)" : "inset 3px 0 0 #fff",
  }, {
    boxShadow: focused ? "inset 3px 0 0 #fff" : "inset 3px 0 0 rgba(255, 255, 255, 0)",
    duration: 0.18,
    ease: "power2.out",
    overwrite: "auto",
    clearProps: "boxShadow",
  });
}
function clearStandingRowFocus(row: HTMLTableRowElement | null) {
  if (!row) return;
  const cells = Array.from(row.cells);
  gsap.killTweensOf(cells);
  if (cells[0]) gsap.killTweensOf(cells[0], "boxShadow");
  gsap.set(cells, { clearProps: "backgroundColor,borderTopStyle,borderTopColor,borderBottomStyle,borderBottomColor,boxShadow" });
  row.removeAttribute("data-standing-focused");
}
function animateTrophySectionFocus(section: HTMLElement, focused: boolean) {
  gsap.killTweensOf(section);
  if (prefersReducedMotion()) return;
  const baseBackground = "rgba(255, 255, 255, 0.04)";
  const focusBackground = "rgba(255, 255, 255, 0.14)";
  const baseBorder = "rgba(255, 255, 255, 0.1)";
  const focusBorder = "rgba(255, 255, 255, 0.72)";
  gsap.fromTo(section, {
    backgroundColor: focused ? baseBackground : focusBackground,
    borderColor: focused ? baseBorder : focusBorder,
  }, {
    backgroundColor: focused ? focusBackground : baseBackground,
    borderColor: focused ? focusBorder : baseBorder,
    duration: 0.2,
    ease: "power2.out",
    overwrite: "auto",
    clearProps: "backgroundColor,borderColor",
  });
}
function clearTrophySectionFocus(section: HTMLElement | null) {
  if (!section) return;
  gsap.killTweensOf(section);
  gsap.set(section, { clearProps: "backgroundColor,borderColor" });
  section.removeAttribute("data-trophy-focused");
}
function Fixtures({ fixtures }: { fixtures: TeamFixture[] }) {
  return fixtures.length ? <ul className="team-page__fixtures">{fixtures.map(match => <li key={match.id}>
    <span>{dateLabel(match.date, match.timeValid)}<small>{match.cancelled ? "Cancelado" : match.completed ? "Finalizado" : match.live ? "En directo" : match.timeValid ? "Próximamente" : "Horario por confirmar"}</small></span>
    <strong>{match.home && match.away ? `${match.home} — ${match.away}` : match.name}</strong><b>{match.score ?? "—"}</b>
  </li>)}</ul> : <p className="team-page__empty">No hay partidos publicados para esta competición.</p>;
}

export default function SportsTeamPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const entity = SPORTS_ENTITY_BY_ID.get(teamId ?? "");
  const [data, setData] = useState<TeamOverview>();
  const [facts, setFacts] = useState<TeamClubFacts>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [section, setSection] = useState<Section>("Clasificación");
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);
  const [isPanelClosing, setIsPanelClosing] = useState(false);
  const selectedPanelRef = useRef<HTMLElement | null>(null);
  const focusedPanelRef = useRef<HTMLElement | null>(null);
  const focusedStandingRowRef = useRef<HTMLTableRowElement | null>(null);
  const focusedTrophySectionRef = useRef<HTMLElement | null>(null);
  const panelBackdropOpenRef = useRef(false);
  const panelFlipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const panelTweenRef = useRef<{ kill: () => void } | null>(null);
  const closingPanelRef = useRef(false);
  const [crestColors, setCrestColors] = useState<string[]>([NEUTRAL_CREST_COLOR]);
  const { liveEvents } = useLiveEvents(!!entity);
  const liveMatches = useMemo(() => resolveEvents(liveEvents, "live").filter(event => canonicalEventIsPlayable(event) && event.status === "live" && event.participants.some(participant => participant.entityId === entity?.id)), [liveEvents, entity]);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(false); setData(undefined);
    if (!entity) { setLoading(false); return; }
    void loadTeamOverview(entity).then(value => { if (current) setData(value); }).catch(() => { if (current) setError(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [entity]);
  useEffect(() => {
    let current = true;
    setFacts(undefined);
    if (entity?.sport === "futbol") {
      void loadTeamClubFacts(entity.id).then(value => { if (current) setFacts(value); }).catch(() => { /* Optional enrichment; never block team data. */ });
    }
    return () => { current = false; };
  }, [entity]);
  const selectPanel = useCallback((panel: HTMLElement) => {
    if (focusedPanelRef.current || closingPanelRef.current) return;
    const id = panel.dataset.teamPanelId;
    if (!id) return;
    selectedPanelRef.current = panel;
    setSelectedPanelId(id);
    requestAnimationFrame(() => panel.focus({ preventScroll: true }));
  }, []);
  const focusStandingRow = useCallback((row: HTMLTableRowElement) => {
    const previousRow = focusedStandingRowRef.current;
    if (previousRow !== row) {
      if (previousRow) {
        previousRow.removeAttribute("data-standing-focused");
        animateStandingRowFocus(previousRow, false);
      }
      focusedStandingRowRef.current = row;
      row.dataset.standingFocused = "true";
      animateStandingRowFocus(row, true);
    }
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
    const table = row.closest<HTMLElement>(".team-page__table-scroll");
    if (table) {
      const rowBounds = row.getBoundingClientRect();
      const tableBounds = table.getBoundingClientRect();
      const visibleTop = tableBounds.top + table.clientTop;
      const visibleBottom = visibleTop + table.clientHeight;
      const offset = rowBounds.top < visibleTop
        ? rowBounds.top - visibleTop
        : rowBounds.bottom > visibleBottom ? rowBounds.bottom - visibleBottom : 0;
      if (offset) scrollByGsap(table, offset, 0.48, "vertical");
    }
  }, []);
  const focusTrophySection = useCallback((section: HTMLElement) => {
    const previousSection = focusedTrophySectionRef.current;
    if (previousSection !== section) {
      if (previousSection) {
        previousSection.removeAttribute("data-trophy-focused");
        animateTrophySectionFocus(previousSection, false);
      }
      focusedTrophySectionRef.current = section;
      section.dataset.trophyFocused = "true";
      animateTrophySectionFocus(section, true);
    }
    section.tabIndex = -1;
    section.focus({ preventScroll: true });

    const scroller = section.closest<HTMLElement>(".team-page__honours");
    if (!scroller) return;
    const sectionBounds = section.getBoundingClientRect();
    const scrollerBounds = scroller.getBoundingClientRect();
    const visibleTop = scrollerBounds.top + scroller.clientTop;
    const visibleBottom = visibleTop + scroller.clientHeight;
    const offset = sectionBounds.top < visibleTop
      ? sectionBounds.top - visibleTop
      : sectionBounds.bottom > visibleBottom ? sectionBounds.bottom - visibleBottom : 0;
    if (offset) scrollByGsap(scroller, offset, 0.48, "vertical");
  }, []);
  const expandSelectedPanel = useCallback((panel: HTMLElement) => {
    const id = panel.dataset.teamPanelId;
    if (!id || focusedPanelRef.current || closingPanelRef.current) return;
    panelFlipStateRef.current = Flip.getState(panel, { props: "borderRadius,boxShadow" });
    closingPanelRef.current = false;
    selectedPanelRef.current = panel;
    focusedPanelRef.current = panel;
    panelBackdropOpenRef.current = false;
    setSelectedPanelId(id);
    setIsPanelClosing(false);
    setFocusedPanelId(id);
    requestAnimationFrame(() => {
      const initialTrophySection = panel.querySelector<HTMLElement>(".team-page__trophy");
      const initialRow = panel.querySelector<HTMLTableRowElement>("tbody tr.team-page__own")
        ?? panel.querySelector<HTMLTableRowElement>("tbody tr");
      if (initialTrophySection) focusTrophySection(initialTrophySection);
      else if (initialRow) focusStandingRow(initialRow);
      else panel.focus({ preventScroll: true });
    });
  }, [focusStandingRow, focusTrophySection]);
  const moveFocusedPanel = useCallback((offset: -1 | 1) => {
    const currentPanel = focusedPanelRef.current;
    if (!currentPanel || closingPanelRef.current) return;
    const panels = Array.from(document.querySelectorAll<HTMLElement>(".team-page__content [data-team-panel-id]"));
    const nextPanel = panels[panels.indexOf(currentPanel) + offset];
    const nextId = nextPanel?.dataset.teamPanelId;
    if (!nextPanel || !nextId) return;

    panelTweenRef.current?.kill();
    panelTweenRef.current = null;
    clearStandingRowFocus(focusedStandingRowRef.current);
    focusedStandingRowRef.current = null;
    clearTrophySectionFocus(focusedTrophySectionRef.current);
    focusedTrophySectionRef.current = null;
    panelFlipStateRef.current = Flip.getState([currentPanel, nextPanel], { props: "borderRadius,boxShadow" });
    selectedPanelRef.current = nextPanel;
    focusedPanelRef.current = nextPanel;
    closingPanelRef.current = false;
    setSelectedPanelId(nextId);
    setFocusedPanelId(nextId);
    setIsPanelClosing(false);

    requestAnimationFrame(() => {
      if (!nextPanel.isConnected || focusedPanelRef.current !== nextPanel) return;
      const initialTrophySection = nextPanel.querySelector<HTMLElement>(".team-page__trophy");
      const initialRow = nextPanel.querySelector<HTMLTableRowElement>("tbody tr.team-page__own")
        ?? nextPanel.querySelector<HTMLTableRowElement>("tbody tr");
      if (initialTrophySection) focusTrophySection(initialTrophySection);
      else if (initialRow) focusStandingRow(initialRow);
      else nextPanel.focus({ preventScroll: true });
    });
  }, [focusStandingRow, focusTrophySection]);
  const closeFocusedPanel = useCallback(() => {
    const panel = focusedPanelRef.current;
    if (!panel || closingPanelRef.current) return;
    panelTweenRef.current?.kill();
    gsap.killTweensOf(panel);
    const internalScroller = panel.querySelector<HTMLElement>(".team-page__table-scroll");
    if (internalScroller) gsap.killTweensOf(internalScroller);
    if (prefersReducedMotion()) {
      panelFlipStateRef.current = null;
      clearStandingRowFocus(focusedStandingRowRef.current);
      focusedStandingRowRef.current = null;
      clearTrophySectionFocus(focusedTrophySectionRef.current);
      focusedTrophySectionRef.current = null;
      focusedPanelRef.current = null;
      panelBackdropOpenRef.current = false;
      closingPanelRef.current = false;
      setFocusedPanelId(null);
      setIsPanelClosing(false);
      requestAnimationFrame(() => { if (panel.isConnected) panel.focus({ preventScroll: true }); });
      return;
    }
    panelFlipStateRef.current = Flip.getState(panel, { props: "borderRadius,boxShadow" });
    closingPanelRef.current = true;
    setFocusedPanelId(null);
    setIsPanelClosing(true);
  }, []);

  useEffect(() => {
    setSection("Clasificación");
    selectedPanelRef.current = null;
    focusedPanelRef.current = null;
    panelBackdropOpenRef.current = false;
    clearStandingRowFocus(focusedStandingRowRef.current);
    focusedStandingRowRef.current = null;
    clearTrophySectionFocus(focusedTrophySectionRef.current);
    focusedTrophySectionRef.current = null;
    panelFlipStateRef.current = null;
    closingPanelRef.current = false;
    setSelectedPanelId(null);
    setFocusedPanelId(null);
    setIsPanelClosing(false);
  }, [teamId]);
  useEffect(() => {
    const onGamepadAction = (event: Event) => {
      const detail = (event as CustomEvent<GamepadActionDetail>).detail;
      const action = detail?.id;
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const selectedPanel = selectedPanelRef.current;
      const focusedPanel = focusedPanelRef.current;

      if (closingPanelRef.current) {
        event.preventDefault();
        return;
      }

      if (action === "confirm") {
        if (focusedPanel) {
          const confirmingControl = activeElement && activeElement !== focusedPanel
            && activeElement.closest("[data-team-panel-id]") === focusedPanel
            && activeElement.matches("button, a[href], [role='button']");
          if (!confirmingControl) event.preventDefault();
          return;
        }
        if (selectedPanel) {
          event.preventDefault();
          expandSelectedPanel(selectedPanel);
          return;
        }
      }

      if (focusedPanel) {
        if (action === "back") {
          event.preventDefault();
          closeFocusedPanel();
          return;
        }
        if (action === "dpad-left" || action === "dpad-right") {
          event.preventDefault();
          const direction = action === "dpad-right" ? 1 : -1;
          if (focusedPanel.matches(".team-page__honours")) {
            const sections = Array.from(focusedPanel.querySelectorAll<HTMLElement>(".team-page__trophy"));
            const currentIndex = focusedTrophySectionRef.current ? sections.indexOf(focusedTrophySectionRef.current) : 0;
            const nextSection = sections[currentIndex + direction];
            if (nextSection) focusTrophySection(nextSection);
          } else {
            moveFocusedPanel(direction);
          }
          return;
        }
        const vertical = action === "dpad-up" ? -1
          : action === "dpad-down" || action === "open-controls" ? 1
            : 0;
        if (vertical) {
          event.preventDefault();
          const table = focusedPanel.querySelector<HTMLElement>(".team-page__table-scroll");
          const rows = Array.from(focusedPanel.querySelectorAll<HTMLTableRowElement>(".team-page__table-scroll tbody tr"));
          if (rows.length) {
            const activeRow = activeElement?.closest<HTMLTableRowElement>("tbody tr");
            const currentRow = focusedStandingRowRef.current ?? activeRow;
            const foundIndex = currentRow ? rows.indexOf(currentRow) : 0;
            const currentIndex = foundIndex >= 0 ? foundIndex : 0;
            const nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex + vertical));
            focusStandingRow(rows[nextIndex]);
          } else {
            const amount = Math.max(90, Math.round(focusedPanel.clientHeight * 0.62));
            scrollByGsap(table ?? focusedPanel, vertical * amount, 0.48, "vertical");
          }
          return;
        }
        return;
      }

      if (selectedPanel) {
        if (action === "back") {
          event.preventDefault();
          selectedPanelRef.current = null;
          setSelectedPanelId(null);
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`.team-page__nav button[aria-current='page']`)?.focus({ preventScroll: true }));
          return;
        }
        const direction = action === "dpad-up" ? "up"
          : action === "open-controls" ? "down"
            : action === "dpad-left" ? "left"
              : action === "dpad-right" ? "right"
                : null;
        if (direction) {
          event.preventDefault();
          const panels = Array.from(document.querySelectorAll<HTMLElement>(".team-page__content [data-team-panel-id]"));
          const currentRect = selectedPanel.getBoundingClientRect();
          const currentX = currentRect.left + currentRect.width / 2;
          const currentY = currentRect.top + currentRect.height / 2;
          const candidates = panels.filter(panel => panel !== selectedPanel).map(panel => {
            const rect = panel.getBoundingClientRect();
            const dx = rect.left + rect.width / 2 - currentX;
            const dy = rect.top + rect.height / 2 - currentY;
            const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
            const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
            return { panel, primary, secondary };
          }).filter(candidate => candidate.primary > 1)
            .sort((a, b) => a.primary + a.secondary * 2.5 - (b.primary + b.secondary * 2.5));
          if (candidates[0]) selectPanel(candidates[0].panel);
          else selectedPanel.focus({ preventScroll: true });
          return;
        }
        return;
      }

      // Al bajar desde la pestaña activa de Clasificación, el primer destino
      // es el primer panel, no el scroll de la página ni el primer control global.
      const isStandingsTab = section === "Clasificación"
        && action === "open-controls"
        && activeElement?.closest(".team-page__nav")
        && activeElement.getAttribute("aria-current") === "page";
      if (isStandingsTab) {
        const firstPanel = document.querySelector<HTMLElement>(".team-page__content [data-team-panel-id]");
        if (firstPanel) {
          event.preventDefault();
          selectPanel(firstPanel);
          return;
        }
      }
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
  }, [closeFocusedPanel, expandSelectedPanel, focusStandingRow, focusTrophySection, moveFocusedPanel, section, selectPanel]);
  useLayoutEffect(() => {
    const panel = focusedPanelRef.current;
    const state = panelFlipStateRef.current;
    if (!panel || !state || (!focusedPanelId && !isPanelClosing)) return;
    const backdrop = document.querySelector<HTMLElement>(".team-page__focus-backdrop");
    const isClosing = isPanelClosing;
    const completeOpen = () => {
      panelTweenRef.current = null;
      panelFlipStateRef.current = null;
      panelBackdropOpenRef.current = true;
    };
    const completeClose = () => {
      panelTweenRef.current = null;
      panelFlipStateRef.current = null;
      clearStandingRowFocus(focusedStandingRowRef.current);
      focusedStandingRowRef.current = null;
      clearTrophySectionFocus(focusedTrophySectionRef.current);
      focusedTrophySectionRef.current = null;
      focusedPanelRef.current = null;
      panelBackdropOpenRef.current = false;
      closingPanelRef.current = false;
      setIsPanelClosing(false);
      requestAnimationFrame(() => { if (panel.isConnected) panel.focus({ preventScroll: true }); });
    };

    if (prefersReducedMotion()) {
      panelFlipStateRef.current = null;
      if (backdrop) gsap.set(backdrop, { opacity: isClosing ? 0 : 1 });
      if (isClosing) completeClose();
      else panelBackdropOpenRef.current = true;
      return;
    }

    const timeline = gsap.timeline({ onComplete: isClosing ? completeClose : completeOpen });
    if (backdrop && isClosing) timeline.to(backdrop, { opacity: 0, duration: 0.2, ease: "power1.in" }, 0);
    else if (backdrop && !panelBackdropOpenRef.current) {
      timeline.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.26, ease: "power1.out" }, 0);
    }
    timeline.add(Flip.from(state, {
      duration: isClosing ? 0.24 : 0.42,
      ease: isClosing ? "power2.in" : "expo.out",
      scale: true,
      absolute: false,
      prune: true,
    }), 0);
    panelTweenRef.current = timeline;
  }, [focusedPanelId, isPanelClosing]);
  useEffect(() => () => {
    panelTweenRef.current?.kill();
    panelTweenRef.current = null;
    if (focusedPanelRef.current) gsap.killTweensOf(focusedPanelRef.current);
  }, []);
  useEffect(() => {
    if (!focusedPanelId && !isPanelClosing) return;
    const html = document.documentElement;
    const body = document.body;
    const scrollShell = focusedPanelRef.current?.closest<HTMLElement>("[data-aetherio-scroll-shell]");
    html.classList.add("team-page-panel-open");
    body.classList.add("team-page-panel-open");
    scrollShell?.classList.add("team-page-panel-shell");
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = focusedPanelRef.current;
      if (!panel) return;
      if (closingPanelRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFocusedPanel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )).filter(element => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || active === panel || !panel.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      html.classList.remove("team-page-panel-open");
      body.classList.remove("team-page-panel-open");
      scrollShell?.classList.remove("team-page-panel-shell");
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [closeFocusedPanel, focusedPanelId, isPanelClosing]);
  useEffect(() => {
    const close = () => navigate("/big-picture/sports", { replace: true });
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, close);
    return () => window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, close);
  }, [navigate]);
  if (!entity || !["club", "national-team"].includes(entity.kind)) return <main className="team-page"><h1>Equipo no encontrado</h1></main>;
  const crest = resolveInsignia({ entityId: entity.id, name: entity.name, size: 128 }).src;
  const sampleCrest = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    try {
      const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      setCrestColors(extractCrestColors(context.getImageData(0, 0, canvas.width, canvas.height).data, 3));
    } catch {
      setCrestColors([NEUTRAL_CREST_COLOR]);
    }
  };
  const pageStyle = {
    "--team-crest-primary": crestColors[0] ?? NEUTRAL_CREST_COLOR,
    "--team-crest-secondary": crestColors[1] ?? crestColors[0] ?? NEUTRAL_CREST_COLOR,
    "--team-crest-tertiary": crestColors[2] ?? crestColors[0] ?? NEUTRAL_CREST_COLOR,
  } as CSSProperties;
  const competition = SPORTS_ENTITY_BY_ID.get(entity.competitionId ?? "");
  const honours = TEAM_HONOURS[entity.id] ?? data?.honours;
  const ownStanding = data?.standings.flatMap(group => group.rows).find(row => row.id === data.teamId);
  const upcoming = data?.fixtures.filter(match => !match.completed) ?? [];
  const results = data?.fixtures.filter(match => match.completed).reverse() ?? [];
  const panelOverlayVisible = Boolean(focusedPanelId || isPanelClosing);
  return <main className={`team-page${panelOverlayVisible ? " team-page--panel-focused" : ""}`} aria-label={`Equipo ${entity.name}`} style={pageStyle}>
    <header className="team-page__header">
      <div className="team-page__crest">{crest ? <img key={crest} src={crest} alt="" width={128} height={128} onLoad={sampleCrest} onError={event => { event.currentTarget.hidden = true; setCrestColors([NEUTRAL_CREST_COLOR]); }} /> : <span>{initialsOf(entity.name)}</span>}</div>
      <div><h1>{entity.name}</h1><p>{[SPORTS_COUNTRY_BY_ID.get(entity.countryId ?? "")?.name, competition?.name].filter(Boolean).join(" · ")}</p><p>{data?.season ?? "Información del equipo"}</p></div>
      {ownStanding && <dl className="team-page__record"><div><dt>Puesto</dt><dd>{ownStanding.rank ? `${ownStanding.rank}º` : "—"}</dd></div><div><dt>Puntos</dt><dd>{ownStanding.points ?? "—"}</dd></div><div><dt>Jugados</dt><dd>{ownStanding.played ?? "—"}</dd></div></dl>}
    </header>
    {panelOverlayVisible && <button className="team-page__focus-backdrop" type="button" aria-label="Cerrar panel enfocado" tabIndex={-1} onClick={closeFocusedPanel} onWheel={event => event.preventDefault()} />}
    {!!liveMatches.length && <div className="team-page__live" data-spatial-grid>{liveMatches.map(event => <button key={event.id} onClick={() => { primeLivePlaybackSession(event.raw); navigate(buildPlayerPath(`type=live&id=${encodeURIComponent(event.raw.id)}`, "/big-picture/sports")); }}>Ver en directo · {event.title}</button>)}</div>}
    <nav className="team-page__nav" aria-label="Información del equipo" data-spatial-grid>{SECTIONS.map(name => <button key={name} aria-current={section === name ? "page" : undefined} onClick={() => {
      selectedPanelRef.current = null;
      setSelectedPanelId(null);
      setSection(name);
    }}>{name}</button>)}</nav>
    <section className="team-page__content" data-row-key="team-page-content" data-row-count={1} aria-labelledby="team-section-title" aria-busy={loading}>
      <h2 id="team-section-title">{section}</h2>
      {loading && (section !== "Títulos" || !honours) ? <p className="team-page__empty" role="status">Consultando datos del equipo…</p> : section === "Títulos" ? <>
        {honours ? <div
          className="team-page__panel team-page__honours liquid-glass rounded-3xl"
          data-team-panel-id="honours"
          data-panel-selected={selectedPanelId === "honours" ? "true" : undefined}
          data-panel-focused={focusedPanelId === "honours" ? "true" : undefined}
          data-spatial-navigation={focusedPanelId === "honours" ? "local" : undefined}
          tabIndex={0}
          role={focusedPanelId === "honours" ? "dialog" : "region"}
          aria-modal={focusedPanelId === "honours" ? true : undefined}
          aria-label={`Palmarés de ${entity.name}`}
          onClick={event => selectPanel(event.currentTarget)}
          onKeyDown={event => {
            if (event.key !== "Enter" || event.target !== event.currentTarget) return;
            if (selectedPanelId === "honours") expandSelectedPanel(event.currentTarget);
            else selectPanel(event.currentTarget);
          }}
        >
          {honours.competitions.map(trophy => <HonourTrophy key={trophy.name} trophy={trophy} />)}
        </div> : <p className="team-page__empty">No hay un palmarés publicado para este equipo en los datos disponibles. Eso no significa que tenga cero títulos.</p>}
      </> : error ? <p className="team-page__empty" role="alert">No se pudieron cargar los datos del equipo. Comprueba la conexión.</p> : !data?.supported ? <p className="team-page__empty">No hay datos disponibles para este equipo. Tus favoritos y las emisiones siguen disponibles.</p> : <>
        {section === "Plantilla" && data.unavailable.includes("estadísticas completas") && <p className="team-page__note" role="status">La plantilla y la clasificación están cargadas; no se pudieron consultar las estadísticas completas de goleadores.</p>}
        {section === "Clasificación" && (data.standings.length ? <div className="team-page__groups">{data.standings.map((group, index) => {
          const groupCompetition = SPORTS_ENTITY_BY_ID.get(competitionIdForStanding(group.name) ?? "");
          const groupCrest = groupCompetition ? resolveInsignia({ entityId: groupCompetition.id, name: groupCompetition.name, size: 48 }).src : undefined;
          const panelId = `standings-${index}`;
          const isFocusedPanel = focusedPanelId === panelId;
          return <div
            key={`${group.name}-${index}`}
            className="team-page__group team-page__panel liquid-glass rounded-3xl"
            data-team-panel-id={panelId}
            data-panel-selected={selectedPanelId === panelId ? "true" : undefined}
            data-panel-focused={isFocusedPanel ? "true" : undefined}
            data-spatial-navigation={isFocusedPanel ? "local" : undefined}
            tabIndex={0}
            role={isFocusedPanel ? "dialog" : "region"}
            aria-modal={isFocusedPanel ? true : undefined}
            aria-label={`Clasificación: ${group.name}`}
            onClick={event => selectPanel(event.currentTarget)}
            onKeyDown={event => {
              if (event.key !== "Enter" || event.target !== event.currentTarget) return;
              if (selectedPanelId === panelId) expandSelectedPanel(event.currentTarget);
              else selectPanel(event.currentTarget);
            }}
          >
            <h3 className="team-page__group-title">{groupCrest && <img src={groupCrest} alt="" width={40} height={40} loading="lazy" decoding="async" />}<span>{group.name}</span></h3>
            <p className="team-page__note">{group.season}</p>
            <div className="team-page__table-scroll" tabIndex={0} role="region" aria-label={`Tabla ${group.name}`}>
              <table><thead><tr>{["Pos.", "Equipo", "PJ", "G", "E", "P", "GF", "GC", "DG", "PTS"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{group.rows.map(row => <tr key={row.id} data-standing-row-id={row.id} tabIndex={isFocusedPanel ? -1 : undefined} className={row.id === data.teamId ? "team-page__own" : undefined} aria-current={row.id === data.teamId ? "true" : undefined} onClick={event => { if (isFocusedPanel) { event.stopPropagation(); focusStandingRow(event.currentTarget); } }}><td>{row.rank ?? "—"}</td><th scope="row"><span className="team-page__standing-club"><StandingMark id={row.id} name={row.name} /><span className="team-page__standing-name">{row.name}</span></span>{row.id === data.teamId && <span className="team-page__sr"> · Tu equipo</span>}</th>{[row.played, row.wins, row.draws, row.losses, row.goalsFor, row.goalsAgainst, row.difference, row.points].map((value, i) => <td key={i}>{value ?? "—"}</td>)}</tr>)}</tbody></table>
            </div>
          </div>;
        })}</div> : <p className="team-page__empty">La fuente no ha publicado una clasificación para esta competición.</p>)}
        {section === "Alineación" && (data.lineup ? <><p className="team-page__note">{data.lineup.match?.live ? "Alineación del partido en directo" : "Última alineación publicada"} · {dateLabel(data.lineup.match?.date)} · {data.lineup.match?.name}</p>{data.lineup.formation && <h3>Sistema {data.lineup.formation}</h3>}<ol className="team-page__players">{data.lineup.players.map(player => <li key={player.id}><PlayerPhoto player={data.squad.find(member => member.id === player.id) ?? player} /><span><strong>{player.name}</strong><small>Dorsal {player.jersey ?? "—"} · {player.position ?? "Posición no informada"}</small></span></li>)}</ol><p className="team-page__note">Esta alineación no confirma los titulares del próximo partido.</p></> : <p className="team-page__empty">No hay una alineación publicada para el último partido disponible.</p>)}
        {section === "Plantilla" && (data.squad.length ? <div
          className="team-page__panel team-page__squad liquid-glass rounded-3xl"
          data-team-panel-id="squad"
          data-panel-selected={selectedPanelId === "squad" ? "true" : undefined}
          data-panel-focused={focusedPanelId === "squad" ? "true" : undefined}
          data-spatial-navigation={focusedPanelId === "squad" ? "local" : undefined}
          tabIndex={0}
          role={focusedPanelId === "squad" ? "dialog" : "region"}
          aria-modal={focusedPanelId === "squad" ? true : undefined}
          aria-label={`Plantilla de ${entity.name}`}
          onClick={event => selectPanel(event.currentTarget)}
          onKeyDown={event => {
            if (event.key !== "Enter" || event.target !== event.currentTarget) return;
            if (selectedPanelId === "squad") expandSelectedPanel(event.currentTarget);
            else selectPanel(event.currentTarget);
          }}
        >
          <p className="team-page__squad-scroll-hint">Desliza horizontalmente para ver el resto de columnas.</p>
          <div className="team-page__table-scroll" tabIndex={0} role="region" aria-label={`Jugadores de ${entity.name}`}>
            <table className="team-page__squad-table">
              <caption className="team-page__sr">Plantilla de {entity.name}</caption>
              <thead><tr><th scope="col">Jugador</th><th scope="col">Dorsal</th><th scope="col">Posición</th><th scope="col">Edad</th><th scope="col">País</th><th scope="col">Goles</th></tr></thead>
              <tbody>{data.squad.map(player => <tr
                key={player.id}
                tabIndex={focusedPanelId === "squad" ? -1 : undefined}
                onClick={event => {
                  if (focusedPanelId === "squad") {
                    event.stopPropagation();
                    focusStandingRow(event.currentTarget);
                  }
                }}
              >
                <th scope="row"><span className="team-page__player-name"><PlayerPhoto player={player} />{player.name}</span></th>
                <td>{player.jersey ?? "—"}</td><td>{player.position ?? "—"}</td><td>{player.age ?? "—"}</td><td>{player.country ?? "—"}</td><td>{player.goals ?? "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div> : <p className="team-page__empty">No hay una plantilla publicada para esta temporada.</p>)}
        {section === "Partidos" && <><h3>Próximos partidos</h3><Fixtures fixtures={upcoming} /><h3>Resultados</h3><Fixtures fixtures={results} /></>}
      </>}
    </section>
    {(data?.venue || facts) && <aside className="team-page__note" aria-label="Datos del club">
      {(data?.venue || facts?.stadium) && <p>Estadio: {data?.venue ?? facts?.stadium}{data?.city ? ` · ${data.city}` : ""}</p>}
      {facts && <p>Complemento Wikidata ({facts.wikidataId}){facts.website ? ` · Web del club: ${facts.website}` : ""}. Datos sin verificación editorial. Fuente: {facts.source}</p>}
    </aside>}
  </main>;
}
