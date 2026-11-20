import { app } from "electron";
import { join } from "node:path";
import type {
  PanelLayout,
  PluginDataMap,
  PluginStoreData,
} from "../shared/pluginData";
import { handle } from "./ipcHandle";
import { readJson, writeJsonAtomic } from "./jsonStore";
import {
  bagWithinLimits,
  clonePluginBag,
  emptyPanelLayout,
  emptyPluginDataMap,
  emptyPluginStore,
  isPlainObject,
  isSafePluginStoreKey,
  sanitizePanelLayout,
  sanitizePluginStore,
} from "./pluginDataSanitize";

/**
 * Owner of `<userData>/plugin-data.json`: per-plugin key/value bags (backing
 * `api.storage`) and floating-panel geometry. Kept separate from settings.json
 * so plugin state can never corrupt or bloat user preferences.
 *
 * The file and the IPC payloads are untrusted: all repair/clone rules live in
 * `pluginDataSanitize.ts` and use null-prototype maps so `__proto__` keys
 * cannot mutate `Object.prototype`.
 */

const FILE = "plugin-data.json";

let current: PluginStoreData = emptyPluginStore();

function filePath(): string {
  return join(app.getPath("userData"), FILE);
}

export function loadPluginData(): void {
  current = sanitizePluginStore(readJson(filePath(), () => null));
}

function persist(): void {
  writeJsonAtomic(filePath(), current);
}

/** Snapshot of every plugin's data (structural clone; callers can't mutate live). */
export function getAllPluginData(): PluginDataMap {
  const out = emptyPluginDataMap();
  for (const [id, bag] of Object.entries(current.data)) {
    out[id] = clonePluginBag(bag);
  }
  return out;
}

export function setPluginData(
  id: string,
  data: Record<string, unknown>,
): boolean {
  if (typeof id !== "string" || !isSafePluginStoreKey(id)) return false;
  if (isPlainObject(data)) {
    if (!bagWithinLimits(data)) return false;
    current.data[id] = clonePluginBag(data);
  } else {
    delete current.data[id];
  }
  persist();
  return true;
}

export function getPanelLayout(): PanelLayout {
  const out = emptyPanelLayout();
  for (const [key, rect] of Object.entries(current.panels)) {
    out[key] = { ...rect };
  }
  return out;
}

export function setPanelLayout(layout: PanelLayout): boolean {
  current.panels = sanitizePanelLayout(layout);
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
