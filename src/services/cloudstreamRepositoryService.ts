import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import type { NuvioProviderRepositoryInfo } from "./nuvioProviderService.ts";

export const GLOBAL_CLOUDSTREAM_REPOSITORY_URLS = [
  "https://raw.githubusercontent.com/redblacker8/storm-ext/refs/heads/builds/repo.json",
  "https://raw.githubusercontent.com/phisher98/cloudstream-extensions-phisher/refs/heads/builds/repo.json",
  "https://raw.githubusercontent.com/Kraptor123/cs-Karma/refs/heads/master/repo.json",
] as const;

interface ProviderHttpResponse {
  status: number;
  statusText: string;
  bodyBase64: string;
}

interface CloudstreamRepositoryManifest {
  name?: string;
  description?: string;
  pluginLists?: string[];
}

interface CloudstreamPluginEntry {
  name?: string;
  internalName?: string;
  language?: string;
  status?: number;
  url?: string;
}

export interface CloudstreamCompatibleAdapter {
  providerKey: string;
  providerName: string;
  adapterRepositoryKey: string;
  adapterRepositoryName: string;
  pluginName: string;
  language: string;
  repositoryName: string;
  repositoryUrl: string;
  selectionReason: "only-compatible-provider" | "preferred-provider-repository" | "deterministic-provider-key";
  candidateProviderKeys: string[];
}

export interface GlobalCloudstreamRepositoryInfo {
  url: string;
  name: string;
  description?: string;
  pluginCount: number;
  spanishPluginCount: number;
  compatibleProviderNames: string[];
  compatibleAdapters: CloudstreamCompatibleAdapter[];
  error?: string;
}

let inventoryPromise: Promise<GlobalCloudstreamRepositoryInfo[]> | null = null;

