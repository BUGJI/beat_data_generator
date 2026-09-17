import { describe, it, expect } from "vitest";
import { defaultSettings, sanitizeSettings } from "./settings";

describe("defaultSettings", () => {
  it("returns the documented defaults", () => {
    const s = defaultSettings();
    expect(s.closeMode).toBe("ask");
    expect(s.devEnabled).toBe(false);
    expect(s.logToFile).toBe(false);
    expect(s.followPercent).toBe(90);
    expect(s.autoSave).toBe(true);
    expect(s.autoSaveMinutes).toBe(5);
    expect(s.alignDecimals).toBe(2);
    expect(s.alignRounding).toBe("round");
    expect(s.themePreset).toBe("default");
    expect(s.themeOverrides).toEqual({});
    expect(s.settingsVersion).toBe(0);
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
    });
    expect(high.followPercent).toBe(100);
    expect(high.autoSaveMinutes).toBe(60);
    expect(high.alignDecimals).toBe(6);

    const low = sanitizeSettings({ followPercent: -5, autoSaveMinutes: 0 });
    expect(low.followPercent).toBe(0);
    expect(low.autoSaveMinutes).toBe(1);
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
});
