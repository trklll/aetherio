import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLiveEvents } from "../../hooks/useLiveEvents.ts";
import { canonicalEventIsPlayable, mergeCanonicalEvents, resolveEvents } from "../../data/sports/identity.ts";
import { reopenSportsOnboarding, useSportsPreferences } from "../../data/sports/preferences.ts";
import { primeLivePlaybackSession } from "../../services/liveSportsService.ts";
import type { MediaItem } from "../../types/ui.ts";
import { buildPlayerPath } from "../../utils/bigPictureDetail.ts";
import { prefersReducedMotion } from "../../utils/motion.ts";
import BigPictureBackdrop from "./BigPictureBackdrop.tsx";
import BigPictureHero from "./BigPictureHero.tsx";
import { SportsOnboarding } from "./BigPictureSportsOnboarding.tsx";
import CatalogRow from "../Home/CatalogRow.tsx";
import { buildSportsHome, hasSportsPersonalizationFilters } from "./sportsHome.ts";
import SportsReplaysRow from "./SportsReplaysRow.tsx";
import { buildSportsChannels } from "./sportsChannels.ts";
import SportsIptvSettings from "./SportsIptvSettings.tsx";
import SportsSourcesDialog from "./SportsSourcesDialog.tsx";
import type { LiveEvent, LiveSource } from "../../types/liveSports.ts";
import "./BigPictureSports.css";
import "./BigPictureSportsHome.css";

