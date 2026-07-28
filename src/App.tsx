import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reloadAddonsForActiveProfile, useAddonStore } from "./store/addonStore.ts";
import { rehydrateHomeCacheForActiveProfile } from "./store/cacheStore.ts";
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
import { completeTraktAuthorization, TRAKT_AUTH_CHANGED_EVENT, type TraktAuthEventDetail } from "./trakt";
import { getCurrentDeepLinks, listenOpenUrls } from "./runtime/platform.ts";
import AuthPage from "./pages/AuthPage.tsx";
import StartupExperience from "./components/startup/StartupExperience.tsx";
import {
  AETHERIO_AUTH_CHANGED_EVENT,
  completeOAuthAuthorization,
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

const PROCESSED_TRAKT_CALLBACKS_KEY = "aetherio-processed-trakt-callbacks-v1";
const processedTraktCallbacks = new Set<string>();

const HomePage = lazy(() => import("./pages/Home"));
const LibraryPage = lazy(() => import("./pages/Library"));
const AddonsPage = lazy(() => import("./pages/Addons"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const DetailPage = lazy(() => import("./pages/Detail"));
const DetailSectionPage = lazy(() => import("./pages/Detail/DetailSectionPage"));
const CatalogPage = lazy(() => import("./pages/Catalog"));
const EpisodiePage = lazy(() => import("./pages/Episodie"));
const PlayerPage = lazy(() => import("./pages/Player"));
const PersonPage = lazy(() => import("./pages/Person"));
const EntityPage = lazy(() => import("./pages/Entity"));
const SearchPage = lazy(() => import("./pages/Search"));
const GenreListingPage = lazy(() => import("./pages/GenreListing"));
const QuickStart = lazy(() => import("./pages/QuickStart"));
const ProfileSelection = lazy(() => import("./pages/ProfileSelection"));

export default function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [profileRevision, setProfileRevision] = useState(0);
  const hasProfile = hasActiveLocalProfile();
  const isCreatingProfile = location.pathname === "/quick-start/profile";
  const [account, setAccount] = useState<AetherioUser | null | undefined>(() => getStoredAccount() ?? undefined);
  const [authRestored, setAuthRestored] = useState(false);
  const [localMode, setLocalMode] = useState(() => isLocalModeEnabled());
  const [authError, setAuthError] = useState("");
  const [startupReady, setStartupReady] = useState(false);
  const [startupStatus, setStartupStatus] = useState("Restaurando tu sesión");
  const addons = useAddonStore(s => s.addons);
  const enabledAddons = useMemo(() => addons.filter(addon => addon.enabled), [addons]);

  useFullscreen();

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
      setAccount(getStoredAccount());
      setLocalMode(isLocalModeEnabled());
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
        await createLocalProfile(
          { name: account?.displayName?.trim() || "Usuario" },
          { makeActive: true, adoptCurrentData: true },
        );
        currentProfiles = getLocalProfiles();
        if (!disposed) setProfileRevision(value => value + 1);
      } else if (!hasActiveLocalProfile()) {
        setActiveProfile(currentProfiles[0].id);
        if (!disposed) setProfileRevision(value => value + 1);
      }

      setStartupStatus("Cargando tu biblioteca");
      await warmHomeStartup(queryClient, enabledAddons, getHomePreferences().contentOrientation, () => {
        if (!disposed) setStartupStatus("Preparando imágenes");
      });
      if (!disposed) {
        if (currentProfiles.length > 1) {
          navigate("/profiles", { replace: true });
        }
        setStartupStatus("Todo listo");
        setStartupReady(true);
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
  }, [account, authRestored, enabledAddons, localMode, navigate, profileRevision, queryClient, startupReady]);

  useEffect(() => {
    if (!account) return;
    void syncAniListLibrary().catch(() => undefined);
    return initializeAniListProgressSync();
  }, [account]);

  useEffect(() => {
    if (!hasProfile || !enabledAddons.length) return;
    prefetchHomeData(queryClient, enabledAddons);
  }, [enabledAddons, hasProfile, queryClient]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const emitAuthError = (message: string) => {
      window.dispatchEvent(new CustomEvent<TraktAuthEventDetail>(TRAKT_AUTH_CHANGED_EVENT, {
        detail: { kind: "error", message },
      }));
    };

    const handleUrls = async (urls: string[] | null | undefined) => {
      for (const url of urls ?? []) {
        if (isOAuthCallbackUrl(url)) {
          try {
            const user = await completeOAuthAuthorization(url);
            if (!disposed) {
              setAccount(user);
              setLocalMode(false);
              setAuthError("");
              navigate("/", { replace: true });
            }
          } catch (error) {
            if (!disposed) {
              setAuthError(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
            }
          }
          continue;
        }
        const callbackKey = getTraktCallbackKey(url);
        if (callbackKey && hasProcessedTraktCallback(callbackKey)) continue;
        try {
          const result = await completeTraktAuthorization(url);
          if (callbackKey) markTraktCallbackProcessed(callbackKey);
          if (result.status === "ignored") continue;
          if (!disposed) navigate("/settings?tab=trakt", { replace: true });
        } catch (error) {
          const message = describeTraktCallbackError(error);
          console.warn("[AETHERIO:TRAKT] callback failed", { error: message });
          emitAuthError(message);
          if (!disposed) navigate("/settings?tab=trakt", { replace: true });
        }
      }
    };

    void getCurrentDeepLinks()
      .then(urls => handleUrls(urls))
      .catch(error => console.warn("[AETHERIO:TRAKT] initial deep link read failed", String(error)));

    void listenOpenUrls(urls => {
      void handleUrls(urls);
    })
      .then(nextUnlisten => {
        if (disposed) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch(error => console.warn("[AETHERIO:TRAKT] deep link listener failed", String(error)));

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [navigate]);

  const withStartup = (content: ReactNode) => (
    <StartupExperience ready={startupReady} status={startupStatus}>
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
        }}
        onContinueLocal={() => {
          setAccount(null);
          setLocalMode(true);
          setAuthError("");
        }}
      />,
    );
  }

  if (isCreatingProfile) {
    return withStartup(
      <Suspense fallback={<RouteFallback />}>
        <QuickStart
          installedAddons={addons.length}
          activeProfile={null}
          useFreshDefaults
          profileOnly
          onComplete={destination => {
            setProfileRevision(value => value + 1);
            navigate(destination, { replace: true });
          }}
        />
      </Suspense>,
    );
  }

  if (!hasProfile) {
    return withStartup(<RouteFallback />);
  }

  if (location.pathname === "/profiles") {
    return withStartup(
      <Suspense fallback={<RouteFallback />}>
        <ProfileSelection
          onProfileSelected={async () => {
            setProfileRevision(value => value + 1);
            const nextEnabledAddons = reloadAddonsForActiveProfile().filter(addon => addon.enabled);
            await rehydrateHomeCacheForActiveProfile();
            queryClient.removeQueries({ queryKey: ["home"] });
            await warmHomeStartup(
              queryClient,
              nextEnabledAddons,
              getHomePreferences().contentOrientation,
            );
          }}
        />
      </Suspense>,
    );
  }

  const defaultRoute = "/home";

  return withStartup(
    <AppShell>
        <div key={`curtain-${location.key}`} className="aetherio-page-curtain" aria-hidden="true" style={{ opacity: 0 }} />
        <div key={location.key} className="min-h-full aetherio-page-enter">
          <Suspense fallback={<RouteFallback />}>
            <Routes location={location}>
              <Route path="/"                  element={<Navigate to={defaultRoute} replace />} />
              <Route path="/home"              element={<HomePage />} />
              <Route path="/library"           element={<LibraryPage />} />
              <Route path="/addons"            element={<AddonsPage />} />
              <Route path="/settings"          element={<SettingsPage />} />
              <Route path="/catalog"           element={<CatalogPage />} />
              <Route path="/detail/:type/:id"  element={<DetailPage />} />
              <Route path="/detail/:type/:id/:section" element={<DetailSectionPage />} />
              <Route path="/episode"           element={<EpisodiePage />} />
              <Route path="/streams"           element={<EpisodiePage />} />
              <Route path="/player"            element={<PlayerPage />} />
              <Route path="/person/:id"        element={<PersonPage />} />
              <Route path="/entity/:kind/:id"   element={<EntityPage />} />
              <Route path="/search"            element={<SearchPage />} />
              <Route path="/genre"              element={<GenreListingPage />} />
            </Routes>
          </Suspense>
        </div>
      </AppShell>,
  );
}

