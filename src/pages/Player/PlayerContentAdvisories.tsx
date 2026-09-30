import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { tmdbFetch } from "../../config/apiKeys";
import type { MediaStream, StreamQuery } from "../../types/stream";
import {
  gsap,
  prefersContrastMore,
  prefersReducedMotion,
  prefersReducedTransparency,
} from "../../utils/motion";
import { resolveTmdbId } from "./utils";

export type ContentAdvisorySeverity = "mild" | "moderate" | "severe";

export interface ContentAdvisory {
  id: string;
  label: string;
  severity: ContentAdvisorySeverity;
  severityLabel: string;
}

const PARENTAL_GUIDE_API = "https://api.tiffara.com";
const CATEGORY_CONFIG = [
  { id: "PROFANITY", label: "Lenguaje" },
  { id: "VIOLENCE", label: "Violencia" },
  { id: "ALCOHOL_DRUGS", label: "Alcohol / Drogas" },
  { id: "FRIGHTENING_INTENSE_SCENES", label: "Miedo" },
] as const;
const SEVERITY_LABELS: Record<ContentAdvisorySeverity, string> = {
  mild: "Leve",
  moderate: "Moderado",
  severe: "Intenso",
};
const advisoryCache = new Map<string, readonly ContentAdvisory[]>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function normalizeSeverity(value: unknown): ContentAdvisorySeverity | null {
  if (typeof value !== "string") return null;
  const severity = value.trim().toLowerCase();
  return severity === "mild" || severity === "moderate" || severity === "severe" ? severity : null;
}

function normalizeVoteCount(value: unknown) {
  const voteCount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(voteCount) && voteCount > 0 ? voteCount : 0;
}

export function resolveDominantAdvisorySeverity(value: unknown): ContentAdvisorySeverity | null {
  if (!Array.isArray(value)) return null;
  let noneVotes = 0;
  let dominant: { severity: ContentAdvisorySeverity; votes: number } | null = null;

  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const rawSeverity = typeof record.severityLevel === "string" ? record.severityLevel.trim().toLowerCase() : "";
    const votes = normalizeVoteCount(record.voteCount);
    if (rawSeverity === "none") {
      noneVotes = Math.max(noneVotes, votes);
      continue;
    }
    const severity = normalizeSeverity(rawSeverity);
    if (severity === null) continue;
    if (!dominant || votes > dominant.votes) dominant = { severity, votes };
  }

  if (!dominant || dominant.votes <= noneVotes) return null;
  return dominant.severity;
}

export function mapParentalGuideCategories(value: unknown): ContentAdvisory[] {
  if (!Array.isArray(value)) return [];
  const categories = new Map<string, Record<string, unknown>>();

  for (const item of value) {
    const record = asRecord(item);
    const category = typeof record?.category === "string" ? record.category.trim().toUpperCase() : "";
    if (record && category) categories.set(category, record);
  }

  return CATEGORY_CONFIG.flatMap(category => {
    const severity = resolveDominantAdvisorySeverity(categories.get(category.id)?.severityBreakdowns);
    if (!severity) return [];
    return [{
      id: category.id,
      label: category.label,
      severity,
      severityLabel: SEVERITY_LABELS[severity],
    }];
  });
}

function extractImdbId(value: unknown) {
  if (typeof value !== "string") return null;
  return value.match(/(?:^|:)(tt\d+)(?:$|[^0-9])/i)?.[1]?.toLowerCase() ?? null;
}

function streamImdbId(stream: MediaStream | null) {
  const hints = asRecord(stream?.behaviorHints);
  return extractImdbId(hints?.imdbId ?? hints?.imdb_id);
}

async function resolveEpisodeImdbId(query: StreamQuery, signal: AbortSignal) {
  if (!query.season || !query.episode) return null;
  const directTmdbId = query.id.match(/^tmdb:(\d+)/i)?.[1];
  const tmdbId = directTmdbId ? Number(directTmdbId) : await resolveTmdbId(query.type, query.id);
  if (!tmdbId) return null;

  const episode = await tmdbFetch<unknown>(
    `/tv/${tmdbId}/season/${query.season}/episode/${query.episode}`,
    { signal, params: { append_to_response: "external_ids" } },
  );
  const episodeRecord = asRecord(episode);
  const externalIds = asRecord(episodeRecord?.external_ids);
  return extractImdbId(externalIds?.imdb_id ?? episodeRecord?.imdb_id);
}

async function resolveTitleImdbId(query: StreamQuery, directImdbId: string | null, signal: AbortSignal) {
  const episodeImdbId = await resolveEpisodeImdbId(query, signal);
  if (episodeImdbId) return episodeImdbId;
  if (!query.season || !query.episode) return directImdbId;

  const directTmdbId = query.id.match(/^tmdb:(\d+)/i)?.[1];
  const tmdbId = directTmdbId ? Number(directTmdbId) : await resolveTmdbId(query.type, query.id);
  if (!tmdbId) return directImdbId;

  const externalIds = await tmdbFetch<unknown>(`/tv/${tmdbId}/external_ids`, { signal });
  const record = asRecord(externalIds);
  return extractImdbId(record?.imdb_id) ?? directImdbId;
}

