import type { SettingsData } from "@shared/settings";

export type PerformancePresetId = "standard" | "light";

/**
 * One-click performance bundles. Audio, grid metronome and marker clicks are
 * intentionally untouched; only visual cost changes.
 */
export const PERFORMANCE_PRESETS: Record<
  PerformancePresetId,
  Partial<SettingsData>
> = {
  standard: {
    beatFxMaster: true,
    beatFx: { laneGlow: true, markerFlash: true },
    beatPulse: true,
    beatFxDensity: "full",
    followSmooth: true,
    animEnabled: true,
  },
  light: {
    beatFxMaster: false,
    beatFx: { laneGlow: false, markerFlash: false },
    beatPulse: true,
    beatFxDensity: "light",
    followSmooth: false,
    animEnabled: false,
  },
};

/** Whether the current settings correspond exactly to a preset bundle. */
export function matchesPerformancePreset(
  s: SettingsData,
  id: PerformancePresetId,
): boolean {
  if (id === "light") {
    return (
      !s.beatFxMaster &&
      !s.beatFx.laneGlow &&
      !s.beatFx.markerFlash &&
      s.beatPulse &&
      s.beatFxDensity === "light" &&
      !s.followSmooth &&
      !s.animEnabled
    );
  }
  return (
    s.beatFxMaster &&
    s.beatFx.laneGlow === true &&
    s.beatFx.markerFlash === true &&
    s.beatPulse &&
    s.beatFxDensity === "full" &&
    s.followSmooth &&
    s.animEnabled
  );
}

/** The preset the current settings match, or null after manual edits. */
export function activePerformancePreset(
  s: SettingsData,
): PerformancePresetId | null {
  if (matchesPerformancePreset(s, "light")) return "light";
  if (matchesPerformancePreset(s, "standard")) return "standard";
  return null;
}
