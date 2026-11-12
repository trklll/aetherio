import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  type Location,
} from "react-router-dom";
import {
  Activity,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reloadAddonsForActiveProfile, useAddonStore } from "./store/addonStore.ts";
import { rehydrateHomeCacheForActiveProfile } from "./store/cacheStore.ts";
import { getSpatialPosterSettings, setPosterCacheUrl } from "./config/spatialPosters";
import { ensurePosterServer, getPosterCacheUrl } from "./services/posterServer";
import AppShell from "./components/layout/AppShell.tsx";
import {
  createLocalProfile,
  getLocalProfiles,
  hasActiveLocalProfile,
  setActiveProfile,
} from "./utils/localProfiles.ts";
import { prefetchHomeData, warmHomeStartup } from "./hooks/useCatalogs.ts";
import { useFullscreen } from "./hooks/useFullscreen.ts";
import { getHomePreferences } from "./config/homePreferences.ts";
import { completeGoogleDriveAuthorization, initGoogleDriveSync, isGoogleDriveCallbackUrl } from "./gdrive";
import {
  getCurrentDeepLinks,
  listenOpenFiles,
  listenOpenUrls,
  listenWindowFileDrops,
  takePendingOpenFiles,
} from "./runtime/platform.ts";
import AuthPage from "./pages/AuthPage.tsx";
import StartupExperience from "./components/startup/StartupExperience.tsx";
import {
  AETHERIO_AUTH_CHANGED_EVENT,
  completeOAuthAuthorization,
  dispatchAuthError,
  getStoredAccount,
  isLocalModeEnabled,
  isOAuthCallbackUrl,
  restoreAccountSession,
  type AetherioUser,
} from "./auth/authClient.ts";
import {
  initializeAniListProgressSync,
  syncAniListLibrary,
} from "./integrations/aniList.ts";
import { startDiscordRichPresence, stopDiscordRichPresence } from "./integrations/discordPresence.ts";
import { PartyProvider } from "./party/PartyContext.tsx";
import GamepadWakeListener from "./components/gamepad/GamepadWakeListener.tsx";
import { parsePartyJoinDeepLink, writePendingPartyJoin } from "./party/invite.ts";
import {
  getPlaybackPreferences,
  PLAYBACK_PREFERENCES_CHANGED_EVENT,
} from "./config/playbackPreferences.ts";
import {
  dispatchLocalSubtitleDrop,
  prepareLocalMediaPlayback,
  splitLocalFiles,
} from "./utils/localMedia.ts";
import {
  getLastAppMode,
  resolveAppModeForPath,
  setLastAppMode,
  shouldShowBigPictureBrandOnStartup,
} from "./utils/appMode.ts";
import { showBigPictureBrand } from "./utils/bigPictureTransition.ts";
import { recordRouteVisit, resetEntrancePlayed } from "./utils/homeEntrance.ts";
import { animatePageTransitionCurtain, restorePageTransition } from "./utils/pageTransition.ts";
import { prefersReducedMotion } from "./utils/motion.ts";
import { pageCacheKey } from "./utils/pageCacheKey.ts";

const PROCESSED_OAUTH_CALLBACKS_KEY = "aetherio-processed-oauth-callbacks-v1";
const processedOAuthCallbacks = new Set<string>();