async function fetchContentAdvisories(imdbId: string, signal: AbortSignal) {
  const response = await fetch(`${PARENTAL_GUIDE_API}/titles/${encodeURIComponent(imdbId)}/parentsGuide`, {
    signal,
    headers: {
      Accept: "application/json",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.6",
    },
  });
  if (!response.ok) return [];
  const payload = asRecord(await response.json());
  return mapParentalGuideCategories(payload?.parentsGuide);
}

function readCachedAdvisories(imdbId: string) {
  if (!advisoryCache.has(imdbId)) return null;
  return advisoryCache.get(imdbId) ?? [];
}

function cacheAdvisories(imdbId: string, advisories: ContentAdvisory[]) {
  if (advisoryCache.size >= 100) {
    const oldestKey = advisoryCache.keys().next().value;
    if (oldestKey) advisoryCache.delete(oldestKey);
  }
  advisoryCache.set(imdbId, advisories);
}

export function useContentAdvisories(query: StreamQuery | null, stream: MediaStream | null) {
  const [advisories, setAdvisories] = useState<ContentAdvisory[]>([]);
  const hintedImdbId = streamImdbId(stream);
  const directImdbId = hintedImdbId ?? extractImdbId(query?.id);
  const requestKey = query
    ? `${query.type}:${query.id}:${query.season ?? ""}:${query.episode ?? ""}`
    : "";

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setAdvisories([]);

    if (!query) {
      return () => controller.abort();
    }

    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void (async () => {
      try {
        const imdbId = hintedImdbId
          ? hintedImdbId
          : directImdbId && (!query.season || !query.episode)
            ? directImdbId
            : await resolveTitleImdbId(query, directImdbId, controller.signal);
        if (!imdbId || !active) return;
        const cached = readCachedAdvisories(imdbId);
        if (cached) {
          setAdvisories([...cached]);
          return;
        }
        const result = await fetchContentAdvisories(imdbId, controller.signal);
        cacheAdvisories(imdbId, result);
        if (active) setAdvisories(result);
      } catch {
        if (active) setAdvisories([]);
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [directImdbId, hintedImdbId, requestKey]);

  return advisories;
}

interface PlayerContentAdvisoriesProps {
  items: ContentAdvisory[];
  bigPicture: boolean;
  lightBackground: boolean;
  dismissed: boolean;
  onComplete: () => void;
}

export default function PlayerContentAdvisories({
  items,
  bigPicture,
  lightBackground,
  dismissed,
  onComplete,
}: PlayerContentAdvisoriesProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const dismissRequestedRef = useRef(false);
  const itemKey = items.map(item => `${item.id}:${item.severity}`).join("|");

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !itemKey) return;
    const itemElements = Array.from(panel.querySelectorAll<HTMLElement>("[data-player-advisory]"));
    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onComplete();
    };
    let enterTimeline: gsap.core.Timeline | null = null;
    let exitTimeline: gsap.core.Timeline | null = null;
    let holdTimer: number | null = null;
    let exitStarted = false;

    const startExit = () => {
      if (exitStarted || finishedRef.current) return;
      exitStarted = true;
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
      gsap.killTweensOf(panel);
      gsap.killTweensOf(itemElements);
      if (prefersReducedMotion()) {
        exitTimeline = gsap.timeline({ onComplete: finish })
          .to(panel, { opacity: 0, duration: 0.2, ease: "power1.out" });
        return;
      }
      exitTimeline = gsap.timeline({ onComplete: finish, defaults: { overwrite: "auto" } })
        .to(itemElements, {
          opacity: 0,
          y: -4,
          scale: 0.98,
          filter: "blur(3px)",
          duration: 0.2,
          stagger: 0.025,
          ease: "power2.in",
        })
        .to(panel, {
          opacity: 0,
          y: -6,
          scale: 0.985,
          filter: "blur(7px)",
          duration: 0.24,
          ease: "power2.in",
        }, "<0.08");
    };

    if (dismissed) dismissRequestedRef.current = true;
    if (dismissRequestedRef.current) {
      startExit();
    } else if (prefersReducedMotion()) {
      enterTimeline = gsap.timeline({
        onComplete: () => {
          holdTimer = window.setTimeout(startExit, 4_400);
        },
      })
        .fromTo(panel, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power1.out" })
        .fromTo(itemElements, { opacity: 0 }, { opacity: 1, duration: 0.2, stagger: 0.04, ease: "power1.out" }, "<");
    } else {
      gsap.set(panel, { opacity: 0, y: 12, scale: 0.97, filter: "blur(10px)", transformOrigin: "top left" });
      gsap.set(itemElements, { opacity: 0, y: 9, scale: 0.94, filter: "blur(5px)", transformOrigin: "center" });
      enterTimeline = gsap.timeline({
        onComplete: () => {
          holdTimer = window.setTimeout(startExit, 4_200);
        },
        defaults: { overwrite: "auto" },
      })
        .to(panel, {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: "blur(0px)",
          duration: 0.52,
          ease: "expo.out",
        })
        .to(itemElements, {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: "blur(0px)",
          duration: 0.42,
          stagger: 0.065,
          ease: "power3.out",
        }, "-=0.24");
    }

    return () => {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      enterTimeline?.kill();
      exitTimeline?.kill();
      gsap.killTweensOf(panel);
      gsap.killTweensOf(itemElements);
    };
  }, [bigPicture, dismissed, itemKey, onComplete]);

  const reducedTransparency = prefersReducedTransparency();
  const increasedContrast = prefersContrastMore();
  const darkText = lightBackground;
  const panelBackground = darkText
    ? reducedTransparency
      ? "rgba(246, 246, 248, 0.97)"
      : "rgba(244, 244, 247, 0.76)"
    : reducedTransparency
      ? "rgba(20, 20, 22, 0.96)"
      : "rgba(20, 20, 22, 0.68)";
  const panelBorder = darkText
    ? increasedContrast ? "rgba(0, 0, 0, 0.24)" : "rgba(255, 255, 255, 0.7)"
    : increasedContrast ? "rgba(255, 255, 255, 0.42)" : "rgba(255, 255, 255, 0.12)";
  const panelColor = darkText ? "rgba(12, 12, 14, 0.94)" : "rgba(255, 255, 255, 0.96)";
  const mutedColor = darkText ? "rgba(12, 12, 14, 0.5)" : "rgba(255, 255, 255, 0.56)";
  const badgeBackground = darkText ? "rgba(12, 12, 14, 0.055)" : "rgba(255, 255, 255, 0.085)";
  const badgeBorder = darkText ? "rgba(12, 12, 14, 0.08)" : "rgba(255, 255, 255, 0.08)";
  const severityColor = (severity: ContentAdvisorySeverity) => {
    if (severity === "moderate") return darkText ? "#8a5a00" : "#ffd60a";
    if (severity === "severe") return darkText ? "#b45309" : "#ff9f0a";
    return darkText ? "rgba(12, 12, 14, 0.34)" : "rgba(255, 255, 255, 0.42)";
  };
  const ariaLabel = `Avisos de contenido: ${items.map(item => `${item.label}, ${item.severityLabel}`).join(". ")}`;

  return (
    <div
      data-player-content-advisories
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className="pointer-events-none absolute z-50"
      style={{
        top: bigPicture ? "clamp(30px, 5.5vh, 60px)" : "clamp(20px, 4vh, 42px)",
        left: bigPicture
          ? "clamp(26px, 4vw, 64px)"
          : "max(20px, calc((100vw - min(1240px, calc(100vw - 32px))) / 2 + 16px))",
        maxWidth: bigPicture ? 460 : 400,
        color: panelColor,
        fontFamily: "Inter, system-ui, sans-serif",
        fontOpticalSizing: "auto",
      }}
    >
      <div
        ref={panelRef}
        className={`${bigPicture ? "rounded-[24px] px-4 py-3.5" : "rounded-[20px] px-3.5 py-3"} w-fit max-w-full`}
        style={{
          opacity: 0,
          background: panelBackground,
          border: `1px solid ${panelBorder}`,
          boxShadow: darkText
            ? "0 18px 46px rgba(24, 24, 28, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.78)"
            : "0 18px 52px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
          backdropFilter: reducedTransparency ? "none" : "blur(32px) saturate(180%)",
          WebkitBackdropFilter: reducedTransparency ? "none" : "blur(32px) saturate(180%)",
          willChange: "transform, opacity, filter",
        }}
      >
        <div className={`${bigPicture ? "mb-2.5 gap-2 text-[12px]" : "mb-2 gap-1.5 text-[10px]"} flex items-center font-semibold uppercase tracking-[0.12em]`} style={{ color: mutedColor }}>
          <span
            className={`${bigPicture ? "h-7 w-7 rounded-[10px]" : "h-6 w-6 rounded-[9px]"} flex items-center justify-center`}
            style={{ background: darkText ? "rgba(12, 12, 14, 0.07)" : "rgba(255, 255, 255, 0.1)" }}
          >
            <ShieldAlert size={bigPicture ? 15 : 13} strokeWidth={1.9} />
          </span>
          <span>Contenido</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {items.map(item => (
            <span
              key={item.id}
              data-player-advisory
              className={`${bigPicture ? "h-8 gap-2 rounded-[13px] px-3 text-[13px]" : "h-7 gap-1.5 rounded-[11px] px-2.5 text-[11px]"} inline-flex items-center border font-medium leading-none`}
              style={{ background: badgeBackground, borderColor: badgeBorder }}
            >
              <span
                aria-hidden="true"
                className={`${bigPicture ? "h-1.5 w-1.5" : "h-[5px] w-[5px]"} rounded-full`}
                style={{ background: severityColor(item.severity) }}
              />
              <span className="font-semibold whitespace-nowrap">{item.label}</span>
              <span className="whitespace-pre" aria-hidden="true" style={{ color: mutedColor }}>·</span>
              <span className="whitespace-nowrap" style={{ color: mutedColor }}>{item.severityLabel}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
