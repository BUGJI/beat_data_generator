import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  type OpenDialogOptions,
} from "electron";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { unzipSync } from "fflate";
import log from "./logger";
import {
  isPluginEnabled,
  rescanPlugins,
  setEnabled,
  userPluginsDir,
} from "./plugins";
import { pingEndpoint } from "./network";
import {
  MARKET_RECEIPT,
  type MarketIndex,
  type MarketInstallPhase,
  type MarketInstallResult,
  type MarketPlugin,
  type MarketPluginView,
  type MarketProgress,
  type MarketVersionInfo,
  type PluginInstallReceipt,
} from "../shared/market";
import { MARKET_TTL_MS, type MarketCacheTtl } from "../shared/settings";

/**
 * Main-process plugin marketplace.
 *
 * Flow:
 *   1. fetch + cache a static registry index (JSON)
 *   2. expose it merged with local install state over IPC
 *   3. install/update = download ZIP -> verify SHA-256 -> safe unzip -> atomic
 *      swap into the user plugins folder -> write an install receipt -> rescan
 *   4. uninstall = only for receipt-managed folders (never dev/bundled roots)
 *
 * Network access lives here (the renderer has no Node privileges). Downloads
 * are strictly HTTPS and every artifact must carry a SHA-256 in the index.
 */

const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/beat-data-generator/registry/main/registry.json";
const CACHE_FILE = "market-cache.json";
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const PROGRESS_STEP = 128 * 1024;

function registryUrl(): string {
  const override = process.env.BDG_MARKET_REGISTRY;
  return override && /^https:\/\//.test(override)
    ? override
    : DEFAULT_REGISTRY_URL;
}

// ---- settings-driven network behaviour ----

interface MarketNetworkSettings {
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
function proxify(url: string): string {
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
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim())
    : [];
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
    categories: asStringArray(o.categories),
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

async function getIndex(force: boolean): Promise<MarketIndex> {
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

// ---- local install state ----

interface InstalledState {
  version: string;
  managed: boolean;
  enabled: boolean;
}

function scanInstalled(): Map<string, InstalledState> {
  const out = new Map<string, InstalledState>();
  const root = userPluginsDir();
  if (!existsSync(root)) return out;
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of names) {
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      const manifest = JSON.parse(
        readFileSync(join(dir, "manifest.json"), "utf-8"),
      ) as { id?: unknown; version?: unknown };
      const id = typeof manifest.id === "string" ? manifest.id : "";
      if (!id || out.has(id)) continue;
      const version =
        typeof manifest.version === "string" ? manifest.version : "0.0.0";
      out.set(id, {
        version,
        managed: existsSync(join(dir, MARKET_RECEIPT)),
        enabled: isPluginEnabled(id),
      });
    } catch {
      /* not a plugin folder */
    }
  }
  return out;
}

function readReceipt(id: string): PluginInstallReceipt | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(userPluginsDir(), id, MARKET_RECEIPT), "utf-8"),
    ) as PluginInstallReceipt;
    return raw && typeof raw.id === "string" ? raw : null;
  } catch {
    return null;
  }
}

// ---- version helpers ----

function parseVersion(v: string): { nums: number[]; pre: string } {
  const clean = v.replace(/^v/, "");
  const dash = clean.indexOf("-");
  const main = dash >= 0 ? clean.slice(0, dash) : clean;
  const pre = dash >= 0 ? clean.slice(dash + 1) : "";
  return { nums: main.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
}

function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

function minAppFor(p: MarketPlugin, version: string): string | undefined {
  return p.versions[version]?.minAppVersion ?? p.minAppVersion;
}

function isCompatible(p: MarketPlugin, version: string): boolean {
  const min = minAppFor(p, version);
  return !min || compareVersions(app.getVersion(), min) >= 0;
}

function resolveText(v: MarketPlugin["name"]): {
  fallback: string;
  i18n: Record<string, string>;
} {
  if (typeof v === "string" && v.trim()) {
    return { fallback: v.trim(), i18n: {} };
  }
  if (v && typeof v === "object") {
    const i18n: Record<string, string> = {};
    for (const [loc, val] of Object.entries(v)) {
      if (typeof val === "string" && val.trim()) i18n[loc] = val.trim();
    }
    return { fallback: i18n.en ?? i18n.zh ?? "", i18n };
  }
  return { fallback: "", i18n: {} };
}

// ---- path safety ----

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && id !== "..";
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeEntryName(name: string): string | null {
  if (!name || name.includes("\0")) return null;
  const norm = name.replace(/\\/g, "/").replace(/^\.\//, "");
  if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm)) return null;
  const parts = norm.split("/");
  if (parts.some((p) => p === "..")) return null;
  return norm;
}

