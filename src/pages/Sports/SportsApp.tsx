import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import LoadingState from "../../components/ui/LoadingState";

const SportsHome = lazy(() => import("../BigPicture/BigPictureSportsHome"));
const SportsTeamPage = lazy(() => import("../BigPicture/SportsTeamPage"));
const SportsMyTeamsPage = lazy(() => import("./SportsMyTeamsPage"));
const SportsMatchPage = lazy(() => import("./SportsMatchPage"));
const SportsProfileSettings = lazy(() => import("../BigPicture/BigPictureSettings"));

/** Sports owns its routes; data, playback and display mode stay shared. */
export default function SportsApp() {
  return (
    <Suspense fallback={<LoadingState label="Cargando Deportes" />}>
      <Routes>
        <Route path="/big-picture/sports" element={<SportsHome />} />
        <Route path="/big-picture/sports/team/:teamId" element={<SportsTeamPage />} />
        <Route path="/big-picture/sports/teams" element={<SportsMyTeamsPage />} />
        <Route path="/big-picture/sports/match/:matchId" element={<SportsMatchPage />} />
        <Route path="/big-picture/sports/settings" element={<SportsProfileSettings />} />
        <Route path="*" element={<Navigate to="/big-picture/sports" replace />} />
      </Routes>
    </Suspense>
  );
}