function decodeBase64Text(value: string) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await invokeCommand<ProviderHttpResponse>("provider_http_request", {
    request: { url, method: "GET" },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return JSON.parse(decodeBase64Text(response.bodyBase64)) as T;
}

function providerIdentity(value: string) {
  return value
    .toLowerCase()
    .replace(/provider$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

const CLOUDSTREAM_ADAPTER_ALIASES: Record<string, string[]> = {
  cuevana: ["cuevanaubd"],
  pelisplus4k: ["pelisplus"],
  pelisplusorg: ["pelisplus"],
};

interface AdapterProviderCandidate {
  key: string;
  name: string;
  repositoryKey: string;
  repositoryName: string;
}

// These priorities describe the JS adapters Aetherio actually executes. They
// are intentionally independent from the order in which manifests happen to
// finish downloading. The per-provider overrides are backed by live checks;
// the default keeps built-in Latino adapters ahead of unrelated/custom repos.
const DEFAULT_ADAPTER_REPOSITORY_PRIORITY = ["adrianjael", "kennethjys", "yoruix"] as const;
const ADAPTER_REPOSITORY_PRIORITY: Record<string, readonly string[]> = {
  cuevanaubd: ["adrianjael"],
  embed69: ["kennethjys", "adrianjael"],
  lamovie: ["adrianjael", "kennethjys"],
};

function candidateRepositoryRank(identity: string, candidate: AdapterProviderCandidate) {
  const priorities = ADAPTER_REPOSITORY_PRIORITY[identity] ?? DEFAULT_ADAPTER_REPOSITORY_PRIORITY;
  const index = priorities.indexOf(candidate.repositoryKey);
  return index >= 0 ? index : priorities.length;
}

function selectProviderCandidate(identity: string, candidates: AdapterProviderCandidate[]) {
  const uniqueCandidates = [...new Map(candidates.map(candidate => [candidate.key, candidate])).values()]
    .sort((left, right) => (
      candidateRepositoryRank(identity, left) - candidateRepositoryRank(identity, right)
      || left.repositoryKey.localeCompare(right.repositoryKey)
      || left.key.localeCompare(right.key)
    ));
  const selected = uniqueCandidates[0];
  const preferredRepositories = ADAPTER_REPOSITORY_PRIORITY[identity] ?? DEFAULT_ADAPTER_REPOSITORY_PRIORITY;
  const hasPreferredRepository = preferredRepositories.includes(selected.repositoryKey);
  return {
    selected,
    candidates: uniqueCandidates,
    selectionReason: uniqueCandidates.length === 1
      ? "only-compatible-provider" as const
      : hasPreferredRepository
        ? "preferred-provider-repository" as const
        : "deterministic-provider-key" as const,
  };
}

function isSpanishLanguage(language?: string) {
  const normalized = language?.trim().toLowerCase();
  return normalized === "es" || normalized === "mx" || normalized === "spa"
    || normalized?.startsWith("es-") || normalized?.startsWith("es_");
}

function compatibleAdapters(
  plugins: CloudstreamPluginEntry[],
  nuvioRepositories: NuvioProviderRepositoryInfo[],
  repositoryName: string,
  repositoryUrl: string,
) {
  const available = new Map<string, AdapterProviderCandidate[]>();
  for (const repository of nuvioRepositories) {
    for (const scraper of repository.scrapers) {
      const provider = {
        key: scraper.key,
        name: scraper.name,
        repositoryKey: repository.key,
        repositoryName: repository.name,
      };
      for (const identity of new Set([providerIdentity(scraper.id), providerIdentity(scraper.name)])) {
        const candidates = available.get(identity) ?? [];
        candidates.push(provider);
        available.set(identity, candidates);
      }
    }
  }

  const seen = new Set<string>();
  return [...plugins].sort((left, right) => (
    providerIdentity(left.internalName ?? left.name ?? "")
      .localeCompare(providerIdentity(right.internalName ?? right.name ?? ""))
    || (left.name ?? "").localeCompare(right.name ?? "")
  )).flatMap(plugin => {
    const candidates = [plugin.internalName, plugin.name]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(providerIdentity);
    const expandedCandidates = candidates.flatMap(candidate => [
      candidate,
      ...(CLOUDSTREAM_ADAPTER_ALIASES[candidate] ?? []),
    ]);
    const matchedIdentity = expandedCandidates.find(candidate => (available.get(candidate)?.length ?? 0) > 0);
    if (!matchedIdentity) return [];
    const selection = selectProviderCandidate(matchedIdentity, available.get(matchedIdentity) ?? []);
    const match = selection.selected;
    if (seen.has(match.key)) return [];
    seen.add(match.key);
    return [{
      providerKey: match.key,
      providerName: match.name,
      adapterRepositoryKey: match.repositoryKey,
      adapterRepositoryName: match.repositoryName,
      pluginName: plugin.name?.trim() || plugin.internalName?.trim() || match.name,
      language: plugin.language?.trim().toLowerCase() || "es",
      repositoryName,
      repositoryUrl,
      selectionReason: selection.selectionReason,
      candidateProviderKeys: selection.candidates.map(candidate => candidate.key),
    } satisfies CloudstreamCompatibleAdapter];
  }).sort((left, right) => left.providerName.localeCompare(right.providerName));
}

export function selectCloudstreamAdapters(
  repositories: GlobalCloudstreamRepositoryInfo[],
  enabledProviderKeys?: ReadonlySet<string>,
) {
  const repositoryPriority = new Map<string, number>(
    GLOBAL_CLOUDSTREAM_REPOSITORY_URLS.map((url, index) => [url, index]),
  );
  const candidates = repositories.flatMap(repository => repository.compatibleAdapters)
    .filter(adapter => !enabledProviderKeys || enabledProviderKeys.has(adapter.providerKey))
    .sort((left, right) => (
      (repositoryPriority.get(left.repositoryUrl) ?? Number.MAX_SAFE_INTEGER)
      - (repositoryPriority.get(right.repositoryUrl) ?? Number.MAX_SAFE_INTEGER)
      || left.repositoryUrl.localeCompare(right.repositoryUrl)
      || left.pluginName.localeCompare(right.pluginName)
      || left.providerKey.localeCompare(right.providerKey)
    ));
  const selected = new Map<string, CloudstreamCompatibleAdapter>();
  for (const adapter of candidates) {
    if (!selected.has(adapter.providerKey)) selected.set(adapter.providerKey, adapter);
  }
  return [...selected.values()];
}

export async function getGlobalCloudstreamRepositories(
  nuvioRepositories: NuvioProviderRepositoryInfo[],
  refresh = false,
): Promise<GlobalCloudstreamRepositoryInfo[]> {
  if (!isTauriRuntime()) return [];
  if (refresh) inventoryPromise = null;
  if (inventoryPromise) return inventoryPromise;
  inventoryPromise = Promise.all(GLOBAL_CLOUDSTREAM_REPOSITORY_URLS.map(async url => {
    try {
      const manifest = await fetchJson<CloudstreamRepositoryManifest>(url);
      const lists = Array.isArray(manifest.pluginLists) ? manifest.pluginLists : [];
      const batches = await Promise.all(lists.map(listUrl => fetchJson<CloudstreamPluginEntry[]>(new URL(listUrl, url).toString())));
      const plugins = batches.flat().filter(plugin => plugin.status !== 0 && typeof plugin.url === "string");
      const spanishPlugins = plugins.filter(plugin => isSpanishLanguage(plugin.language));
      const name = manifest.name?.trim() || new URL(url).hostname;
      const adapters = compatibleAdapters(spanishPlugins, nuvioRepositories, name, url);
      return {
        url,
        name,
        description: manifest.description,
        pluginCount: plugins.length,
        spanishPluginCount: spanishPlugins.length,
        compatibleProviderNames: adapters.map(adapter => adapter.providerName),
        compatibleAdapters: adapters,
      } satisfies GlobalCloudstreamRepositoryInfo;
    } catch (error) {
      return {
        url,
        name: new URL(url).pathname.split("/").slice(-3)[0] || new URL(url).hostname,
        pluginCount: 0,
        spanishPluginCount: 0,
        compatibleProviderNames: [],
        compatibleAdapters: [],
        error: error instanceof Error ? error.message : String(error),
      } satisfies GlobalCloudstreamRepositoryInfo;
    }
  }));
  return inventoryPromise;
}