// ---- progress ----

function emitProgress(
  id: string,
  version: string,
  phase: MarketInstallPhase,
  extra?: { received?: number; total?: number; error?: string },
): void {
  const payload: MarketProgress = { id, version, phase, ...extra };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("plugin:market:progress", payload);
  }
}

// ---- download + extract ----

async function download(
  id: string,
  version: string,
  info: MarketVersionInfo,
): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(info.url);
  } catch {
    throw new Error("invalid artifact URL");
  }
  if (parsed.protocol !== "https:")
    throw new Error("artifact URL must be HTTPS");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await net.fetch(proxify(info.url), {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const total =
      Number(res.headers.get("content-length")) || info.size || undefined;
    if (total && total > MAX_ARTIFACT_BYTES)
      throw new Error("artifact too large");
    const reader = res.body?.getReader();
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_ARTIFACT_BYTES)
        throw new Error("artifact too large");
      return buf;
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastEmit = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_ARTIFACT_BYTES) {
        await reader.cancel();
        throw new Error("artifact too large");
      }
      chunks.push(value);
      if (received - lastEmit >= PROGRESS_STEP) {
        lastEmit = received;
        emitProgress(id, version, "download", { received, total });
      }
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

function extractTo(data: Uint8Array, destDir: string): void {
  let entries = 0;
  let total = 0;
  const files = unzipSync(data, {
    filter: (f) => {
      if (f.name.endsWith("/")) return false;
      const norm = normalizeEntryName(f.name);
      if (!norm) throw new Error(`unsafe path in archive: ${f.name}`);
      if (f.originalSize > MAX_FILE_BYTES)
        throw new Error("archive entry too large");
      entries += 1;
      total += f.originalSize;
      if (entries > MAX_ARCHIVE_ENTRIES)
        throw new Error("too many archive entries");
      if (total > MAX_TOTAL_BYTES) throw new Error("archive expands too large");
      return true;
    },
  });

  // Some releases wrap the plugin in a single top-level folder; strip it so
  // manifest.json ends up at the plugin root.
  const names = Object.keys(files);
  let prefix = "";
  if (!names.includes("manifest.json")) {
    const tops = new Set(names.map((n) => n.split("/")[0]));
    if (tops.size === 1) {
      const candidate = `${[...tops][0]}/`;
      if (names.includes(`${candidate}manifest.json`)) prefix = candidate;
    }
  }
  if (!names.includes(`${prefix}manifest.json`)) {
    throw new Error("archive has no manifest.json");
  }

  mkdirSync(destDir, { recursive: true });
  for (const [rawName, bytes] of Object.entries(files)) {
    const norm = normalizeEntryName(rawName);
    if (!norm?.startsWith(prefix)) continue;
    const rel = norm.slice(prefix.length);
    if (!rel) continue;
    const target = join(destDir, rel);
    if (!isInside(destDir, target))
      throw new Error(`unsafe path in archive: ${rawName}`);
    const dir = target.slice(
      0,
      Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\")),
    );
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(target, bytes);
  }
}

/** Read id/version out of an extracted plugin's manifest.json. */
function readManifest(destDir: string): { id: string; version: string } {
  const manifest = JSON.parse(
    readFileSync(join(destDir, "manifest.json"), "utf-8"),
  ) as { id?: unknown; version?: unknown };
  return {
    id: typeof manifest.id === "string" ? manifest.id.trim() : "",
    version: typeof manifest.version === "string" ? manifest.version : "0.0.0",
  };
}

