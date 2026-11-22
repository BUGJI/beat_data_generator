import { describe, expect, it } from "vitest";
import { defaultSettings, sanitizeSettings } from "../../../shared/settings";
import {
  activePerformancePreset,
  matchesPerformancePreset,
  PERFORMANCE_PRESETS,
} from "./performancePresets";

function withPreset(id: keyof typeof PERFORMANCE_PRESETS) {
  return sanitizeSettings({
    ...defaultSettings(),
    ...PERFORMANCE_PRESETS[id],
  });
}

describe("performance presets", () => {
  it("round-trips every bundle through the schema", () => {
    for (const id of ["standard", "light"] as const) {
      const settings = withPreset(id);
      expect(matchesPerformancePreset(settings, id)).toBe(true);
      expect(activePerformancePreset(settings)).toBe(id);
    }
  });

  it("leaves audio and click settings alone", () => {
    const base = defaultSettings();
    const light = withPreset("light");
    expect(light.metronomeVolume).toBe(base.metronomeVolume);
    expect(light.beatOverlap).toBe(base.beatOverlap);
    expect(light.beatAccent).toBe(base.beatAccent);
    expect(light.beatAccentGain).toBe(base.beatAccentGain);
    expect(light.outputProtection).toBe(base.outputProtection);
    expect(light.gridMetronome).toBe(base.gridMetronome);
    expect(light.countInBars).toBe(base.countInBars);
  });

  it("light disables glow/bloom and full enables them", () => {
    const light = withPreset("light");
    expect(light.beatFxMaster).toBe(false);
    expect(light.beatFx.laneGlow).toBe(false);
    expect(light.beatFx.markerFlash).toBe(false);
    expect(light.beatFxDensity).toBe("light");
    expect(light.beatPulse).toBe(true);

    const standard = withPreset("standard");
    expect(standard.beatFxMaster).toBe(true);
    expect(standard.beatFx.laneGlow).toBe(true);
    expect(standard.beatFx.markerFlash).toBe(true);
    expect(standard.beatFxDensity).toBe("full");
  });

  it("reports no preset after a manual edit", () => {
    const edited = { ...withPreset("light"), animEnabled: true };
    expect(activePerformancePreset(edited)).toBeNull();
  });
});
