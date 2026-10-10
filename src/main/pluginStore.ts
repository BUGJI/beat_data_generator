import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PanelLayout,
  PanelRect,
  PluginDataMap,
  PluginStoreData,
} from "../shared/pluginData";
import { handle } from "./ipcHandle";
import log from "./logger";

/**
 * Owner of `<userData>/plugin-data.json`: per-plugin key/value bags (backing
 * `api.storage`) and floating-panel geometry. Kept separate from settings.json
 * so plugin state can never corrupt or bloat user preferences.
 */

const FILE = "plugin-data.json";

let current: PluginStoreData = { data: {}, panels: {} };

function filePath(): string {
  return join(app.getPath("userData"), FILE);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asRect(v: unknown): PanelRect | null {
  if (!isPlainObject(v)) return null;
  const x = Number(v.x);
  const y = Number(v.y);
  const w = Number(v.w);
  const h = Number(v.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  return { x, y, w, h };
}

/** Repair arbitrary persisted data into a valid store (drops junk, never throws). */
function sanitize(raw: unknown): PluginStoreData {
  const out: PluginStoreData = { data: {}, panels: {} };
  if (!isPlainObject(raw)) return out;
  if (isPlainObject(raw.data)) {
    for (const [id, bag] of Object.entries(raw.data)) {
      if (id && isPlainObject(bag)) out.data[id] = { ...bag };
    }
  }
  if (isPlainObject(raw.panels)) {
    for (const [key, rect] of Object.entries(raw.panels)) {
      const r = asRect(rect);
      if (key && r) out.panels[key] = r;
    }
  }
  return out;
}

export function loadPluginData(): void {
  try {
    current = sanitize(JSON.parse(readFileSync(filePath(), "utf-8")));
  } catch {
    current = { data: {}, panels: {} };
  }
}

function persist(): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(filePath(), JSON.stringify(current, null, 2), "utf-8");
  } catch (err) {
    log.error("[plugin-store] persist failed", err);
  }
}

/** Snapshot of every plugin's data (structural clone; callers can't mutate live). */
export function getAllPluginData(): PluginDataMap {
  const out: PluginDataMap = {};
  for (const [id, bag] of Object.entries(current.data)) out[id] = { ...bag };
  return out;
}

export function setPluginData(
  id: string,
  data: Record<string, unknown>,
): boolean {
  if (typeof id !== "string" || !id) return false;
  if (isPlainObject(data)) current.data[id] = { ...data };
  else delete current.data[id];
  persist();
  return true;
}

export function getPanelLayout(): PanelLayout {
  const out: PanelLayout = {};
  for (const [key, rect] of Object.entries(current.panels)) {
    out[key] = { ...rect };
  }
  return out;
}

export function setPanelLayout(layout: PanelLayout): boolean {
  const next: PanelLayout = {};
  if (isPlainObject(layout)) {
    for (const [key, rect] of Object.entries(layout)) {
      const r = asRect(rect);
      if (key && r) next[key] = r;
    }
  }
  current.panels = next;
  persist();
  return true;
}

/** Register the plugin-store IPC handlers. Call once, after `app.whenReady`. */
export function installPluginStore(): void {
  loadPluginData();
  handle("getPluginData", () => getAllPluginData());
  handle("setPluginData", (_e, id: string, data: Record<string, unknown>) =>
    setPluginData(id, data),
  );
  handle("getPluginPanelLayout", () => getPanelLayout());
  handle("setPluginPanelLayout", (_e, layout: PanelLayout) =>
    setPanelLayout(layout),
  );
}