function RouteFallback() {
  return <div style={{ minHeight: "100vh", background: "#1f1f1f" }} />;
}

function getTraktCallbackKey(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol === "aetherio:" &&
      url.hostname === "trakt" &&
      url.pathname.replace(/\/$/, "") === "/callback"
    ) {
      return rawUrl;
    }
  } catch {
    return null;
  }
  return null;
}

function hasProcessedTraktCallback(callbackKey: string) {
  if (processedTraktCallbacks.has(callbackKey)) return true;
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROCESSED_TRAKT_CALLBACKS_KEY) || "[]");
    if (Array.isArray(stored) && stored.includes(callbackKey)) {
      processedTraktCallbacks.add(callbackKey);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function markTraktCallbackProcessed(callbackKey: string) {
  processedTraktCallbacks.add(callbackKey);
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROCESSED_TRAKT_CALLBACKS_KEY) || "[]");
    const next = Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    sessionStorage.setItem(PROCESSED_TRAKT_CALLBACKS_KEY, JSON.stringify([callbackKey, ...next.filter(value => value !== callbackKey)].slice(0, 12)));
  } catch {
    // Session storage is best-effort; the in-memory set still prevents duplicate callbacks in this run.
  }
}

function describeTraktCallbackError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "No se pudo completar la conexion con Trakt.";
}
