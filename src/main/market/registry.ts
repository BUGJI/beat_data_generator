import { app, net } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  MarketIndex,
  MarketPlugin,
  MarketVersionInfo,
} from "../../shared/market";
import { MARKET_TTL_MS, type MarketCacheTtl } from "../../shared/settings";
import log from "../logger";

/**
 * Registry index fetch + on-disk/memory cache, and the settings-driven network
 * behaviour (cache TTL, gh-proxy rewriting) used for both the index and the
 * plugin artifact downloads.
 */

const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/beat-data-generator/registry/main/registry.json";
const CACHE_FILE = "market-cache.json";
export const DOWNLOAD_TIMEOUT_MS = 60_000;

export function registryUrl(): string {
  const override = process.env.BDG_MARKET_REGISTRY;
  return override && /^https:\/\//.test(override)
    ? override
    : DEFAULT_REGISTRY_URL;
}

// ---- settings-driven network behaviour ----

export interface MarketNetworkSettings {
  marketCacheTtl: MarketCacheTtl;
  githubProxy: boolean;
  githubProxyHost: string;
}

const FALLBACK_SETTINGS: MarketNetworkSettings = {
  marketCacheTtl: "3d",
  githubProxy: false,
  githubProxyHost: "ghfast.top",
};

let settingsRef: () => MarketNetworkSettings = () => FALLBACK_SETTINGS;

/** Wire the market to the main-process settings getter. */
export function setMarketSettings(fn: () => MarketNetworkSettings): void {
  settingsRef = fn;
}

function ttlMs(): number {
  return MARKET_TTL_MS[settingsRef().marketCacheTtl] ?? MARKET_TTL_MS["3d"];
}

function proxyBase(): string {
  const host =
    settingsRef().githubProxyHost.trim().replace(/\/+$/, "") || "ghfast.top";
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

/** Hosts whose URLs are safe to rewrite through a gh-proxy mirror. */
const PROXY_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
]);

/** Rewrite a GitHub URL through the configured gh-proxy mirror, if enabled. */
export function proxify(url: string): string {
  if (!settingsRef().githubProxy) return url;
  try {
    const u = new URL(url);
    if (!PROXY_HOSTS.has(u.hostname)) return url;
    return `${proxyBase()}/${url}`;
  } catch {
    return url;
  }
}

// ---- registry index ----

interface RegistryCache {
  etag?: string;
  fetchedAt: string;
  index: MarketIndex;
}

let memoryIndex: MarketIndex | null = null;
let memoryFetchedAt = 0;

function cachePath(): string {
  return join(app.getPath("userData"), CACHE_FILE);
}

function readCache(): RegistryCache | null {
  try {
    const raw = JSON.parse(
      readFileSync(cachePath(), "utf-8"),
    ) as Partial<RegistryCache>;
    if (raw && typeof raw.index === "object") {
      return {
        etag: typeof raw.etag === "string" ? raw.etag : undefined,
        fetchedAt: typeof raw.fetchedAt === "string" ? raw.fetchedAt : "",
        index: raw.index as MarketIndex,
      };
    }
  } catch {
    /* no cache yet */
  }
  return null;
}

function writeCache(cache: RegistryCache): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(cache), "utf-8");
  } catch (err) {
    log.error("[market] persist registry cache failed", err);
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Categories are lowercased, trimmed and de-duplicated to match i18n keys. */
function asCategoryArray(v: unknown): string[] {
  return [...new Set(asStringArray(v).map((c) => c.toLowerCase()))];
}

/** A plugin/folder id safe to use as a path segment. */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && id !== "..";
}

function sanitizeVersion(v: unknown): MarketVersionInfo | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.url !== "string" || !o.url) return null;
  if (typeof o.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(o.sha256))
    return null;
  return {
    url: o.url,
    sha256: o.sha256.toLowerCase(),
    size: typeof o.size === "number" && o.size > 0 ? o.size : undefined,
    minAppVersion:
      typeof o.minAppVersion === "string" ? o.minAppVersion : undefined,
  };
}

function sanitizePlugin(v: unknown): MarketPlugin | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const latest = typeof o.latest === "string" ? o.latest.trim() : "";
  if (!id || !latest || !isSafeId(id)) return null;
  const rawVersions =
    o.versions && typeof o.versions === "object"
      ? (o.versions as Record<string, unknown>)
      : {};
  const versions: Record<string, MarketVersionInfo> = {};
  for (const [ver, info] of Object.entries(rawVersions)) {
    const clean = sanitizeVersion(info);
    if (clean) versions[ver] = clean;
  }
  if (!versions[latest]) return null;
  return {
    id,
    latest,
    versions,
    repo: typeof o.repo === "string" ? o.repo : undefined,
    homepage: typeof o.homepage === "string" ? o.homepage : undefined,
    author: typeof o.author === "string" ? o.author : undefined,
    categories: asCategoryArray(o.categories),
    tags: asStringArray(o.tags),
    name: o.name as MarketPlugin["name"],
    description: o.description as MarketPlugin["description"],
    minAppVersion:
      typeof o.minAppVersion === "string" ? o.minAppVersion : undefined,
  };
}

function sanitizeIndex(raw: unknown): MarketIndex {
  if (!raw || typeof raw !== "object")
    throw new Error("invalid registry document");
  const o = raw as Record<string, unknown>;
  const plugins = Array.isArray(o.plugins)
    ? (o.plugins.map(sanitizePlugin).filter(Boolean) as MarketPlugin[])
    : [];
  return {
    schema: typeof o.schema === "number" ? o.schema : 1,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
    plugins,
  };
}

/** Age of a cache entry in ms; Infinity when the timestamp is unusable. */
function cacheAge(cache: RegistryCache): number {
  const t = Date.parse(cache.fetchedAt);
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}

export async function getIndex(force: boolean): Promise<MarketIndex> {
  const now = Date.now();
  const ttl = ttlMs();

  // 1. freshest: already loaded this session and still within the TTL
  if (!force && memoryIndex && now - memoryFetchedAt < ttl) return memoryIndex;

  // 2. next: on-disk cache that has not expired yet (avoids any network hit)
  const cache = readCache();
  if (!force && cache && cacheAge(cache) < ttl) {
    memoryIndex = cache.index;
    memoryFetchedAt = Date.parse(cache.fetchedAt) || now;
    return memoryIndex;
  }

  // 3. expired (or forced): revalidate over the network
  const headers: Record<string, string> = { accept: "application/json" };
  if (!force && cache?.etag) headers["if-none-match"] = cache.etag;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await net.fetch(proxify(registryUrl()), {
      headers,
      signal: controller.signal,
    });
    if (res.status === 304 && cache) {
      memoryIndex = cache.index;
      memoryFetchedAt = now;
      writeCache({
        etag: cache.etag,
        fetchedAt: new Date(now).toISOString(),
        index: cache.index,
      });
      return memoryIndex;
    }
    if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
    const index = sanitizeIndex(await res.json());
    memoryIndex = index;
    memoryFetchedAt = now;
    writeCache({
      etag: res.headers.get("etag") ?? undefined,
      fetchedAt: new Date(now).toISOString(),
      index,
    });
    return index;
  } catch (err) {
    // Network failed but we have something cached: serve it rather than break.
    if (cache) {
      log.warn("[market] registry fetch failed; serving cached index", err);
      memoryIndex = cache.index;
      memoryFetchedAt = Date.parse(cache.fetchedAt) || 0;
      return cache.index;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
