const cheerio = require("cheerio-without-node-native");

const BASE_URL = "https://4khdhub.one";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };

function absoluteUrl(value, base = BASE_URL) {
  try {
    return new URL(value, `${base}/`).toString();
  } catch {
    return "";
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(the|a|an|part|vol|volume)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function decodeBase64(value) {
  try {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function rot13(value) {
  return String(value || "").replace(/[a-zA-Z]/g, character => {
    const base = character <= "Z" ? 65 : 97;
    return String.fromCharCode((character.charCodeAt(0) - base + 13) % 26 + base);
  });
}

function decodeRedirectPayload(value) {
  try {
    const first = decodeBase64(value);
    const second = decodeBase64(first);
    const json = decodeBase64(rot13(second));
    const payload = JSON.parse(json);
    return typeof payload.o === "string" ? decodeBase64(payload.o) : "";
  } catch {
    return "";
  }
}

async function fetchText(url, headers = {}, attempt = 0) {
  try {
    const response = await fetch(url, { headers: { ...HEADERS, ...headers } });
    if (!response.ok) {
      if (response.status >= 500 && attempt < 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
        return fetchText(url, headers, attempt + 1);
      }
      throw new Error(`4KHDHub HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    if (attempt < 1 && (!(error instanceof Error) || !/^4KHDHub HTTP/.test(error.message))) {
      await new Promise(resolve => setTimeout(resolve, 150));
      return fetchText(url, headers, attempt + 1);
    }
    throw error;
  }
}

function extractRedirectUrl(html) {
  const match = html.match(/s\(\s*['"]o['"]\s*,\s*['"]([^'"]+)/i)
    || html.match(/localStorage\.setItem\(\s*['"]o['"]\s*,\s*['"]([^'"]+)/i);
  return match ? decodeRedirectPayload(match[1]) : "";
}

function extractQuality(text) {
  const value = String(text || "").toLowerCase().replace(/4k\s*hdhub/gi, " ");
  if (/2160|4k|uhd/.test(value)) return "4K";
  if (/1080|fhd/.test(value)) return "1080p";
  if (/720/.test(value)) return "720p";
  if (/480/.test(value)) return "480p";
  return "Auto";
}

function extractSize(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?\s*[GM]B)/i);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function findBestPage($, title, type) {
  const wanted = normalize(title);
  let best = null;
  $("a.movie-card, div.card-grid > a").each((_, element) => {
    const node = $(element);
    const href = node.attr("href");
    if (!href) return;
    const cardTitle = node.find(".movie-card-title").first().text().trim() || node.attr("aria-label")?.replace(/ details$/i, "").trim() || "";
    const cardText = node.text().replace(/\s+/g, " ").trim();
    const normalizedTitle = normalize(cardTitle);
    if (!normalizedTitle) return;
    const isSeries = /series|episode|season/i.test(cardText);
    if (type === "tv" && !isSeries && !/tv|series|web/i.test(cardText)) return;
    if (type === "movie" && isSeries) return;
    const titleScore = normalizedTitle === wanted ? 3 : normalizedTitle.includes(wanted) || wanted.includes(normalizedTitle) ? 2 : 0;
    const yearMatch = String(title || "").match(/\b(19|20)\d{2}\b/)?.[0];
    const score = titleScore + (yearMatch && cardText.includes(yearMatch) ? 1 : 0);
    if (!best || score > best.score) best = { href: absoluteUrl(href), score };
  });
  return best && best.score >= 2 ? best.href : "";
}

function collectLinks($, type, season, episode) {
  const links = [];
  const seen = new Set();
  const isEpisode = type === "tv";
  const episodeCode = isEpisode ? `S${String(season || 1).padStart(2, "0")}E${String(episode || 1).padStart(2, "0")}` : "";
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const item = $(element).closest(".download-item, .episode-download-item, .episode-item");
    const itemText = item.text().replace(/\s+/g, " ").trim();
    const itemSeason = itemText.match(/\bS0?(\d{1,2})/i)?.[1];
    if (isEpisode && itemSeason && Number(itemSeason) !== Number(season || 1)) return;
    if (isEpisode && itemText && episodeCode && !itemText.includes(episodeCode) && !itemText.includes(`Episode-${String(episode || 1).padStart(2, "0")}`)) return;
    const absolute = absoluteUrl(href);
    const linkText = $(element).text().replace(/\s+/g, " ").trim();
    if (!/greenmotors\.club|hubcloud\.|hubdrive\.|drive\.pics|\.(?:mp4|mkv|m3u8)(?:$|[?#])/i.test(absolute)) return;
    if (!seen.has(absolute)) {
      seen.add(absolute);
      links.push({
        href: absolute,
        text: `${itemText} ${linkText}`,
        priority: (isEpisode && item.closest(".episode-download-item, .episode-item").length ? 0 : 2)
          + (linkText.toLowerCase().includes("hubcloud") ? 0 : 1),
      });
    }
  });
  return links.sort((left, right) => left.priority - right.priority);
}

async function resolveGeneratedPage(url, referer) {
  const response = await fetch(url, { headers: { ...HEADERS, Referer: referer } });
  const html = await response.text();
  if (response.url && response.url.includes("link=")) return [response.url.split("link=").slice(1).join("link=")];
  const $ = cheerio.load(html);
  const candidates = [];
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (!href) return;
    if (/pixel\.hubcloud|Download File|10Gbps|\.mp4|\.mkv|\.m3u8/i.test(`${href} ${text}`)) candidates.push(absoluteUrl(href, response.url || url));
  });
  const prioritized = [...new Set(candidates)].sort((left, right) => Number(/pixel\.hubcloud/i.test(right)) - Number(/pixel\.hubcloud/i.test(left)));
  return Promise.all(prioritized.slice(0, 1).map(candidate => followCandidate(candidate, referer)));
}

async function followCandidate(candidate, referer) {
  let current = candidate;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const wrapper = /greenmotors\.club|hubcloud\.|pixel\.hubcloud|gamerxyt\.com/i.test(current);
    let response = await fetch(current, { method: "HEAD", headers: { ...HEADERS, Referer: referer } });
    if (wrapper && response.status === 405) {
      response = await fetch(current, { method: "GET", headers: { ...HEADERS, Referer: referer } });
      try { await response.body?.cancel(); } catch {}
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = absoluteUrl(location, current);
      continue;
    }
    const finalUrl = response.url || current;
    return finalUrl.includes("link=") ? finalUrl.split("link=").slice(1).join("link=") : finalUrl;
  }
  return current;
}

async function resolveHubCloud(url) {
  const response = await fetch(url, { headers: HEADERS });
  const html = await response.text();
  const generator = html.match(/var\s+url\s*=\s*['"]([^'"]+)/i)?.[1]
    || cheerio.load(html)("a#download").attr("href")
    || "";
  if (!generator) return [];
  return resolveGeneratedPage(absoluteUrl(generator, response.url || url), url);
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve([]), timeoutMs)),
  ]);
}

async function resolveLink(link) {
  if (/greenmotors\.club/i.test(link)) {
    const html = await fetchText(link);
    const target = extractRedirectUrl(html);
    return target ? resolveLink(target) : [];
  }
  if (/hubcloud\./i.test(link)) return resolveHubCloud(link);
  if (/hubdrive\.|drive\.pics/i.test(link)) {
    const html = await fetchText(link);
    const $ = cheerio.load(html);
    const href = $("a[href]").filter((_, element) => /hubcloud|download|mp4|mkv|m3u8/i.test(`${$(element).text()} ${$(element).attr("href")}`)).first().attr("href");
    return href ? resolveLink(absoluteUrl(href, link)) : [];
  }
  return [link];
}

async function probe(url, referer) {
  try {
    const response = await fetch(url, { method: "HEAD", headers: { ...HEADERS, Referer: referer } });
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const looksMedia = /video|audio|octet-stream|matroska|mpegurl|mp4|m3u8/.test(contentType)
      || /\.(?:mp4|mkv|m3u8)(?:$|[?#])/i.test(url)
      || /googleusercontent\.com/i.test(url);
    return (response.status === 200 || response.status === 206) && looksMedia;
  } catch {
    return false;
  }
}

function makeStream(url, source, text) {
  const quality = extractQuality(text);
  const size = extractSize(text);
  const headers = { "User-Agent": USER_AGENT, Referer: `${BASE_URL}/`, Accept: "*/*" };
  const label = String(source || "").replace(/\s+/g, " ").split("Download")[0].trim().slice(0, 140);
  return {
    name: "4KHDHub",
    title: [quality !== "Auto" ? quality : "", size, label].filter(Boolean).join(" · "),
    url,
    type: "direct",
    verified: true,
    headers,
    behaviorHints: { proxyHeaders: { request: headers }, bingeGroup: "4khdhub" },
  };
}

async function getStreams(tmdbId, type, season, episode, title) {
  const mediaType = type === "tv" || type === "series" ? "tv" : "movie";
  const searchTitle = String(title || tmdbId || "").trim();
  if (!searchTitle) return [];
  try {
    const searchHtml = await fetchText(`${BASE_URL}/?s=${encodeURIComponent(searchTitle)}`);
    const $ = cheerio.load(searchHtml);
    const pageUrl = findBestPage($, searchTitle, mediaType);
    if (!pageUrl) return [];
    const detailHtml = await fetchText(pageUrl);
    const detail$ = cheerio.load(detailHtml);
    const links = collectLinks(detail$, mediaType, season, episode).slice(0, mediaType === "tv" ? 3 : 2);
    const seen = new Set();
    const streams = [];
    const targetCount = 1;
    for (const link of links) {
      let urls = [];
      try {
        urls = await withTimeout(resolveLink(link.href), 3500);
      } catch {
      }
      for (const url of urls) {
        if (!url || seen.has(url) || !await probe(url, pageUrl)) continue;
        seen.add(url);
        streams.push(makeStream(url, link.text, `${link.text} ${url}`));
        if (streams.length >= targetCount) break;
      }
      if (streams.length >= targetCount) break;
    }
    return streams;
  } catch {
    return [];
  }
}

module.exports = { getStreams };
