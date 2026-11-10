import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLiveEvents } from "../../hooks/useLiveEvents.ts";
import { mergeCanonicalEvents, resolveEvents } from "../../data/sports/identity.ts";
import { getSportsPreferencesStorageKey, reopenSportsOnboarding, useSportsPreferences } from "../../data/sports/preferences.ts";
import type { MediaItem } from "../../types/ui.ts";
import { SportsOnboarding } from "./BigPictureSportsOnboarding.tsx";
import CatalogRow from "../Home/CatalogRow.tsx";
import { buildSportsHome, hasSportsPersonalizationFilters } from "./sportsHome.ts";
import SportsIptvSettings from "./SportsIptvSettings.tsx";
import SportsMatchCard from "./SportsMatchCard.tsx";
import SportsTeamsRow, { SportsCompetitionsRow } from "./SportsTeamsRow.tsx";
import { matchDetailFromCanonicalEvent, saveMatchPreview, sportsMatchPath } from "../Sports/matchDetail.ts";
import "./BigPictureSports.css";
import "./BigPictureSportsHome.css";

function safeTeamColor(color: string | undefined): string {
  return color && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) ? color : "#45494F";
}

function hasChromaticColor(color: string): boolean {
  const hex = color.slice(1);
  const channels = hex.length === 3
    ? [...hex].map(value => parseInt(value + value, 16))
    : [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
  return Math.max(...channels) - Math.min(...channels) >= 32;
}

function formatSportsHomeClock(): string {
  try {
    return new Intl.DateTimeFormat("es-PE", { hour: "numeric", minute: "2-digit" }).format(new Date());
  } catch {
    return "";
  }
}

/** Sports event catalogs without the general Home hero. */
export default function BigPictureSportsHome() {
  const location = useLocation();
  const navigate = useNavigate();
  const prefs = useSportsPreferences();
  const { events: scheduledEvents, upcomingGroups, loading, refreshing, error, refresh } = useLiveEvents(prefs.onboarding !== "pending");
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [iptvSettingsOpen, setIptvSettingsOpen] = useState(false);
  const [focusedBackdropItem, setFocusedBackdropItem] = useState<MediaItem>();
  const [sampledColors, setSampledColors] = useState<ReadonlyMap<string, { home?: string; away?: string }>>(() => new Map());
  const onTeamColorSample = useCallback((itemId: string, side: "home" | "away", color: string) => {
    setSampledColors(previous => {
      const colors = previous.get(itemId);
      if (colors?.[side] === color) return previous;
      return new Map(previous).set(itemId, { ...colors, [side]: color });
    });
  }, []);
  const focusedSampledColors = focusedBackdropItem ? sampledColors.get(focusedBackdropItem.id) : undefined;
  const ambientStyle = useMemo(() => {
    let homeColor = safeTeamColor(focusedSampledColors?.home ?? focusedBackdropItem?.sportsMatch?.home?.color);
    let awayColor = safeTeamColor(focusedSampledColors?.away ?? focusedBackdropItem?.sportsMatch?.away?.color ?? focusedBackdropItem?.sportsMatch?.home?.color);
    // A neutral/crestless opponent should not wash out the real team color in
    // the full-screen ambient layer; keep the card's own unknown field neutral.
    if (hasChromaticColor(homeColor) && !hasChromaticColor(awayColor)) awayColor = homeColor;
    else if (!hasChromaticColor(homeColor) && hasChromaticColor(awayColor)) homeColor = awayColor;
    return {
      "--match-home-color": homeColor,
      "--match-away-color": awayColor,
    } as CSSProperties;
  }, [focusedBackdropItem, focusedSampledColors]);
  const showOnboarding = prefs.onboarding === "pending";
  const previousHashRef = useRef(location.hash);
  const [clock, setClock] = useState(formatSportsHomeClock);
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    let frame = 0;
    const docs = [document];
    try {
      if (window.parent !== window) docs.push(window.parent.document);
    } catch { /* Cross-origin parent: the local shell listener below still works. */ }
    const sync = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const roots = docs.map(doc => doc.documentElement);
        const explicit = roots.map(root => root.dataset.topNavCollapsed);
        if (explicit.some(value => value === "true")) {
          setNavCollapsed(true);
          return;
        }
        if (explicit.some(value => value !== undefined)) {
          setNavCollapsed(false);
          return;
        }
        const scrollTop = docs.reduce((max, doc) => {
          const shells = Array.from(doc.querySelectorAll<HTMLElement>("[data-aetherio-scroll-shell]"));
          const shellY = shells.reduce((value, shell) => Math.max(value, shell.scrollTop), 0);
          return Math.max(max, shellY, doc.scrollingElement?.scrollTop ?? 0);
        }, 0);
        setNavCollapsed(scrollTop > 220);
      });
    };
    docs.forEach(doc => doc.addEventListener("scroll", sync, { capture: true, passive: true }));
    window.addEventListener("resize", sync);
    const observer = new MutationObserver(sync);
    docs.forEach(doc => observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-top-nav-collapsed"] }));
    sync();
    return () => {
      docs.forEach(doc => doc.removeEventListener("scroll", sync, true));
      window.removeEventListener("resize", sync);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatSportsHomeClock()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (location.hash !== "#personalizar") return;
    reopenSportsOnboarding();
    navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);

  useEffect(() => {
    const previousHash = previousHashRef.current;
    previousHashRef.current = location.hash;
    const returningHome = !location.hash && previousHash === "#equipos";
    const encodedCompetitionId = location.hash.startsWith("#competicion=")
      ? location.hash.slice("#competicion=".length)
      : null;
    let competitionId: string | null = null;
    try {
      competitionId = encodedCompetitionId ? decodeURIComponent(encodedCompetitionId) : null;
    } catch {
      competitionId = null;
    }
    const selector = location.hash === "#equipos" ? "#sports-followed-teams"
      : location.hash === "#competiciones" || competitionId ? "#sports-followed-competitions"
      : null;
    if ((!selector && !returningHome) || showOnboarding) return;
    // Wait for the shared rail to finish returning focus before selecting a row.
    const timer = window.setTimeout(() => {
      const section = returningHome ? pageRef.current : pageRef.current?.querySelector<HTMLElement>(selector!);
      const shell = scrollRef.current;
      if (!section || !shell) return;
      const target = (competitionId
        ? Array.from(section.querySelectorAll<HTMLElement>("[data-sports-competition-id]"))
          .find(button => button.dataset.sportsCompetitionId === competitionId)
        : null)
        ?? section.querySelector<HTMLElement>("button[data-row-card]")
        ?? section.querySelector<HTMLElement>("button:not([disabled]), .media-card-frame");
      target?.focus({ preventScroll: true });
      shell.scrollTo({ top: returningHome ? 0 : shell.scrollTop + section.getBoundingClientRect().top - shell.getBoundingClientRect().top - 130, behavior: "instant" });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [location.hash, location.key, showOnboarding]);

  useLayoutEffect(() => {
    const shell = pageRef.current?.closest<HTMLDivElement>("[data-aetherio-scroll-shell]") ?? null;
    scrollRef.current = shell;
    // Sports must start at the same top composition on every entry. The shell
    // is shared across routes and may otherwise retain the previous page's offset.
    shell?.scrollTo({ top: 0, behavior: "instant" });
  }, [showOnboarding]);

  const canonical = useMemo(() => mergeCanonicalEvents([
    ...resolveEvents(scheduledEvents, "live"),
    ...resolveEvents(upcomingGroups.flatMap(group => group.events), "agenda"),
  ]), [scheduledEvents, upcomingGroups]);
  const home = useMemo(() => buildSportsHome(canonical, prefs), [canonical, prefs]);
  const hasNowRow = home.rows.some(row => row.catalogId === "sports-now");
  const openEvent = useCallback((event: Parameters<typeof matchDetailFromCanonicalEvent>[0]) => {
    const detail = matchDetailFromCanonicalEvent(event);
    if (detail) saveMatchPreview(getSportsPreferencesStorageKey(), detail);
    navigate(sportsMatchPath(event.id));
  }, [navigate]);

  const openCard = useCallback((item: MediaItem) => {
    const event = home.eventsById.get(item.id);
    if (!event) return;
    openEvent(event);
  }, [home.eventsById, openEvent]);

  const teamsRow = <SportsTeamsRow events={canonical} loading={loading} onOpenEvent={openEvent} />;
  const followedRows = <>{teamsRow}<SportsCompetitionsRow /></>;

  // Foco inicial con mando: el requester del motor puede no actuar al entrar
  // desde el rail. Reclamarlo solo si no hay foco útil evita robarlo al
  // onboarding o a cualquier control que ya lo tenga.
  useEffect(() => {
    if (showOnboarding) return;
    const timer = window.setTimeout(() => {
      if (scrollRef.current?.dataset.rowPositionRestoring === "true") return;
      const active = document.activeElement as HTMLElement | null;
      const orphaned = !active || active === document.body || active === document.documentElement
        || active.closest(".bp-rail") !== null;
      if (!orphaned) return;
      if (document.querySelector("dialog[open][data-spatial-modal]")) return;
      const primary = document.querySelector<HTMLElement>("[data-bp-sports] [data-hero-primary]");
      if (primary instanceof HTMLButtonElement && primary.offsetWidth > 0 && !primary.disabled) {
        primary.focus({ preventScroll: true });
        return;
      }
      // Hero de agenda con primaria deshabilitada (Próximamente): la primera
      // card de la primera row, el camino que el motor usaría sin memoria.
      const holder = document.querySelector<HTMLElement>("[data-bp-sports] [data-row-key] [data-item-index]");
      const card = holder?.matches("button:not([disabled])") ? holder
        : holder?.querySelector<HTMLElement>("button:not([disabled]), [tabindex]:not([tabindex='-1'])");
      card?.focus({ preventScroll: true });
    }, 70);
    return () => window.clearTimeout(timer);
  }, [showOnboarding, loading, home.rows.length]);

  return (
    <div ref={pageRef} className={`bp-sports${showOnboarding ? "" : " bp-sports--home"}`} data-bp-sports>
      {showOnboarding ? (
        <section className="bp-sports__body bp-sports__body--onboard">
          <SportsOnboarding onDone={refresh} onSkip={refresh} />
        </section>
      ) : (
        <>
          <div className={`bp-sports__ambient${focusedBackdropItem ? " bp-sports__ambient--visible" : ""}`} style={ambientStyle} aria-hidden="true">
            <div className="bp-sports__ambient-away" />
          </div>
          <time className="bp-sports-home__clock" data-collapsed={navCollapsed} aria-label="Hora actual">{clock}</time>
          <div className="home-page-scale relative flex min-h-full flex-col">
            {home.rows.length === 0 && (
              <header className="bp-sports-home__empty" data-hero-panel>
                <h1>Sports</h1>
                <p role="status">{loading
                  ? "Cargando eventos deportivos…"
                  : hasSportsPersonalizationFilters(prefs)
                    ? "Nada de lo que sigues está disponible ahora mismo."
                    : "No hay eventos disponibles ahora mismo."}</p>
                {!loading && hasSportsPersonalizationFilters(prefs) && (
                  <button type="button" className="bp-sports__cta" data-sports-personalize onClick={() => reopenSportsOnboarding()}>Personalizar</button>
                )}
                {!loading && <button type="button" className="bp-sports__cta" data-hero-primary onClick={refresh}>Actualizar agenda</button>}
              </header>
            )}
            <div className="relative flex min-h-full flex-col bp-sports-home__catalogs">
              {error && <p className="bp-sports-home__status" role="status">{error}</p>}
              {!hasNowRow && home.rows.length > 0 ? (
                <>
                  <section className="bp-sports-home__now-empty" aria-labelledby="sports-now-empty-title">
                    <h2 id="sports-now-empty-title" className="home-row-title">Ahora mismo</h2>
                    <p>Sin partidos en directo ahora mismo.</p>
                  </section>
                  {followedRows}
                </>
              ) : null}
              {home.rows.map(row => (
                <Fragment key={row.catalogId}>
                <CatalogRow
                  key={row.catalogId}
                  row={row}
                  titleOverride={row.name}
                  posterLayout="horizontal"
                  itemGap={26}
                  persistHomeScroll={false}
                  disableHeaderNavigation
                  showViewMore={false}
                  onOpenItem={openCard}
                  onFocusItem={setFocusedBackdropItem}
                  renderCard={item => <SportsMatchCard item={item} onOpenItem={openCard} onTeamColorSample={onTeamColorSample} />}
                />
                {row.catalogId === "sports-now" && followedRows}
                </Fragment>
              ))}
              {home.rows.length === 0 && followedRows}
              <div className="bp-sports-home__tools" data-spatial-grid>
                <button type="button" className="bp-sports__cta bp-sports__cta--ghost" data-sports-personalize onClick={() => reopenSportsOnboarding()}>Personalizar</button>
                <button type="button" className="bp-sports__cta bp-sports__cta--ghost" onClick={refresh} disabled={refreshing}>{refreshing ? "Actualizando…" : "Actualizar agenda"}</button>
                <button type="button" className="bp-sports__cta bp-sports__cta--ghost" onClick={() => setIptvSettingsOpen(true)}>Listas IPTV</button>
              </div>
            </div>
          </div>
        </>
      )}
      {iptvSettingsOpen && <SportsIptvSettings onClose={() => setIptvSettingsOpen(false)} />}
    </div>
  );
}
