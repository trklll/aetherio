import { Suspense, lazy } from "react";
import { Navigate, useLocation } from "react-router-dom";
import LoadingState from "../../components/ui/LoadingState";
import { buildDetailPath } from "../../utils/bigPictureDetail";
import type { DetailEpisodeRequest } from "../Detail/index.tsx";

const EpisodiePage = lazy(() => import("./index.tsx"));

function readEpisodeRequest(search: string): { type: string; id: string; request: DetailEpisodeRequest } | null {
  const params = new URLSearchParams(search);
  const type = params.get("type");
  const id = params.get("id");
  if (!type || !id) return null;
  const season = Number(params.get("season"));
  const ep = Number(params.get("ep"));
  const request: DetailEpisodeRequest = {};
  if (Number.isFinite(season) && season >= 0) request.season = season;
  if (Number.isFinite(ep) && ep > 0) request.ep = ep;
  const epTitle = params.get("epTitle");
  if (epTitle) request.episodeName = epTitle;
  if (params.get("continue") === "1") request.continue = true;
  if (params.get("autoplay") === "1") request.autoplay = true;
  if (params.get("fromSearch") === "1") {
    request.fromSearch = true;
    const q = params.get("q");
    if (q) request.q = q;
  }
  if (params.get("fromPlayer") === "1") request.fromPlayer = true;
  return { type, id, request };
}

/**
 * Episodie es sección del Detail (un solo fondo): /episode y /streams
 * redirigen al Detail con la sección abierta. Sin type/id se muestra la
 * página clásica como fallback.
 */
export default function EpisodeRouteRedirect() {
  const location = useLocation();
  const parsed = readEpisodeRequest(location.search);
  if (!parsed) {
    return (
      <Suspense fallback={<LoadingState label="Cargando episodio" />}>
        <EpisodiePage />
      </Suspense>
    );
  }
  return (
    <Navigate
      to={buildDetailPath(parsed.type, parsed.id, undefined, location.pathname)}
      replace
      state={{ ...((location.state as Record<string, unknown> | null) ?? {}), episodeRequest: parsed.request }}
    />
  );
}