const HomePage = lazy(() => import("./pages/Home"));
const LibraryPage = lazy(() => import("./pages/Library"));
const AddonsPage = lazy(() => import("./pages/Addons"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const DetailPage = lazy(() => import("./pages/Detail"));
const DetailSectionPage = lazy(() => import("./pages/Detail/DetailSectionPage"));
const CatalogPage = lazy(() => import("./pages/Catalog"));
const EpisodeRouteRedirect = lazy(() => import("./pages/Episodie/EpisodeRouteRedirect"));
const PlayerPage = lazy(() => import("./pages/Player"));
const PersonPage = lazy(() => import("./pages/Person"));
const EntityPage = lazy(() => import("./pages/Entity"));
const SearchPage = lazy(() => import("./pages/Search"));
const GenreListingPage = lazy(() => import("./pages/GenreListing"));
const StreamingPlatformPage = lazy(() => import("./pages/StreamingPlatform"));
const BigPicturePage = lazy(() => import("./pages/BigPicture"));
const QuickStart = lazy(() => import("./pages/QuickStart"));
const ProfileSelection = lazy(() => import("./pages/ProfileSelection"));

const MAX_CACHED_PAGES = 16;
const TRANSIENT_PAGE_PATHS = new Set(["/", "/episode", "/streams", "/player", "/big-picture"]);
type StartupBrandState = "idle" | "pending" | "visible";

/**
 * Ruta con la que arrancó esta carga del documento. Se lee una sola vez, al
 * importar el módulo, porque `/` no aguanta: el propio router lo reescribe a
 * `/home` en cuanto monta `PageRoutes`, y para entonces la pantalla de carga
 * sigue arriba. Preguntarle a `location.pathname` más tarde ya no distingue un
 * arranque en frío de un F5 sobre Home.
 */
const BOOT_PATH = typeof window === "undefined" ? "/" : window.location.pathname;

export default function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [profileRevision, setProfileRevision] = useState(0);
  const hasProfile = hasActiveLocalProfile();
  const isCreatingProfile = location.pathname === "/quick-start/profile";
  // ¿Este arranque tiene que pasar por el selector de perfiles? Solo si la carga
  // empieza en la raíz —el icono del sistema y una ventana nueva abren ahí— o
  // si un cambio de identidad reinicia el arranque. Un F5 o un deep link llegan
  // con una ruta propia y se recargan donde están, como una recarga.
  const [needsProfileGate, setNeedsProfileGate] = useState(() => BOOT_PATH === "/");
  const returnToBigPicture = new URLSearchParams(location.search).get("from") === "big-picture";
  const profileSelectionPath = getLastAppMode() === "big-picture"
    ? "/profiles?from=big-picture"
    : "/profiles";
  const [account, setAccount] = useState<AetherioUser | null | undefined>(() => getStoredAccount() ?? undefined);
  const [authRestored, setAuthRestored] = useState(false);
  const [localMode, setLocalMode] = useState(() => isLocalModeEnabled());
  const [authError, setAuthError] = useState("");
  const [startupReady, setStartupReady] = useState(false);
  const [startupStatus, setStartupStatus] = useState("Restaurando tu sesión");
  const [startupBrandState, setStartupBrandState] = useState<StartupBrandState>(() =>
    shouldShowBigPictureBrandOnStartup(location.pathname, getLastAppMode(), hasProfile)
      ? "pending"
      : "idle",
  );
  const addons = useAddonStore(s => s.addons);
  const enabledAddons = useMemo(() => addons.filter(addon => addon.enabled), [addons]);

  useFullscreen();

  const handleStartupComplete = useCallback(() => {
    setStartupBrandState(current => current === "pending" ? "visible" : current);
  }, []);

  useEffect(() => {
    if (startupBrandState !== "pending") return;
    if (location.pathname === "/" || location.pathname === "/profiles") return;
    setStartupBrandState("idle");
  }, [location.pathname, startupBrandState]);

  useLayoutEffect(() => {
    if (startupBrandState !== "visible") return;
    return showBigPictureBrand(() => setStartupBrandState("idle"));
  }, [startupBrandState]);

  // Recuerda de qué modo salió el usuario: cada navegación a una ruta
  // estable consolida el modo (las transitorias como /, /profiles o
  // /quick-start no sobrescriben).
  useEffect(() => {
    const mode = resolveAppModeForPath(location.pathname);
    if (mode) setLastAppMode(mode);
    recordRouteVisit(location.pathname);
  }, [location.pathname]);

  // El servidor de posters viaja dentro de la app, asi que se levanta al abrir
  // y no cuando se llega a Home: si arrancara desde el warmup de catálogos,
  // dejaria de correr mientras la app esta en el selector de perfiles, que es
  // justo la primera pantalla que ve la persona. El cache en disco se pone
  // despues, cuando ya se sabe el puerto.
  useEffect(() => {
    void ensurePosterServer(getSpatialPosterSettings().instanceUrl).then(async () => {
      const cacheUrl = await getPosterCacheUrl();
      if (cacheUrl) setPosterCacheUrl(cacheUrl);
    });
  }, []);

  // Al arrancar desde la raíz, restaura el último modo pasando primero por el
  // selector de perfiles. Los deep links navegan fuera de "/" antes de que el
  // startup esté listo, así que una intención explícita siempre gana.
  // `prepare()` ya lleva a `/profiles` en su camino normal; este efecto cubre
  // los caminos donde `prepare()` sale antes (auth, primer perfil, quick start).
  useEffect(() => {
    if (!startupReady || !hasProfile) return;
    if (location.pathname !== "/") return;
    navigate(profileSelectionPath, { replace: true });
  }, [startupReady, hasProfile, location.pathname, navigate, profileSelectionPath]);

  useEffect(() => {
    let disposed = false;
    void restoreAccountSession()
      .then(user => {
        if (!disposed) setAccount(current => current && !user ? current : user);
      })
      .finally(() => {
        if (!disposed) setAuthRestored(true);
      });
    const refresh = () => {
      const nextAccount = getStoredAccount();
      const nextLocalMode = isLocalModeEnabled();
      setAccount(nextAccount);
      setLocalMode(nextLocalMode);
      setStartupStatus(nextAccount || nextLocalMode ? "Preparando tu perfil" : "Listo para comenzar");
      // Cambiar de identidad reinicia el arranque, así que vuelve a tocar pasar
      // por el selector: el perfil activo era de la cuenta anterior.
      setNeedsProfileGate(true);
      setStartupReady(false);
    };
    window.addEventListener(AETHERIO_AUTH_CHANGED_EVENT, refresh);
    return () => {
      disposed = true;
      window.removeEventListener(AETHERIO_AUTH_CHANGED_EVENT, refresh);
    };
  }, []);

  useEffect(() => {
    if (!authRestored || startupReady) return;
    if (!account && !localMode) {
      setStartupStatus("Listo para comenzar");
      setStartupReady(true);
      return;
    }

    let disposed = false;
    const prepare = async () => {
      setStartupStatus("Preparando tu perfil");
      let currentProfiles = getLocalProfiles();
      if (currentProfiles.length === 0) {
        if (isCreatingProfile) {
          setStartupStatus("Todo listo");
          setStartupReady(true);
          return;
        }
        if (account) {
          setStartupStatus("Todo listo");
          setStartupReady(true);
          navigate("/quick-start/profile", { replace: true });
          return;
        }
        await createLocalProfile(
          { name: "Usuario" },
          { makeActive: true, adoptCurrentData: true },
        );
        currentProfiles = getLocalProfiles();
        if (!disposed) setProfileRevision(value => value + 1);
      } else if (!hasActiveLocalProfile()) {
        setActiveProfile(currentProfiles[0].id);
        if (!disposed) setProfileRevision(value => value + 1);
      }

      // Nunca bloquear la apertura por los catálogos o los pósteres. El Home
      // reutiliza primero su snapshot persistido y `prefetchHomeData` (más
      // abajo) actualiza catálogo, héroe y arte en segundo plano.
      if (!disposed) {
        setStartupStatus("Todo listo");
        setStartupReady(true);
        // Al arrancar desde la raíz se restaura el último modo pasando por el
        // selector. En una recarga no se patea al usuario de la página que ya
        // tenía. Crear un perfil en /quick-start/profile vuelve a disparar este
        // arranque (cambia el perfil activo), pero ese flujo tiene su propia
        // salida: su CTA de bienvenida. No se le roba la navegacion.
        if (needsProfileGate && !isCreatingProfile) navigate(profileSelectionPath, { replace: true });
      }
    };

    void prepare().catch(() => {
      if (!disposed) {
        setStartupStatus("Abriendo Aetherio");
        setStartupReady(true);
      }
    });
    return () => {
      disposed = true;
    };
  }, [account, authRestored, enabledAddons, isCreatingProfile, localMode, navigate, needsProfileGate, profileRevision, queryClient, startupReady]);

  useEffect(() => {
    if (!account) return;
    void syncAniListLibrary().catch(() => undefined);
    return initializeAniListProgressSync();
  }, [account]);

  useEffect(() => {
    const check = () => {
      if (getPlaybackPreferences().enableDiscordRichPresence) {
        void startDiscordRichPresence();
      } else {
        void stopDiscordRichPresence();
      }
    };
    check();
    window.addEventListener(PLAYBACK_PREFERENCES_CHANGED_EVENT, check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener(PLAYBACK_PREFERENCES_CHANGED_EVENT, check);
      window.removeEventListener("storage", check);
    };
  }, []);

  useEffect(() => {
    if (!hasProfile || !enabledAddons.length) return;
    const homePrefs = getHomePreferences();
    prefetchHomeData(queryClient, enabledAddons, homePrefs.contentOrientation, homePrefs.bothPreference);
  }, [enabledAddons, hasProfile, queryClient]);

  // Respaldo en Google Drive: registra listeners y, si hay sesión, baja el
  // remoto. Los cambios de perfil/cuenta re-disparan el pull vía su evento.
  useEffect(() => {
    initGoogleDriveSync();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const handleUrls = async (urls: string[] | null | undefined) => {
      for (const url of urls ?? []) {
        const partyInvite = parsePartyJoinDeepLink(url);
        if (partyInvite) {
          // Link de invitación a una sala: se guarda y Home lo consume
          // (auto-unirse + directo al reproductor con la fuente del grupo).
          writePendingPartyJoin(partyInvite);
          if (!disposed) navigate("/home");
          continue;
        }
        if (isOpenUrl(url)) {
          // Deep links de los botones del RPC de Discord: aetherio://open/detail/{type}/{id}
          navigate(buildOpenPath(url) ?? "/home");
          continue;
        }
        if (isOAuthCallbackUrl(url)) {
          const oauthKey = getOAuthCallbackKey(url);
          if (oauthKey && hasProcessedOAuthCallback(oauthKey)) continue;
          if (oauthKey) markProcessedOAuthCallback(oauthKey);
          try {
            const user = await completeOAuthAuthorization(url);
            if (!disposed) {
              setAccount(user);
              setLocalMode(false);
              setAuthError("");
              setNeedsProfileGate(true);
              setStartupReady(false);
              navigate(hasActiveLocalProfile() ? "/" : "/quick-start/profile", { replace: true });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "No se pudo iniciar sesión.";
            if (!disposed) {
              setAuthError(message);
              dispatchAuthError(message);
            }
          }
          continue;
        }
        if (isGoogleDriveCallbackUrl(url)) {
          try {
            const result = await completeGoogleDriveAuthorization(url);
            if (result.status === "ignored") continue;
            if (!disposed) navigate("/settings?tab=gdrive", { replace: true });
          } catch (error) {
            const message = error instanceof Error ? error.message : "No se pudo completar la conexion con Google Drive.";
            console.warn("[AETHERIO:GDRIVE] callback failed", { error: message });
            if (!disposed) navigate("/settings?tab=gdrive", { replace: true });
          }
          continue;
        }
      }
    };

    void getCurrentDeepLinks()
      .then(urls => handleUrls(urls))
      .catch(error => console.warn("[AETHERIO:DEEPLINK] initial deep link read failed", String(error)));

    void listenOpenUrls(urls => {
      void handleUrls(urls);
    })
      .then(nextUnlisten => {
        if (disposed) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch(error => console.warn("[AETHERIO:DEEPLINK] deep link listener failed", String(error)));

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [navigate]);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const handleFiles = (paths: string[]) => {
      if (disposed || !paths.length) return;
      const { mediaPath, subtitlePaths } = splitLocalFiles(paths);
      if (mediaPath) {
        navigate(prepareLocalMediaPlayback(mediaPath, subtitlePaths), { replace: false });
        return;
      }
      if (subtitlePaths.length) dispatchLocalSubtitleDrop(subtitlePaths);
    };

    void takePendingOpenFiles()
      .then(handleFiles)
      .catch(error => console.warn("[AETHERIO:LOCAL] No se pudieron leer los archivos iniciales.", error));
    void listenOpenFiles(handleFiles).then(unlisten => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });
    void listenWindowFileDrops(handleFiles).then(unlisten => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });

    const preventBrowserDrop = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", preventBrowserDrop);
    window.addEventListener("drop", preventBrowserDrop);
    return () => {
      disposed = true;
      cleanups.forEach(cleanup => cleanup());
      window.removeEventListener("dragover", preventBrowserDrop);
      window.removeEventListener("drop", preventBrowserDrop);
    };
  }, [navigate]);

  const withStartup = (content: ReactNode) => (
    <StartupExperience
      ready={startupReady}
      status={startupStatus}
      onComplete={handleStartupComplete}
    >
      {content}
    </StartupExperience>
  );

  if (account === undefined && !authRestored) {
    return withStartup(<RouteFallback />);
  }

  if (!account && !localMode) {
    return withStartup(
      <AuthPage
        initialError={authError}
        onAuthenticated={user => {
          setAccount(user);
          setLocalMode(false);
          setAuthError("");
          setNeedsProfileGate(true);
          setStartupReady(false);
        }}
        onContinueLocal={() => {
          setAccount(null);
          setLocalMode(true);
          setAuthError("");
          setNeedsProfileGate(true);
          setStartupReady(false);
        }}
      />,
    );
  }

  if (isCreatingProfile) {
    return withStartup(
      <PartyProvider>
        {/* El flujo de creación es una page completa con teclado en pantalla, asi
            que necesita el polling del mando (useGamepad, que vive en
            GamepadWakeListener) y el motor espacial global: sin esto no hay
            flechas, ni A, ni B, y el teclado en pantalla no se puede usar. */}
        <GamepadWakeListener />
        <Suspense fallback={<RouteFallback />}>
          <QuickStart
            installedAddons={addons.length}
            activeProfile={null}
            defaultName={account?.displayName?.trim() ?? ""}
            useFreshDefaults
            profileOnly
            onComplete={() => {
              setProfileRevision(value => value + 1);
              const restoreBigPicture = returnToBigPicture || getLastAppMode() === "big-picture";
              navigate(restoreBigPicture ? "/profiles?from=big-picture" : "/profiles", { replace: true });
            }}
            onCancel={() => {
              // B en el nombre: se vuelve al selector sin crear nada y con el
              // foco en la burbuja de "Agregar", que es de donde se vino.
              // Solo si ya hay algún perfil: en una instalación nueva el
              // selector está vacío y no hay a qué volver, así que B no hace
              // nada en vez de dejar en una pantalla sin nada que hacer.
              if (getLocalProfiles().length === 0) return;
              navigate("/profiles", { replace: true, state: { focusAdd: true } });
            }}
          />
        </Suspense>
      </PartyProvider>,
    );
  }

  if (!hasProfile) {
    return withStartup(<RouteFallback />);
  }

  if (location.pathname === "/profiles") {
    return withStartup(
      <PartyProvider>
        <GamepadWakeListener />
        <Suspense fallback={<RouteFallback />}>
          <ProfileSelection
            onProfileSelected={async (_profile, onProgress) => {
              onProgress(8, "Preparando tu perfil…");
              resetEntrancePlayed();
              setProfileRevision(value => value + 1);
              onProgress(20, "Cargando fuentes…");
              const nextEnabledAddons = reloadAddonsForActiveProfile().filter(addon => addon.enabled);
              onProgress(32, "Restaurando tu biblioteca…");
              await rehydrateHomeCacheForActiveProfile();
              queryClient.removeQueries({ queryKey: ["home"] });
              const nextHomePrefs = getHomePreferences();
              // Al perfil se entra con su snapshot local; el prewarm se ejecuta
              // en segundo plano para que ni catálogo ni renders de pósteres
              // bloqueen la navegación a Home.
              onProgress(72, "Abriendo tu biblioteca…");
              void warmHomeStartup(
                queryClient,
                nextEnabledAddons,
                nextHomePrefs.contentOrientation,
                nextHomePrefs.bothPreference,
              ).catch(error => console.warn("[startup] No se pudo precargar Home en segundo plano:", error));
              onProgress(100, "Listo");
            }}
          />
        </Suspense>
      </PartyProvider>,
    );
  }

  // "/" aterriza aquí. Tiene que caer donde el usuario lo dejó, no siempre en
  // Home: `/home` es una ruta estable que consolida "normal", así que aterrizar
  // ahí borraba el Big Picture del perfil antes de que nadie llegara a elegir.
  const defaultRoute = getLastAppMode() === "big-picture" ? "/big-picture" : "/home";

  const isBigPicture = location.pathname.startsWith("/big-picture");

  if (isBigPicture) {
    return withStartup(
      <PartyProvider>
        <GamepadWakeListener />
        <Suspense fallback={<RouteFallback />}>
          <BigPicturePage />
        </Suspense>
      </PartyProvider>,
    );
  }

  return withStartup(
    <PartyProvider>
      <GamepadWakeListener />
      <AppShell>
        {location.pathname !== "/home" ? (
          <PageTransitionCurtain key={`curtain-${location.key}`} />
        ) : null}
        <CachedPageRoutes key={profileRevision} location={location} defaultRoute={defaultRoute} />
      </AppShell>
    </PartyProvider>,
  );
}

function PageTransitionCurtain() {
  const curtainRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const curtain = curtainRef.current;
    if (!curtain) return;
    return animatePageTransitionCurtain(curtain, prefersReducedMotion());
  }, []);

  return <div ref={curtainRef} className="aetherio-page-curtain" aria-hidden="true" style={{ opacity: 0 }} />;
}

