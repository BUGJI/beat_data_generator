import { describe, expect, it } from "vitest";
import en from "./en";

/**
 * Guard against `t("...")` calls that reference a key the catalog does not
 * define. Only static string literals are checked; template/computed keys are
 * skipped on purpose. Sources are pulled in raw so the check needs no Node fs.
 */

const SOURCES = import.meta.glob("../**/*.{ts,vue}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const KEY_CALL = /\b\$?t\(\s*["'`]([^"'`]+)["'`]/g;

function leafKeys(obj: Record<string, unknown>, prefix = ""): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v))
      for (const leaf of leafKeys(v as Record<string, unknown>, key))
        out.add(leaf);
    else out.add(key);
  }
  return out;
}

describe("i18n key usage", () => {
  it('every literal t("...") key exists in the catalog', () => {
    const known = leafKeys(en as Record<string, unknown>);
    const missing = new Map<string, string>();
    for (const [path, src] of Object.entries(SOURCES)) {
      if (path.includes("/i18n/") || path.endsWith(".test.ts")) continue;
      for (const m of src.matchAll(KEY_CALL)) {
        const key = m[1];
        if (key.includes("${")) continue;
        if (!known.has(key)) missing.set(key, path);
      }
    }
    expect([...missing.entries()]).toEqual([]);
  });
});
