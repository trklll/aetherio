import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAddonStore } from "./store/addonStore";
import AppShell from "./components/layout/AppShell";
import { hasActiveLocalProfile } from "./utils/localProfiles";
import { prefetchHomeData } from "./hooks/useCatalogs";

const HomePage = lazy(() => import("./pages/Home"));
const LibraryPage = lazy(() => import("./pages/Library"));
const AddonsPage = lazy(() => import("./pages/Addons"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const DetailPage = lazy(() => import("./pages/Detail"));
const StreamPicker = lazy(() => import("./pages/Detail/StreamPicker"));
const PlayerPage = lazy(() => import("./pages/Player"));
const PersonPage = lazy(() => import("./pages/Person"));
const SearchPage = lazy(() => import("./pages/Search"));
const ProfileOnboarding = lazy(() => import("./pages/ProfileOnboarding"));

export default function App() {
  const queryClient = useQueryClient();
  const hasProfile = hasActiveLocalProfile();
  const addons = useAddonStore(s => s.addons);
  const enabledAddons = useMemo(() => addons.filter(addon => addon.enabled), [addons]);

  useEffect(() => {
    if (!hasProfile || !enabledAddons.length) return;
    prefetchHomeData(queryClient, enabledAddons);
  }, [enabledAddons, hasProfile, queryClient]);

  if (!hasProfile) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <ProfileOnboarding />
      </Suspense>
    );
  }
  const defaultRoute = addons.length === 0 ? "/addons" : "/home";

  return (
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/"                  element={<Navigate to={defaultRoute} replace />} />
          <Route path="/home"              element={<HomePage />} />
          <Route path="/library"           element={<LibraryPage />} />
          <Route path="/addons"            element={<AddonsPage />} />
          <Route path="/settings"          element={<SettingsPage />} />
          <Route path="/detail/:type/:id"  element={<DetailPage />} />
          <Route path="/streams"           element={<StreamPicker />} />
          <Route path="/player"            element={<PlayerPage />} />
          <Route path="/person/:id"        element={<PersonPage />} />
          <Route path="/search"            element={<SearchPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function RouteFallback() {
  return <div style={{ minHeight: "100vh", background: "#1f1f1f" }} />;
}
