import { reactive } from "vue";
import type { PluginEntry } from "../../../shared/plugin";
import { createPluginApi, type PluginApi } from "./api";
import { dispatchShortcut } from "./registry";

/**
 * Renderer-side plugin host.
 *
 * It loads the editor page copy of every enabled plugin that ships a
 * renderer.js. renderer.js is a plain script that self-registers by calling
 *
 *   window.__bdgPluginRegister(function activate(api) {
 *     return function dispose() { ... }   // optional
 *   })
 *
 * `api` is the full plugin bridge (data/editing/player/events/ui/system).
 * Contributions are unregistered automatically on dispose/reload.
 */

type Activate = (api: PluginApi) => void | (() => void);

interface ActiveRenderer {
  dispose?: () => void;
  finalize: () => void;
}

export const pluginEntries = reactive<PluginEntry[]>([]);

const actives = new Map<string, ActiveRenderer>();
const loading = new Set<string>();
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
  if (actives.has(entry.id) || loading.has(entry.id)) return;
  loading.add(entry.id);
  try {
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
      console.warn(
        `[plugins] ${entry.id} renderer.js never called __bdgPluginRegister`,
      );
      return;
    }
    const activate = pending as Activate;
    const { api, finalize } = createPluginApi({
      id: entry.id,
      version: entry.version,
      dir: entry.dir,
    });
    let ret: (() => void) | undefined;
    try {
      const r = activate(api) as void | (() => void);
      ret = typeof r === "function" ? r : undefined;
    } catch (err) {
      // activate() threw partway through mounting; clean up any contributions
      // that were already registered so nothing leaks.
      console.error(
        `[plugins] activate() threw for ${entry.id}; contributions were cleaned up`,
        err,
      );
      try {
        finalize();
      } catch {
        /* ignore */
      }
      return;
    }
    actives.set(entry.id, { dispose: ret, finalize });
    // the plugin may have been disabled while the source was loading
    const stillEnabled = pluginEntries.some(
      (e) => e.id === entry.id && e.enabled && !!e.renderer,
    );
    if (!stillEnabled) disposeRenderer(entry.id);
  } finally {
    loading.delete(entry.id);
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
  try {
    a.finalize();
  } catch (err) {
    console.error(`[plugins] finalize error for ${id}`, err);
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
  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement) {
        const tag = el.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          el.isContentEditable
        ) {
          return;
        }
      }
      if (dispatchShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  window.api.onPluginsChanged(() => {
    void refreshPlugins();
  });
  await refreshPlugins();
}

export { locale };
