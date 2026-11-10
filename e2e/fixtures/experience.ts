import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";

export interface ExperienceFixture {
  version: number;
  fixedNow: string;
  profiles: Array<{ id: string; name: string; createdAt: number; updatedAt: number }>;
  activeProfileId: string;
  media: {
    movie: Record<string, unknown>;
    series: Record<string, unknown>;
    anime: Array<Record<string, unknown>>;
  };
  continueWatching: Array<Record<string, unknown>>;
  watchedHistory: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  audioTracks: Array<Record<string, unknown>>;
  storageFailure: { key: string; errorName: string };
  sync: Record<string, Record<string, unknown>>;
  party: { members: Array<Record<string, unknown>> };
  tmdb: {
    movieDetail: Record<string, unknown>;
    seriesDetail: Record<string, unknown>;
    movieResults: Array<Record<string, unknown>>;
    seriesResults: Array<Record<string, unknown>>;
  };
}

export const experienceFixture = JSON.parse(
  readFileSync(new URL("./experience/core.json", import.meta.url), "utf8"),
) as ExperienceFixture;

const APP_ORIGIN = process.env.AETHERIO_RELEASE_SMOKE === "1"
  ? "http://127.0.0.1:1421"
  : "http://127.0.0.1:1420";
const FIXTURE_IMAGE = [
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"450\" viewBox=\"0 0 800 450\">",
  "<defs><linearGradient id=\"g\" x2=\"1\" y2=\"1\"><stop stop-color=\"#26384a\"/><stop offset=\"1\" stop-color=\"#111318\"/></linearGradient></defs>",
  "<rect width=\"800\" height=\"450\" fill=\"url(#g)\"/><circle cx=\"630\" cy=\"120\" r=\"120\" fill=\"#d2a86b\" fill-opacity=\".18\"/>",
  "<path d=\"M0 360 240 230l150 90 180-160 230 200v90H0z\" fill=\"#080a0d\" fill-opacity=\".6\"/></svg>",
].join("");

function jsonResponse(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

async function mockExternalRequest(route: Route) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin === APP_ORIGIN) return route.continue();
  if (request.method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  }
  if (request.resourceType() === "image" || url.hostname === "image.tmdb.org") {
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: FIXTURE_IMAGE });
  }

  const path = decodeURIComponent(url.pathname);
  if (/\/movie\/990001(?:\/|$)/.test(path)) return route.fulfill(jsonResponse(experienceFixture.tmdb.movieDetail));
  if (/\/(?:tv|series)\/990002(?:\/|$)/.test(path)) return route.fulfill(jsonResponse(experienceFixture.tmdb.seriesDetail));
  if (path.includes("/discover/movie") || path.includes("/search/movie")) {
    return route.fulfill(jsonResponse({ page: 1, total_pages: 1, results: experienceFixture.tmdb.movieResults }));
  }
  if (path.includes("/discover/tv") || path.includes("/search/tv")) {
    return route.fulfill(jsonResponse({ page: 1, total_pages: 1, results: experienceFixture.tmdb.seriesResults }));
  }
  if (url.hostname === "graphql.anilist.co") {
    return route.fulfill(jsonResponse({ data: { Page: { media: [] }, Media: { relations: { edges: [] } } } }));
  }
  if (/api\.jikan\.mo$/.test(url.hostname)) {
    return route.fulfill(jsonResponse({ data: [] }));
  }

  // Ninguna llamada de fixture debe alcanzar un servicio público ni una cuenta real.
  return route.abort("blockedbyclient");
}

/** Instala almacenamiento sintético y bloquea toda API externa no simulada. */
export async function installExperienceFixture(page: Page) {
  await page.clock.install({ time: new Date(experienceFixture.fixedNow) });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(({ fixture, fixedNow }) => {
    const target = window as unknown as Record<string, any>;
    let callbackId = 1;
    target.__TAURI_INTERNALS__ = {
      transformCallback: () => callbackId++,
      invoke: async (command: string) => command.startsWith("plugin:event|") ? callbackId++ : null,
      convertFileSrc: (value: string) => value,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    target.__TAURI__ = { event: { listen: async () => () => undefined } };

    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify(fixture.profiles));
    localStorage.setItem("aetherio-active-profile-id", fixture.activeProfileId);
    const scope = `aetherio-profile:${fixture.activeProfileId}:`;
    localStorage.setItem(`${scope}aetherio-saved-library-v1`, JSON.stringify([
      { ...fixture.media.movie, addedAt: fixedNow - 86_400_000 },
      { ...fixture.media.series, addedAt: fixedNow - 43_200_000 },
    ]));
    localStorage.setItem(`${scope}aetherio-continue-watching-v1`, JSON.stringify(fixture.continueWatching));
    localStorage.setItem(`${scope}aetherio-watched-history-v1`, JSON.stringify(fixture.watchedHistory));
    sessionStorage.setItem("aetherio-detail-media-meta-v1", JSON.stringify({
      "movie:990001": {
        id: "990001",
        type: "movie",
        name: fixture.tmdb.movieDetail.title,
        background: "https://image.tmdb.org/t/p/original/experience-movie-backdrop.svg",
        poster: "https://image.tmdb.org/t/p/w500/experience-movie-poster.svg",
        description: fixture.tmdb.movieDetail.overview,
        year: 2024,
        source: "e2e-fixture",
        updatedAt: fixedNow,
      },
      "series:990002": {
        id: "990002",
        type: "series",
        name: fixture.tmdb.seriesDetail.name,
        background: "https://image.tmdb.org/t/p/original/experience-series-backdrop.svg",
        poster: "https://image.tmdb.org/t/p/w500/experience-series-poster.svg",
        description: fixture.tmdb.seriesDetail.overview,
        year: 2023,
        source: "e2e-fixture",
        updatedAt: fixedNow,
      },
    }));

    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === fixture.storageFailure.key) {
        throw new DOMException("Synthetic storage quota exceeded", fixture.storageFailure.errorName);
      }
      return originalSetItem.call(this, key, value);
    };
  }, { fixture: experienceFixture, fixedNow: Date.parse(experienceFixture.fixedNow) });

  await page.route("**/*", route => mockExternalRequest(route));
}

export async function revealForCapture(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  // Home tiene un reveal de entrada deliberado; esperar a que termine evita
  // capturas negras que solo prueban navegación, no una superficie estable.
  await page.clock.runFor(3_200);
  await page.waitForTimeout(100);
}
