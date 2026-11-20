import type {
  PanelLayout,
  PanelRect,
  PluginDataMap,
  PluginStoreData,
} from "../shared/pluginData";

/**
 * Pure repair/clone rules for `<userData>/plugin-data.json`. Kept free of
 * Electron and filesystem imports so the untrusted-JSON handling can be tested
 * directly.
 */

/** Per-plugin bag limits, so one plugin cannot bloat the shared file. */
export const MAX_KEYS_PER_BAG = 1_000;
export const MAX_BAG_BYTES = 1_000_000;
export const MAX_PANELS = 1_000;

/**
 * Keys that would hit `Object.prototype` setters instead of creating an own
 * property. Persisted plugin bags are untrusted JSON, so they are dropped.
 */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isSafePluginStoreKey(key: string): boolean {
  return key.length > 0 && !RESERVED_KEYS.has(key);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Null-prototype map: assigning `__proto__` can never mutate a prototype. */
export function emptyPluginDataMap(): PluginDataMap {
  return Object.create(null) as PluginDataMap;
}

export function emptyPanelLayout(): PanelLayout {
  return Object.create(null) as PanelLayout;
}

export function emptyPluginStore(): PluginStoreData {
  return { data: emptyPluginDataMap(), panels: emptyPanelLayout() };
}

/** Own-property clone of one plugin bag with reserved keys removed. */
export function clonePluginBag(
  bag: Record<string, unknown>,
): Record<string, unknown> {
  const out = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(bag)) {
    if (isSafePluginStoreKey(key)) out[key] = value;
  }
  return out;
}

export function bagWithinLimits(bag: Record<string, unknown>): boolean {
  return (
    Object.keys(bag).length <= MAX_KEYS_PER_BAG &&
    JSON.stringify(bag).length <= MAX_BAG_BYTES
  );
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
export function sanitizePluginStore(raw: unknown): PluginStoreData {
  const out = emptyPluginStore();
  if (!isPlainObject(raw)) return out;
  if (isPlainObject(raw.data)) {
    for (const [id, bag] of Object.entries(raw.data)) {
      if (!isSafePluginStoreKey(id) || !isPlainObject(bag)) continue;
      if (!bagWithinLimits(bag)) continue;
      out.data[id] = clonePluginBag(bag);
    }
  }
  if (isPlainObject(raw.panels)) {
    let count = 0;
    for (const [key, rect] of Object.entries(raw.panels)) {
      if (count >= MAX_PANELS) break;
      const r = asRect(rect);
      if (isSafePluginStoreKey(key) && r) {
        out.panels[key] = r;
        count++;
      }
    }
  }
  return out;
}

/** Repair an IPC-supplied panel layout (same rules as the persisted form). */
export function sanitizePanelLayout(raw: unknown): PanelLayout {
  const out = emptyPanelLayout();
  if (!isPlainObject(raw)) return out;
  let count = 0;
  for (const [key, rect] of Object.entries(raw)) {
    if (count >= MAX_PANELS) break;
    const r = asRect(rect);
    if (isSafePluginStoreKey(key) && r) {
      out[key] = r;
      count++;
    }
  }
  return out;
}
