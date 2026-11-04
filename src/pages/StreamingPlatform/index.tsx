import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Volume2 } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import CatalogRow from "../Home/CatalogRow";
import { prewarmSpatialPosterRows } from "../../hooks/useCatalogs";
import { useHomePreferences } from "../../config/homePreferences";
import {
  fetchStreamingPlatformCollections,
  fetchStreamingPlatformRows,
  getStreamingPlatform,
  type StreamingPlatformCollection,
  type StreamingPlatformId,
} from "../../services/streamingPlatforms";
import type { CatalogRowData } from "../../types/ui";
import { shouldPlayPlatformIntroForEntry } from "../../services/streamingPlatformIntroHistory";
import StreamingCollectionsRow from "./StreamingCollectionsRow";
import CrunchyrollTrending from "./CrunchyrollTrending";
import "./index.css";

const PLATFORM_ROWS_CACHE_TTL = 15 * 60 * 1000;
const PLATFORM_POSTER_PREWARM_LIMIT = 12;
const INTRO_EXIT_DURATION_MS = 420;
const REDUCED_INTRO_EXIT_DURATION_MS = 180;
const platformRowsCache = new Map<string, { rows: CatalogRowData[]; collections: StreamingPlatformCollection[]; storedAt: number }>();

export default function StreamingPlatformPage({ bigPicture = false }: { bigPicture?: boolean }) {
  const { platformId } = useParams<{ platformId: StreamingPlatformId }>();
  const location = useLocation();
  const platform = getStreamingPlatform(platformId);
  const navigate = useNavigate();
  const preferences = useHomePreferences();
  const pageRootRef = useRef<HTMLElement>(null);
  const introVideoRef = useRef<HTMLVideoElement>(null);
  const introSkipRef = useRef<HTMLButtonElement>(null);
  const [rows, setRows] = useState<CatalogRowData[]>([]);
  const [collections, setCollections] = useState<StreamingPlatformCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [introDecision, setIntroDecision] = useState<{ platformId: string; shouldPlay: boolean } | null>(null);
  const [introClosing, setIntroClosing] = useState(false);
  const [needsSound, setNeedsSound] = useState(false);
  const introDecisionRef = useRef<{ platformId: string; shouldPlay: boolean } | null>(null);
  const videoStartedPlatformRef = useRef<string | null>(null);
  const introClosingRef = useRef(false);
  const introExitTimerRef = useRef<number | null>(null);
  const introVisible = Boolean(
    platform?.intro
    && introDecision?.platformId === platform.id
    && introDecision.shouldPlay,
  );
  const pageContentVisible = !platform?.intro || (
    introDecision?.platformId === platform.id
    && (!introDecision.shouldPlay || introClosing)
  );

  useEffect(() => {
    if (bigPicture) return;

    const scrollShell = pageRootRef.current?.closest<HTMLElement>("[data-aetherio-scroll-shell]");
    if (!scrollShell) return;

    scrollShell.classList.add("streaming-platform-scroll-shell");
    return () => scrollShell.classList.remove("streaming-platform-scroll-shell");
  }, [bigPicture]);

  useEffect(() => {
    if (!platform) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const cached = platformRowsCache.get(platform.id);
    if (cached && Date.now() - cached.storedAt < PLATFORM_ROWS_CACHE_TTL) {
      setRows(cached.rows);
      setCollections(cached.collections);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    setRows([]);
    setCollections([]);
    void fetchStreamingPlatformRows(platform.id)
      .then(nextRows => {
        if (cancelled) return;
        setRows(nextRows);
        const collectionMovies = nextRows
          .filter(row => row.catalogId === `streaming.${platform.id}.movie.popular` || row.catalogId === `streaming.${platform.id}.movie.top-rated`)
          .flatMap(row => row.items);
        void fetchStreamingPlatformCollections(platform.id, collectionMovies)
          .then(nextCollections => {
            if (cancelled) return;
            platformRowsCache.set(platform.id, { rows: nextRows, collections: nextCollections, storedAt: Date.now() });
            setCollections(nextCollections);
          })
          .catch(() => {
            if (!cancelled) setCollections([]);
          });
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [platform?.id, retry]);

  useEffect(() => {
    if (!rows.length || preferences.posterLayout !== "vertical") return;

    // La fila virtualizada solo monta las cards cercanas al viewport. Calienta
    // esas primeras cards en la caché persistente de SpatialPosters sin frenar
    // el render; las siguientes se cachean cuando entran en la fila visible.
    const initialRows = rows.map(row => ({
      ...row,
      items: row.items.slice(0, PLATFORM_POSTER_PREWARM_LIMIT),
    }));
    void prewarmSpatialPosterRows(initialRows).catch(() => undefined);
  }, [preferences.posterLayout, rows]);

  useEffect(() => {
    if (introExitTimerRef.current !== null) {
      window.clearTimeout(introExitTimerRef.current);
      introExitTimerRef.current = null;
    }
    introClosingRef.current = false;
    setIntroClosing(false);

    if (!platform?.intro) {
      const decision = null;
      introDecisionRef.current = decision;
      setIntroDecision(decision);
      return;
    }

    // React StrictMode vuelve a ejecutar los efectos de montaje en desarrollo.
    // Reutilizamos la primera decisión para no consumir el intro en ese replay.
    const priorDecision = introDecisionRef.current;
    if (priorDecision?.platformId === platform.id) {
      setIntroDecision(priorDecision);
      return;
    }

    const shouldPlay = shouldPlayPlatformIntroForEntry(
      platform.id,
      location.key,
      preferences.playStreamingPlatformIntros,
    );
    const decision = { platformId: platform.id, shouldPlay };
    introDecisionRef.current = decision;
    setIntroDecision(decision);
    setNeedsSound(false);
  }, [location.key, platform?.id, platform?.intro, preferences.playStreamingPlatformIntros]);

  useEffect(() => () => {
    if (introExitTimerRef.current !== null) {
      window.clearTimeout(introExitTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const video = introVideoRef.current;
    if (!platform?.intro || !introVisible || !video) return;

    if (videoStartedPlatformRef.current === platform.id) {
      const decision = { platformId: platform.id, shouldPlay: false };
      introDecisionRef.current = decision;
      setIntroDecision(decision);
      return;
    }

    let cancelled = false;
    videoStartedPlatformRef.current = platform.id;
    setNeedsSound(false);
    video.muted = false;
    video.volume = 1;
    try {
      video.currentTime = 0;
    } catch {
      // Algunos decodificadores no aceptan seek hasta cargar metadata.
    }

    void video.play().catch(() => {
      if (cancelled) return;
      setNeedsSound(true);
      video.muted = true;
      void video.play().catch(() => {
        if (!cancelled) {
          const decision = { platformId: platform.id, shouldPlay: false };
          introDecisionRef.current = decision;
          setIntroDecision(decision);
        }
      });
    });

    return () => {
      cancelled = true;
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // No hay nada que limpiar si el medio aún no se puede buscar.
      }
    };
  }, [introVisible, platform?.id, platform?.intro]);

  useEffect(() => {
    if (!introVisible || introClosing) return;
    const frame = window.requestAnimationFrame(() => introSkipRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [introVisible, introClosing, platform?.id]);

  const closeIntro = useCallback(() => {
    if (!platform || !introVisible || introClosingRef.current) return;

    introClosingRef.current = true;
    setIntroClosing(true);
    introVideoRef.current?.pause();
    setNeedsSound(false);

    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? REDUCED_INTRO_EXIT_DURATION_MS
      : INTRO_EXIT_DURATION_MS;
    introExitTimerRef.current = window.setTimeout(() => {
      const decision = { platformId: platform.id, shouldPlay: false };
      introDecisionRef.current = decision;
      introClosingRef.current = false;
      introExitTimerRef.current = null;
      setIntroDecision(decision);
      setIntroClosing(false);
    }, duration);
  }, [introVisible, platform]);

  const activateSound = useCallback(() => {
    const video = introVideoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    void video.play()
      .then(() => setNeedsSound(false))
      .catch(() => {
        video.muted = true;
        setNeedsSound(true);
      });
  }, []);

  const retryCatalog = useCallback(() => {
    if (platform) platformRowsCache.delete(platform.id);
    setRetry(count => count + 1);
  }, [platform]);

  const goBack = useCallback(() => {
    navigate(bigPicture ? "/big-picture" : "/home");
  }, [bigPicture, navigate]);

  if (!platform) {
    return (
      <main className="streaming-platform-page streaming-platform-page--missing">
        <h1>No encontramos esa plataforma</h1>
        {!bigPicture ? (
          <button type="button" className="streaming-platform-back" onClick={goBack}>
            <ArrowLeft size={17} aria-hidden="true" /> Volver al inicio
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <main
      ref={pageRootRef}
      className={`streaming-platform-page home-page-scale${bigPicture ? " streaming-platform-page--big-picture" : ""}${pageContentVisible ? " streaming-platform-page--content-visible" : ""}`}
      style={{ "--platform-accent": platform.accent } as CSSProperties}
      data-streaming-platform={platform.id}
    >
      <div className="streaming-platform-page__backdrop" aria-hidden="true">
      </div>
      <div className="streaming-platform-page__scrim" aria-hidden="true" />

      <div className="streaming-platform-page__content" aria-hidden={!pageContentVisible} inert={!pageContentVisible}>
        {!bigPicture ? (
          <button type="button" className="streaming-platform-back liquid-glass-pill" onClick={goBack}>
            <ArrowLeft size={17} aria-hidden="true" /> Volver
          </button>
        ) : null}

        <header className="streaming-platform-hero">
          <div className="streaming-platform-hero__copy">
            <h1 className="streaming-platform-hero__title"><img src={platform.titleImage} alt={platform.name} /></h1>
            <p>{platform.description}</p>
          </div>
        </header>

        <section className="streaming-platform-catalog" aria-label={`Catálogo de ${platform.name}`}>
          {platform.id === "crunchyroll" ? <CrunchyrollTrending /> : null}
          {loading ? (
            <div className="streaming-platform-state" role="status">Cargando películas y series…</div>
          ) : rows.length ? (
            <>
              {rows.map((row, index) => (
                <Fragment key={`${row.type}:${row.catalogId}`}>
                  {index === 2 && collections.length ? (
                    <StreamingCollectionsRow platformId={platform.id} collections={collections} />
                  ) : null}
                  <CatalogRow
                    row={row}
                    posterLayout={preferences.posterLayout}
                    titleOverride={row.name}
                    persistHomeScroll={false}
                    disableHeaderNavigation={bigPicture}
                    showViewMore
                  />
                </Fragment>
              ))}
              {rows.length < 3 && collections.length ? (
                <StreamingCollectionsRow platformId={platform.id} collections={collections} />
              ) : null}
            </>
          ) : (
            <div className="streaming-platform-state" role="status">
              <p>No encontramos títulos disponibles para {platform.name} en este momento.</p>
              <button type="button" className="streaming-platform-retry" onClick={retryCatalog}>Intentar de nuevo</button>
            </div>
          )}
        </section>
      </div>

      {introVisible ? (
        createPortal(
          <section
            className={`streaming-platform-intro${introClosing ? " streaming-platform-intro--closing" : ""}`}
            aria-label={`Introducción de ${platform.name}`}
          >
            <video
              ref={introVideoRef}
              key={platform.id}
              className="streaming-platform-intro__video"
              src={platform.intro}
              autoPlay
              playsInline
              preload="auto"
              aria-hidden="true"
              onEnded={closeIntro}
              onError={closeIntro}
            />
            <div
              className="streaming-platform-intro__controls"
              role="dialog"
              aria-modal={!introClosing}
              aria-hidden={introClosing}
              inert={introClosing}
              aria-label={`Introducción de ${platform.name}`}
            >
              {needsSound ? (
                <button type="button" className="streaming-platform-intro__sound" onClick={activateSound}>
                  <Volume2 size={17} aria-hidden="true" /> Activar sonido
                </button>
              ) : null}
              <button ref={introSkipRef} type="button" className="streaming-platform-intro__skip liquid-glass rounded-full" onClick={closeIntro}>Omitir intro</button>
            </div>
          </section>,
          document.body,
        )
      ) : null}
    </main>
  );
}
