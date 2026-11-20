import { describe, expect, it } from "vitest";
import { resolveLocalizedText } from "./plugin";

describe("resolveLocalizedText", () => {
  it("trims a plain string into the fallback", () => {
    expect(resolveLocalizedText("  Song editor ")).toEqual({
      fallback: "Song editor",
      i18n: {},
    });
  });

  it("collects locales and prefers en, then zh", () => {
    const zh = resolveLocalizedText({ zh: "编辑器", ko: "편집기" });
    expect(zh.fallback).toBe("编辑器");
    expect(zh.i18n).toEqual({ zh: "编辑器", ko: "편집기" });

    const en = resolveLocalizedText({ zh: "编辑器", en: "Editor" });
    expect(en.fallback).toBe("Editor");
  });

  it("falls back to the first non-empty locale", () => {
    expect(resolveLocalizedText({ fr: "Éditeur" }).fallback).toBe("Éditeur");
  });

  it("ignores blank and malformed values", () => {
    expect(resolveLocalizedText("   ")).toEqual({ fallback: "", i18n: {} });
    expect(resolveLocalizedText({ en: "  ", zh: "" })).toEqual({
      fallback: "",
      i18n: {},
    });
    for (const bad of [null, undefined, 1, [], true]) {
      expect(resolveLocalizedText(bad)).toEqual({ fallback: "", i18n: {} });
    }
  });
});
