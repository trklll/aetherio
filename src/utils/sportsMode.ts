import { getModeTransitionPhase, transitionToMode } from "./bigPictureTransition";

type NavigateTo = (path: string) => void;
let returnPath = "/big-picture";

export function isSportsLocation(pathname: string, search = ""): boolean {
  if (pathname === "/big-picture/sports" || pathname.startsWith("/big-picture/sports/")) return true;
  if (pathname !== "/big-picture/player") return false;
  const type = new URLSearchParams(search).get("type");
  return type === "live" || type === "sports-replay";
}

export function enterSportsMode(navigate: NavigateTo, pathname: string): void {
  if (!import.meta.env.DEV || isSportsLocation(pathname)) return;
  const phase = getModeTransitionPhase();
  if (phase === "cover" || phase === "brand") return;
  returnPath = pathname.startsWith("/big-picture") ? "/big-picture" : "/home";
  transitionToMode("sports", () => navigate("/big-picture/sports"));
}

export function exitSportsMode(navigate: NavigateTo): void {
  transitionToMode(returnPath === "/big-picture" ? "enter" : "exit", () => navigate(returnPath));
}

export function toggleSportsMode(navigate: NavigateTo, pathname: string, search = ""): void {
  if (!import.meta.env.DEV) return;
  if (isSportsLocation(pathname, search)) exitSportsMode(navigate);
  else enterSportsMode(navigate, pathname);
}