function validateManifest(destDir: string, expectedId: string): void {
  const manifest = readManifest(destDir);
  if (!manifest.id || manifest.id !== expectedId) {
    throw new Error(`manifest id mismatch (expected ${expectedId})`);
  }
}

function writeReceipt(destDir: string, receipt: PluginInstallReceipt): void {
  writeFileSync(
    join(destDir, MARKET_RECEIPT),
    JSON.stringify(receipt, null, 2),
    "utf-8",
  );
}

function swapIntoPlace(id: string, tmpDir: string): void {
  const root = userPluginsDir();
  const target = join(root, id);
  const suffix = randomBytes(4).toString("hex");
  const backup = join(root, `.backup-${id}-${suffix}`);
  const hadExisting = existsSync(target);
  if (hadExisting) renameSync(target, backup);
  try {
    renameSync(tmpDir, target);
  } catch (err) {
    if (hadExisting && !existsSync(target)) {
      try {
        renameSync(backup, target);
      } catch (restoreErr) {
        log.error("[market] restore after failed swap failed", restoreErr);
      }
    }
    throw err;
  }
  if (hadExisting) rmSync(backup, { recursive: true, force: true });
}

// ---- public surface ----

function findMarketPlugin(index: MarketIndex, id: string): MarketPlugin | null {
  return index.plugins.find((p) => p.id === id) ?? null;
}

function toView(
  p: MarketPlugin,
  installed: Map<string, InstalledState>,
): MarketPluginView {
  const local = installed.get(p.id) ?? null;
  const compatible = isCompatible(p, p.latest);
  const name = resolveText(p.name);
  const desc = resolveText(p.description);
  return {
    id: p.id,
    displayName: name.fallback || p.id,
    names: name.i18n,
    description: desc.fallback || undefined,
    descriptions: desc.i18n,
    author: p.author,
    repo: p.repo,
    homepage: p.homepage,
    categories: p.categories ?? [],
    tags: p.tags ?? [],
    latest: p.latest,
    versions: p.versions,
    installedVersion: local?.version ?? null,
    managed: local?.managed ?? false,
    enabled: local?.enabled ?? false,
    updateAvailable:
      !!local && compatible && compareVersions(p.latest, local.version) > 0,
    compatible,
    minAppVersion: minAppFor(p, p.latest),
  };
}

async function listMarket(force: boolean): Promise<MarketPluginView[]> {
  const index = await getIndex(force);
  const installed = scanInstalled();
  return index.plugins.map((p) => toView(p, installed));
}

const inFlight = new Set<string>();

async function installPlugin(
  id: string,
  version?: string,
): Promise<MarketInstallResult> {
  if (!isSafeId(id))
    return { id, version: version ?? "", ok: false, error: "invalid id" };
  if (inFlight.has(id)) {
    return {
      id,
      version: version ?? "",
      ok: false,
      error: "install already in progress",
    };
  }
  inFlight.add(id);
  let tmpDir: string | null = null;
  let target = "";
  try {
    const index = await getIndex(false);
    const plugin = findMarketPlugin(index, id);
    if (!plugin) throw new Error("plugin not found in registry");
    const ver = version || plugin.latest;
    const info = plugin.versions[ver];
    if (!info) throw new Error(`version ${ver} not published`);
    if (!isCompatible(plugin, ver)) {
      throw new Error(`requires app >= ${minAppFor(plugin, ver)}`);
    }

    target = ver;
    emitProgress(id, ver, "queued");
    const data = await download(id, ver, info);
    emitProgress(id, ver, "download", {
      received: data.byteLength,
      total: data.byteLength,
    });

    emitProgress(id, ver, "verify");
    const sha = createHash("sha256").update(data).digest("hex");
    if (sha !== info.sha256) throw new Error("checksum mismatch");

    emitProgress(id, ver, "extract");
    const root = userPluginsDir();
    mkdirSync(root, { recursive: true });
    tmpDir = join(root, `.tmp-${id}-${randomBytes(4).toString("hex")}`);
    extractTo(data, tmpDir);
    validateManifest(tmpDir, id);

    swapIntoPlace(id, tmpDir);
    tmpDir = null;
    writeReceipt(join(root, id), {
      id,
      version: ver,
      sha256: sha,
      source: registryUrl(),
      installedAt: new Date().toISOString(),
    });

    rescanPlugins();
    emitProgress(id, ver, "done");
    return { id, version: ver, ok: true };
  } catch (err) {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    const message = String(err instanceof Error ? err.message : err);
    log.error(`[market] install ${id} failed`, err);
    emitProgress(id, target || (version ?? ""), "error", { error: message });
    return { id, version: version ?? "", ok: false, error: message };
  } finally {
    inFlight.delete(id);
  }
}

