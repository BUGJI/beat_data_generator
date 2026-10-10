import type { PluginDataMap } from "@shared/pluginData";

/**
 * Renderer-side cache of the main-process plugin store. Loaded once before any
 * plugin activates so `api.storage` can be synchronous (like localStorage) while
 * still persisting to a real file. Writes are coalesced per plugin.
 */

let cache: PluginDataMap = {};

export async function loadPluginStorage(): Promise<void> {
  try {
    cache = (await window.api.getPluginData()) ?? {};
  } catch {
    cache = {};
  }
}

export interface PluginStorage {
  /** Read a value; returns `def` when the key is absent. */
  get: <T = unknown>(key: string, def?: T) => T;
  /** Write a value (persisted shortly after; coalesced with other writes). */
  set: (key: string, value: unknown) => void;
  /** Delete a key. */
  remove: (key: string) => void;
  /** Shallow copy of the whole bag. */
  all: () => Record<string, unknown>;
  /** Delete every key in this plugin's bag. */
  clear: () => void;
}

const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush(id: string): void {
  void window.api.setPluginData(id, { ...(cache[id] ?? {}) });
}

function schedule(id: string): void {
  pending.add(id);
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const ids = [...pending];
    pending.clear();
    for (const pid of ids) flush(pid);
  }, 150);
}

/** Persist a plugin's pending writes immediately (call on disable/dispose). */
export function flushPluginStorage(id: string): void {
  if (!pending.has(id)) return;
  pending.delete(id);
  flush(id);
}

export function pluginStorageFor(id: string): PluginStorage {
  const bag = (): Record<string, unknown> => {
    if (!cache[id]) cache[id] = {};
    return cache[id]!;
  };
  return {
    get: <T = unknown>(key: string, def?: T): T => {
      const b = bag();
      return key in b ? (b[key] as T) : (def as T);
    },
    set: (key, value) => {
      bag()[key] = value;
      schedule(id);
    },
    remove: (key) => {
      delete bag()[key];
      schedule(id);
    },
    all: () => ({ ...bag() }),
    clear: () => {
      cache[id] = {};
      schedule(id);
    },
  };
}