function CachedPageRoutes({
  location,
  defaultRoute,
}: {
  location: Location;
  defaultRoute: string;
}) {
  const pagesRef = useRef(new Map<string, Location>());
  const currentKey = makePageCacheKey(location);
  const cacheCurrentPage = !TRANSIENT_PAGE_PATHS.has(location.pathname);

  if (cacheCurrentPage) {
    pagesRef.current.delete(currentKey);
    pagesRef.current.set(currentKey, location);

    while (pagesRef.current.size > MAX_CACHED_PAGES) {
      const oldestKey = pagesRef.current.keys().next().value;
      if (typeof oldestKey !== "string") break;
      pagesRef.current.delete(oldestKey);
    }
  }

  return (
    <>
      {[...pagesRef.current.entries()].map(([cacheKey, cachedLocation]) => {
        const active = cacheCurrentPage && cacheKey === currentKey;
        return (
          <CachedPageActivity
            key={cacheKey}
            cacheKey={cacheKey}
            active={active}
            location={cachedLocation}
            defaultRoute={defaultRoute}
          />
        );
      })}

      {!cacheCurrentPage && (
        <div key={location.key} className={`min-h-full ${location.pathname === "/home" ? "home-page-route-enter" : "aetherio-page-enter"}`}>
          <PageRoutes location={location} defaultRoute={defaultRoute} />
        </div>
      )}
    </>
  );
}

