import { describe, it, expect } from "vitest";
import {
  defaultSettings,
  migrateSettings,
  sanitizeSettings,
  SETTINGS_VERSION,
} from "./settings";

describe("defaultSettings", () => {
  it("returns the documented defaults", () => {
    const s = defaultSettings();
    expect(s.closeMode).toBe("ask");
    expect(s.devEnabled).toBe(false);
    expect(s.logToFile).toBe(false);
    expect(s.stretchEngine).toBe("signalsmith");
    expect(s.followPercent).toBe(90);
    expect(s.autoSave).toBe(true);
    expect(s.autoSaveMinutes).toBe(5);
    expect(s.alignDecimals).toBe(2);
    expect(s.alignRounding).toBe("round");
    expect(s.uiZoom).toBe(100);
    expect(s.uiFontScale).toBe(100);
    expect(s.uiBlur).toBe(true);
    expect(s.uiBlurAmount).toBe(3);
    expect(s.uiRadius).toBe(6);
    expect(s.uiShadow).toBe(50);
    expect(s.themePreset).toBe("default");
    expect(s.themeOverrides).toEqual({});
    expect(s.settingsVersion).toBe(0);
    expect(s.marketCacheTtl).toBe("3d");
    expect(s.proxyMode).toBe("system");
    expect(s.githubProxy).toBe(false);
    expect(s.githubProxyHost).toBe("ghfast.top");
    expect(s.backgroundImage).toBe("");
    expect(s.backgroundFit).toBe("cover");
    expect(s.backgroundDim).toBe(0);
    expect(s.backgroundBlur).toBe(0);
    expect(s.surfaceOpacity).toBe(90);
  });
});

describe("sanitizeSettings", () => {
  it("repairs non-object input into defaults", () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    expect(sanitizeSettings("x")).toEqual(defaultSettings());
    expect(sanitizeSettings([])).toEqual(defaultSettings());
  });

  it("clamps numeric ranges", () => {
    const high = sanitizeSettings({
      followPercent: 250,
      autoSaveMinutes: 999,
      alignDecimals: 99,
      uiBlurAmount: 99,
      uiRadius: 99,
      uiShadow: 999,
    });
    expect(high.followPercent).toBe(100);
    expect(high.autoSaveMinutes).toBe(60);
    expect(high.alignDecimals).toBe(6);
    expect(high.uiBlurAmount).toBe(24);
    expect(high.uiRadius).toBe(20);
    expect(high.uiShadow).toBe(100);

    const low = sanitizeSettings({ followPercent: -5, autoSaveMinutes: 0 });
    expect(low.followPercent).toBe(0);
    expect(low.autoSaveMinutes).toBe(1);
  });

  it("bypasses numeric ranges under free input", () => {
    const s = sanitizeSettings({
      devFreeInput: true,
      followPercent: -5,
      autoSaveMinutes: -3,
      alignDecimals: -2,
    });
    expect(s.followPercent).toBe(-5);
    expect(s.autoSaveMinutes).toBe(-3);
    expect(s.alignDecimals).toBe(-2);
    // the flag must not leak into later parses
    expect(sanitizeSettings({ followPercent: -5 }).followPercent).toBe(0);
  });

  it("falls back for invalid enums and non-boolean flags", () => {
    const s = sanitizeSettings({
      closeMode: "nope",
      alignRounding: "down",
      devEnabled: "yes",
      autoSave: 0,
    });
    expect(s.closeMode).toBe("ask");
    expect(s.alignRounding).toBe("round");
    expect(s.devEnabled).toBe(false);
    expect(s.autoSave).toBe(true);
  });

  it("strips unknown keys but keeps known ones", () => {
    const s = sanitizeSettings({
      hacker: true,
      themePreset: "midnight",
    }) as Record<string, unknown>;
    expect("hacker" in s).toBe(false);
    expect(s.themePreset).toBe("midnight");
  });

  it("keeps only string-valued theme overrides", () => {
    const s = sanitizeSettings({
      themeOverrides: { a: "#fff", b: 1, c: null },
    });
    expect(s.themeOverrides).toEqual({ a: "#fff" });
  });

  it("coerces settingsVersion and repairs an empty theme preset", () => {
    const s = sanitizeSettings({ settingsVersion: "2", themePreset: "" });
    expect(s.settingsVersion).toBe(2);
    expect(s.themePreset).toBe("default");
  });

  it("keeps a valid stretch engine and repairs an unknown one", () => {
    expect(
      sanitizeSettings({ stretchEngine: "soundtouch" }).stretchEngine,
    ).toBe("soundtouch");
    expect(sanitizeSettings({ stretchEngine: "nope" }).stretchEngine).toBe(
      "signalsmith",
    );
  });

  it("validates marketplace cache TTL and proxy settings", () => {
    expect(sanitizeSettings({ marketCacheTtl: "7d" }).marketCacheTtl).toBe(
      "7d",
    );
    expect(sanitizeSettings({ marketCacheTtl: "1y" }).marketCacheTtl).toBe(
      "3d",
    );
    expect(sanitizeSettings({ proxyMode: "env" }).proxyMode).toBe("env");
    expect(sanitizeSettings({ proxyMode: "tor" }).proxyMode).toBe("system");
    expect(sanitizeSettings({ githubProxy: "on" }).githubProxy).toBe(false);
  });

  it("validates background image settings", () => {
    const s = sanitizeSettings({
      backgroundImage: "  C:/pics/bg.png  ",
      backgroundFit: "contain",
      backgroundDim: 999,
      backgroundBlur: -5,
      surfaceOpacity: 5,
    });
    expect(s.backgroundImage).toBe("C:/pics/bg.png");
    expect(s.backgroundFit).toBe("contain");
    expect(s.backgroundDim).toBe(100);
    expect(s.backgroundBlur).toBe(0);
    expect(s.surfaceOpacity).toBe(20);
    expect(sanitizeSettings({ backgroundFit: "nope" }).backgroundFit).toBe(
      "cover",
    );
  });

  it("trims a trailing slash from the gh-proxy host", () => {
    expect(
      sanitizeSettings({ githubProxyHost: "https://ghfast.top/" })
        .githubProxyHost,
    ).toBe("https://ghfast.top");
    expect(sanitizeSettings({ githubProxy: true }).githubProxy).toBe(true);
  });
});

describe("migrateSettings", () => {
  it("resets v1 analysis toggles and stamps the current version", () => {
    const { data, changed } = migrateSettings({
      settingsVersion: 1,
      audioAutoBeats: true,
      audioAutoBpm: false,
      audioLoopDetect: true,
    });
    expect(changed).toBe(true);
    expect(data.settingsVersion).toBe(SETTINGS_VERSION);
    expect(data.audioAutoBpm).toBe(true);
    expect(data.audioAutoBeats).toBe(false);
    expect(data.audioLoopDetect).toBe(false);
  });

  it("reports no change when already at the current version", () => {
    const { changed } = migrateSettings({ settingsVersion: SETTINGS_VERSION });
    expect(changed).toBe(false);
  });

  it("treats a missing version as needing migration", () => {
    const { data, changed } = migrateSettings({});
    expect(changed).toBe(true);
    expect(data.settingsVersion).toBe(SETTINGS_VERSION);
  });

  it("does not mutate the input object", () => {
    const raw = { settingsVersion: 1, audioAutoBeats: true };
    migrateSettings(raw);
    expect(raw).toEqual({ settingsVersion: 1, audioAutoBeats: true });
  });
});