/** Ask for a local .zip and install it as a plugin (no registry/checksum). */
async function installLocalZip(): Promise<MarketInstallResult | null> {
  const parent =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: OpenDialogOptions = {
    title: "Install plugin from ZIP",
    properties: ["openFile"],
    filters: [{ name: "Plugin ZIP", extensions: ["zip"] }],
  };
  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (picked.canceled || !picked.filePaths[0]) return null;

  const filePath = picked.filePaths[0];
  let tmpDir: string | null = null;
  try {
    const data = new Uint8Array(readFileSync(filePath));
    if (data.byteLength > MAX_ARTIFACT_BYTES) throw new Error("file too large");
    const sha = createHash("sha256").update(data).digest("hex");

    const root = userPluginsDir();
    mkdirSync(root, { recursive: true });
    tmpDir = join(root, `.tmp-zip-${randomBytes(4).toString("hex")}`);
    extractTo(data, tmpDir);
    const manifest = readManifest(tmpDir);
    if (!isSafeId(manifest.id)) {
      throw new Error(`invalid manifest id "${manifest.id}"`);
    }
    validateManifest(tmpDir, manifest.id);

    swapIntoPlace(manifest.id, tmpDir);
    tmpDir = null;
    writeReceipt(join(root, manifest.id), {
      id: manifest.id,
      version: manifest.version,
      sha256: sha,
      source: `file:${filePath}`,
      installedAt: new Date().toISOString(),
    });
    rescanPlugins();
    emitProgress(manifest.id, manifest.version, "done");
    return { id: manifest.id, version: manifest.version, ok: true };
  } catch (err) {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    const message = String(err instanceof Error ? err.message : err);
    log.error("[market] install from zip failed", err);
    return { id: "", version: "", ok: false, error: message };
  }
}

function uninstallPlugin(id: string): boolean {
  const root = userPluginsDir();
  const dir = join(root, id);
  if (!isSafeId(id) || !isInside(root, dir) || !existsSync(dir)) return false;
  if (!readReceipt(id)) return false; // only receipt-managed installs are removable
  try {
    setEnabled(id, false);
    rmSync(dir, { recursive: true, force: true });
    rescanPlugins();
    return true;
  } catch (err) {
    log.error(`[market] uninstall ${id} failed`, err);
    return false;
  }
}

export function installMarketManager(opts?: {
  getSettings?: () => MarketNetworkSettings;
}): void {
  if (opts?.getSettings) settingsRef = opts.getSettings;

  ipcMain.handle(
    "plugins:market:list",
    (): Promise<MarketPluginView[]> => listMarket(false),
  );

  ipcMain.handle(
    "plugins:market:refresh",
    (): Promise<MarketPluginView[]> => listMarket(true),
  );

  ipcMain.handle(
    "plugins:market:install",
    (_e, id: string, version?: string): Promise<MarketInstallResult> =>
      installPlugin(id, version),
  );

  ipcMain.handle("plugins:market:uninstall", (_e, id: string): boolean =>
    uninstallPlugin(id),
  );

  ipcMain.handle(
    "plugins:market:install-zip",
    (): Promise<MarketInstallResult | null> => installLocalZip(),
  );

  ipcMain.handle("network:ping", (_e, url: string) => pingEndpoint(url));
}