function CachedPageActivity({
  cacheKey,
  active,
  location,
  defaultRoute,
}: {
  cacheKey: string;
  active: boolean;
  location: Location;
  defaultRoute: string;
}) {
  const pageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!active) return;
    // Activity conserva el DOM y GSAP puede dejar opacity/transform inline si
    // la navegación interrumpe la entrada. Al reactivar la ruta, mata ese tween
    // y devuelve el wrapper a su estado visual base.
    restorePageTransition(pageRef.current);
  }, [active]);

  return (
    <Activity mode={active ? "visible" : "hidden"} name={`page:${cacheKey}`}>
      <div
        ref={pageRef}
        className={`min-h-full ${location.pathname === "/home" ? "home-page-route-enter" : "aetherio-page-enter"}`}
        style={active ? { opacity: 1, transform: "none" } : undefined}
      >
        <PageRoutes location={location} defaultRoute={defaultRoute} />
      </div>
    </Activity>
  );
}

function PageRoutes({ location, defaultRoute }: { location: Location; defaultRoute: string }) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes location={location}>
        <Route path="/"                  element={<Navigate to={defaultRoute} replace />} />
        <Route path="/home"              element={<HomePage />} />
        <Route path="/library"           element={<LibraryPage />} />
        <Route path="/channels"          element={<Navigate to="/home" replace />} />
        <Route path="/downloads"         element={<Navigate to="/library?tab=downloads" replace />} />
        <Route path="/addons"            element={<AddonsPage />} />
        <Route path="/settings"          element={<SettingsPage />} />
        <Route path="/catalog"           element={<CatalogPage />} />
        <Route path="/detail/:type/:id"  element={<DetailPage />} />
        <Route path="/detail/:type/:id/:section" element={<DetailSectionPage />} />
        <Route path="/episode"           element={<EpisodeRouteRedirect />} />
        <Route path="/streams"           element={<EpisodeRouteRedirect />} />
        <Route path="/player"            element={<PlayerPage />} />
        <Route path="/person/:id"        element={<PersonPage />} />
        <Route path="/entity/:kind/:id"  element={<EntityPage />} />
        <Route path="/search"            element={<SearchPage />} />
        <Route path="/genre"             element={<GenreListingPage />} />
        <Route path="/platform/:platformId" element={<StreamingPlatformPage />} />
      </Routes>
    </Suspense>
  );
}

