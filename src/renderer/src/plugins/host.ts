import { reactive } from "vue";
import type { PluginEntry } from "../../../shared/plugin";

/**
 * Renderer-side plugin host.
 *
 * It loads the editor page copy of every enabled plugin that ships a
 * renderer.js. renderer.js is a plain script that self-registers by calling
 *
 *   window.__bdgPluginRegister(function activate(api) {
 *     // api = { id, dir, log }
 *     return function dispose() { ... }   // optional
 *   })
 *
 * Contributions registered by a plugin live in the UI contribution registry
 * (see registry.ts) which the editor chrome renders from.
 */

export interface RendererPluginApi {
  id: string;
  dir: string;
  version: string;
  log: (...args: unknown[]) => void;
}

type Activate = (api: RendererPluginApi) => void | (() => void);

interface ActiveRenderer {
  dispose?: () => void;
}

export const pluginEntries = reactive<PluginEntry[]>([]);

const actives = new Map<string, ActiveRenderer>();
let bound = false;

declare global {
  interface Window {
    __bdgPluginRegister?: (activate: Activate) => void;
  }
}

function locale(): string {
  return document.documentElement.lang || "en";
}

export function pluginName(entry: PluginEntry): string {
  return entry.names?.[locale()] || entry.displayName || entry.id;
}

export function pluginDescription(entry: PluginEntry): string | undefined {
  return entry.descriptions?.[locale()] || entry.description;
}

async function loadRenderer(entry: PluginEntry): Promise<void> {
  if (!entry.enabled || !entry.renderer) return;
  if (actives.has(entry.id)) return;
  const src = await window.api.readPluginRenderer(entry.id);
  if (src == null) return;
  let pending: Activate | null = null;
  const prev = window.__bdgPluginRegister;
  window.__bdgPluginRegister = (activate: Activate) => {
    pending = activate;
  };
  try {
    const run = new Function(
      "window",
      `"use strict";\n${src}\n`,
    ) as (win: Window) => void;
    run(window);
  } catch (err) {
    console.error(`[plugins] renderer load failed for ${entry.id}`, err);
    return;
  } finally {
    window.__bdgPluginRegister = prev;
  }
  if (typeof pending !== "function") {
    console.warn(`[plugins] ${entry.id} renderer.js never called __bdgPluginRegister`);
    return;
  }
  try {
    const activate = pending as Activate;
    const ret = activate({
      id: entry.id,
      dir: entry.dir,
      version: entry.version,
      log: (...args: unknown[]) => console.log(`[plugin:${entry.id}]`, ...args),
    });
    actives.set(entry.id, {
      dispose: typeof ret === "function" ? ret : undefined,
    });
  } catch (err) {
    console.error(`[plugins] activate failed for ${entry.id}`, err);
  }
}

function disposeRenderer(id: string): void {
  const a = actives.get(id);
  if (!a) return;
  try {
    a.dispose?.();
  } catch (err) {
    console.error(`[plugins] dispose error for ${id}`, err);
  }
  actives.delete(id);
}

function replaceEntries(list: PluginEntry[]): void {
  for (const id of [...actives.keys()]) {
    const next = list.find((e) => e.id === id);
    if (!next || !next.enabled || !next.renderer) {
      disposeRenderer(id);
    }
  }
  pluginEntries.splice(0, pluginEntries.length, ...list);
  for (const entry of list) {
    if (entry.enabled && entry.renderer) void loadRenderer(entry);
  }
}

export async function refreshPlugins(): Promise<void> {
  try {
    const list = await window.api.listPlugins();
    replaceEntries(list);
  } catch (err) {
    console.error("[plugins] list failed", err);
  }
}

export async function setPluginEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  try {
    const list = await window.api.setPluginEnabled(id, enabled);
    replaceEntries(list);
  } catch (err) {
    console.error(`[plugins] set-enabled failed for ${id}`, err);
  }
}

export async function reloadPlugins(): Promise<void> {
  try {
    const list = await window.api.reloadPlugins();
    replaceEntries(list);
  } catch (err) {
    console.error("[plugins] reload failed", err);
  }
}

export async function initPlugins(): Promise<void> {
  if (bound) return;
  bound = true;
  window.api.onPluginsChanged(() => {
    void refreshPlugins();
  });
  await refreshPlugins();
}

export { locale };
