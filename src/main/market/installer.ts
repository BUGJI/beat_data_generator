import { BrowserWindow, dialog, net, type OpenDialogOptions } from "electron";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { unzipSync } from "fflate";
import { IPC } from "../../shared/ipc";
import {
  MARKET_RECEIPT,
  type MarketInstallPhase,
  type MarketInstallResult,
  type MarketProgress,
  type MarketVersionInfo,
  type PluginInstallReceipt,
} from "../../shared/market";
import log from "../logger";
import { rescanPlugins, setEnabled, userPluginsDir } from "../plugins";
import {
  findMarketPlugin,
  isCompatible,
  minAppFor,
  readReceipt,
} from "./inventory";
import {
  DOWNLOAD_TIMEOUT_MS,
  getIndex,
  isSafeId,
  proxify,
  registryUrl,
} from "./registry";

/**
 * Plugin install/uninstall: download -> verify SHA-256 -> safe unzip -> atomic
 * swap into the user plugins folder -> write an install receipt -> rescan.
 */

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5000;
const PROGRESS_STEP = 128 * 1024;

// ---- path safety ----

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
    if (!w.isDestroyed()) w.webContents.send(IPC.marketProgress, payload);
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
    const dir = dirname(target);
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

// ---- install / uninstall ----

const inFlight = new Set<string>();

export async function installPlugin(
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
export async function installLocalZip(): Promise<MarketInstallResult | null> {
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

export function uninstallPlugin(id: string): boolean {
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
