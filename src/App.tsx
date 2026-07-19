import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAddonStore } from "./store/addonStore";
import AppShell from "./components/layout/AppShell";
import { getActiveProfile, hasActiveLocalProfile } from "./utils/localProfiles";
import { prefetchHomeData } from "./hooks/useCatalogs";
import { completeTraktAuthorization, TRAKT_AUTH_CHANGED_EVENT, type TraktAuthEventDetail } from "./trakt";
import { getCurrentDeepLinks, listenOpenUrls } from "./runtime/platform";
import { hasCompletedQuickStart } from "./config/quickStart";

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
const QuickStart = lazy(() => import("./pages/QuickStart"));

export default function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const hasProfile = hasActiveLocalProfile();
  const activeProfile = getActiveProfile();
  const isCreatingProfile = location.pathname === "/quick-start/profile";
  const [quickStartCompleted, setQuickStartCompleted] = useState(() => hasCompletedQuickStart());
  const addons = useAddonStore(s => s.addons);
  const enabledAddons = useMemo(() => addons.filter(addon => addon.enabled), [addons]);

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

  if (isCreatingProfile || !hasProfile || !quickStartCompleted) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <QuickStart
          installedAddons={addons.length}
          activeProfile={isCreatingProfile ? null : activeProfile}
          useFreshDefaults={isCreatingProfile}
          onComplete={destination => {
            setQuickStartCompleted(true);
            navigate(destination, { replace: true });
          }}
        />
      </Suspense>
    );
  }
  const defaultRoute = addons.length === 0 ? "/addons" : "/home";

  return (
    <AppShell>
      <div key={`curtain-${location.key}`} className="aetherio-page-curtain" aria-hidden="true" />
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
          </Routes>
        </Suspense>
      </div>
    </AppShell>
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
