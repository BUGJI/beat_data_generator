import { describe, it, expect } from "vitest";
import {
  CONTRAST_WARN,
  contrastRatio,
  decodeTheme,
  encodeTheme,
  resolveTheme,
  themeContrastIssues,
  type ThemeOverrides,
  type ThemeSpec,
} from "./theme";

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for identical colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(
      contrastRatio("#abcdef", "#123456"),
      10,
    );
  });

  it("accepts shorthand and a missing #", () => {
    expect(contrastRatio("fff", "#FFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("000", "fff")).toBeCloseTo(21, 1);
  });
});

describe("themeContrastIssues", () => {
  it("reports text pairs below the threshold", () => {
    const spec: ThemeSpec = {
      ...resolveTheme("default", undefined),
      text: "#ffffff",
      bg: "#ffffff",
    };
    const issues = themeContrastIssues(spec);
    expect(issues.map((i) => `${i.fg}/${i.bg}`)).toContain("text/bg");
    expect(issues.every((i) => i.ratio < CONTRAST_WARN)).toBe(true);
  });

  it("returns no issues for a high-contrast black/white spec", () => {
    const base = resolveTheme("default", undefined);
    const spec: ThemeSpec = {
      ...base,
      bg: "#000000",
      panel: "#000000",
      laneBpmBg: "#000000",
      text: "#ffffff",
      textDim: "#ffffff",
      accent: "#ffffff",
      accent2: "#ffffff",
      danger: "#ffffff",
      amber: "#ffffff",
      bpm: "#ffffff",
      bpmPointSelected: "#ffffff",
    };
    expect(themeContrastIssues(spec)).toEqual([]);
  });
});

describe("theme codes", () => {
  it("round-trips a preset and its overrides", () => {
    const overrides: ThemeOverrides = { accent: "#ff8800", bg: "#010203" };
    const code = encodeTheme("midnight", overrides);
    expect(code.startsWith("BDG1-")).toBe(true);
    const decoded = decodeTheme(code);
    expect(decoded).not.toBeNull();
    expect(decoded?.presetId).toBe("midnight");
    expect(decoded?.overrides).toEqual(overrides);
  });

  it("normalizes shorthand hex and drops invalid values", () => {
    const code = encodeTheme("default", {
      accent: "#abc",
      danger: "not-a-color",
    } as ThemeOverrides);
    expect(decodeTheme(code)?.overrides).toEqual({ accent: "#aabbcc" });
  });

  it("falls back to the default preset for an unknown preset id", () => {
    const decoded = decodeTheme(encodeTheme("does-not-exist", {}));
    expect(decoded?.presetId).toBe("default");
  });

  it("rejects malformed codes", () => {
    expect(decodeTheme("")).toBeNull();
    expect(decodeTheme("nope")).toBeNull();
    expect(decodeTheme("BDG1-!!!!")).toBeNull();
  });
});