function makePageCacheKey(location: Location) {
  // Ajustes y Biblioteca usan `?tab=` como estado local; cambiar de pestaña no
  // debe crear otra instancia cacheada de la página.
  return pageCacheKey(location.pathname, location.search);
}

function RouteFallback() {
  return <div style={{ minHeight: "100vh" }} />;
}

/**
 * Deep links de los botones del RPC de Discord ("Más detalles" /
 * "Ver en Aetherio"): aetherio://open/detail/{type}/{id} o aetherio://open.
 */
function isOpenUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "aetherio:" && url.hostname === "open";
  } catch {
    return false;
  }
}

function buildOpenPath(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "aetherio:" || url.hostname !== "open") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "big-picture") {
      return "/big-picture";
    }
    if (segments[0] === "detail" && segments[1] && segments[2]) {
      return `/detail/${encodeURIComponent(segments[1])}/${encodeURIComponent(segments.slice(2).join("/"))}`;
    }
    return "/home";
  } catch {
    return null;
  }
}

function getOAuthCallbackKey(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol === "aetherio:" &&
      url.hostname === "auth" &&
      url.pathname.replace(/\/$/, "") === "/callback"
    ) {
      return url.searchParams.get("code")
        ?? url.searchParams.get("state")
        ?? url.hash.slice(0, 64);
    }
  } catch {
    return null;
  }
  return null;
}

function hasProcessedOAuthCallback(callbackKey: string) {
  if (processedOAuthCallbacks.has(callbackKey)) return true;
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROCESSED_OAUTH_CALLBACKS_KEY) || "[]");
    if (Array.isArray(stored) && stored.includes(callbackKey)) {
      processedOAuthCallbacks.add(callbackKey);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function markProcessedOAuthCallback(callbackKey: string) {
  processedOAuthCallbacks.add(callbackKey);
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROCESSED_OAUTH_CALLBACKS_KEY) || "[]");
    const next = Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    sessionStorage.setItem(PROCESSED_OAUTH_CALLBACKS_KEY, JSON.stringify([callbackKey, ...next.filter(value => value !== callbackKey)].slice(0, 12)));
  } catch {
    // Session storage is best-effort; the in-memory set still prevents duplicate callbacks in this run.
  }
}