/** Same canvas, hero and horizontal CatalogRow as Aetherio Home. */
export default function BigPictureSportsHome() {
  const location = useLocation();
  const navigate = useNavigate();
  const prefs = useSportsPreferences();
  const { liveEvents, upcomingGroups, channels, loading, refreshing, error, refresh } = useLiveEvents(prefs.onboarding !== "pending");
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeItem, setActiveItem] = useState<MediaItem>();
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [iptvSettingsOpen, setIptvSettingsOpen] = useState(false);
  const [sourceEvent, setSourceEvent] = useState<LiveEvent | null>(null);
  const showOnboarding = prefs.onboarding === "pending";

  useLayoutEffect(() => {
    scrollRef.current = pageRef.current?.closest<HTMLDivElement>("[data-aetherio-scroll-shell]") ?? null;
  }, [showOnboarding]);

  const canonical = useMemo(() => mergeCanonicalEvents([
    ...resolveEvents(liveEvents, "live"),
    ...resolveEvents(upcomingGroups.flatMap(group => group.events), "agenda"),
  ]), [liveEvents, upcomingGroups]);
  const home = useMemo(() => buildSportsHome(canonical, prefs), [canonical, prefs]);
  const channelHome = useMemo(() => buildSportsChannels(channels, prefs.sports), [channels, prefs.sports]);
  const heroItems = useMemo(() => [...home.heroItems, ...channelHome.items], [home.heroItems, channelHome.items]);

  const startEvent = useCallback((event: LiveEvent, selected?: LiveSource) => {
    primeLivePlaybackSession(event, selected?.id);
    navigate(buildPlayerPath(`type=live&id=${encodeURIComponent(event.id)}`, location.pathname));
  }, [navigate, location.pathname]);

  const play = useCallback((item: MediaItem) => {
    const channel = channelHome.byId.get(item.id);
    if (channel) { startEvent(channel); return; }
    const event = home.eventsById.get(item.id);
    if (!event || event.status !== "live" || !canonicalEventIsPlayable(event)) return;
    startEvent(event.raw);
  }, [home.eventsById, channelHome.byId, startEvent]);

  const openCard = useCallback((item: MediaItem) => {
    const event = home.eventsById.get(item.id);
    if (!event) return;
    if (event.status === "live" && canonicalEventIsPlayable(event)) {
      play(item);
      return;
    }
    // Agenda cards show their schedule in the hero; they never launch an empty player.
    setSelectedItemId(item.id);
    scrollRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    pageRef.current?.querySelector<HTMLElement>("[data-sports-personalize]")?.focus({ preventScroll: true });
  }, [home.eventsById, play]);

  const heroItem = heroItems.find(item => item.id === activeItem?.id) ?? heroItems[0];
  const heroEvent = heroItem ? home.eventsById.get(heroItem.id) : undefined;
  const heroChannel = heroItem ? channelHome.byId.get(heroItem.id) : undefined;

  // Foco inicial con mando, igual que Party/Genre/Search/Settings: la page
  // marca su acción principal y se enfoca a sí misma al entrar. El requester
  // del motor (380 ms tras la ruta) no basta: las entradas vienen del rail,
  // cuyo item queda enfocado (el motor ignora dentro del rail y su requester
  // no actúa sin activeElement en el contenido), y el hero puede montar más
  // tarde si la agenda tarda en cargar. Solo reclama el foco cuando nadie lo
  // tiene (body o item del rail ya colapsado): no roba el teclado al
  // onboarding — él posee el foco con su propio manejador.
  useEffect(() => {
    if (showOnboarding) return;
    const timer = window.setTimeout(() => {
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
  }, [showOnboarding, heroItem?.id, loading, home.rows.length]);

  return (
    <div ref={pageRef} className={`bp-sports${showOnboarding ? "" : " bp-sports--home"}`} data-bp-sports>
      {showOnboarding ? (
        <section className="bp-sports__body bp-sports__body--onboard">
          <SportsOnboarding onDone={refresh} onSkip={refresh} />
        </section>
      ) : (
        <>
          <BigPictureBackdrop
            items={heroItems}
            scrollRef={scrollRef}
            onActiveItem={setActiveItem}
            trailersEnabled={false}
            selectedItemId={selectedItemId}
          />
          <div className="home-page-scale relative flex min-h-full flex-col">
            {heroItem ? (
              <BigPictureHero
                item={heroItem}
                onOpenItem={play}
                primaryLabel={heroChannel ? "Ver canal" : heroItem.genres?.[0] === "En directo" ? "Ver en directo" : "Próximamente"}
                primaryDisabled={!heroChannel && (!heroEvent || heroEvent.status !== "live" || !canonicalEventIsPlayable(heroEvent))}
              />
            ) : (
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
              {home.rows.map(row => (
                <CatalogRow
                  key={row.catalogId}
                  row={row}
                  titleOverride={row.name}
                  posterLayout="horizontal"
                  persistHomeScroll={false}
                  disableHeaderNavigation
                  showViewMore={false}
                  onOpenItem={openCard}
                  onChooseSources={row.catalogId === "sports-now" ? item => setSourceEvent(home.eventsById.get(item.id)?.raw ?? null) : undefined}
                />
              ))}
              {channelHome.row && <section aria-label="Canales deportivos">
                <CatalogRow row={channelHome.row} titleOverride="Canales deportivos" posterLayout="horizontal" persistHomeScroll={false} disableHeaderNavigation showViewMore={false} onOpenItem={play} />
              </section>}
              <SportsReplaysRow />
              <div className="bp-sports-home__tools" data-spatial-grid>
                <button type="button" className="bp-sports__cta bp-sports__cta--ghost" data-sports-personalize onClick={() => reopenSportsOnboarding()}>Personalizar</button>
                <button type="button" className="bp-sports__cta bp-sports__cta--ghost" onClick={refresh} disabled={refreshing}>{refreshing ? "Actualizando…" : "Actualizar agenda"}</button>
                <button type="button" className="bp-sports__cta bp-sports__cta--ghost" onClick={() => setIptvSettingsOpen(true)}>Listas IPTV</button>
              </div>
            </div>
          </div>
          {iptvSettingsOpen && <SportsIptvSettings onClose={() => setIptvSettingsOpen(false)} />}
          {sourceEvent && <SportsSourcesDialog event={sourceEvent} onClose={() => setSourceEvent(null)} onSelect={source => { setSourceEvent(null); startEvent(sourceEvent, source); }} />}
        </>
      )}
    </div>
  );
}
