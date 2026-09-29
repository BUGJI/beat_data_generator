/**
 * Framework-free locale helpers.
 *
 * Kept separate from `./index.ts` so the lightweight welcome window (which does
 * not load vue-i18n) can share the same detection / storage / lookup rules.
 */

export type Locale = "zh" | "en";

export const LOCALE_STORAGE_KEY = "bdg-locale";

export function isLocale(v: unknown): v is Locale {
  return v === "zh" || v === "en";
}

/** Persisted choice, else the OS/browser preference. */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage may be unavailable */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function rememberLocale(loc: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, loc);
  } catch {
    /* ignore */
  }
}

/** Resolve a settings preference ("auto" | "zh" | "en") into a locale. */
export function resolveLocale(pref: string | undefined): Locale {
  return isLocale(pref) ? pref : detectLocale();
}

/**
 * Pick a locale's text out of a `{ en, zh, ... }` map, or pass a plain string
 * through. Falls back to `en`, then the first available entry.
 */
export function pickLocale(
  map: string | Record<string, string> | undefined,
  loc: Locale,
): string {
  if (!map) return "";
  if (typeof map === "string") return map;
  return map[loc] || map.en || Object.values(map)[0] || "";
}
