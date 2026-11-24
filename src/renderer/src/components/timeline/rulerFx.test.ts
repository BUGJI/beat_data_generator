import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "../../stores/settings";
import {
  noteRulerTier,
  resetRulerTier,
  rulerTierActive,
  rulerTierFrame,
} from "./rulerFx";

beforeEach(() => {
  setActivePinia(createPinia());
  resetRulerTier();
});

describe("rulerFx", () => {
  it("initializes without animating", () => {
    expect(noteRulerTier(1, 0, 0)).toBe(false);
    expect(rulerTierActive(0)).toBe(false);
    expect(rulerTierFrame(0).progress).toBe(1);
  });

  it("animates a tier change and then settles", () => {
    noteRulerTier(1, 0, 0);
    expect(noteRulerTier(0.5, 1, 1000)).toBe(true);
    const mid = rulerTierFrame(1075);
    expect(mid.active).toBe(true);
    expect(mid.progress).toBeGreaterThan(0);
    expect(mid.progress).toBeLessThan(1);
    expect(mid.fromStepSec).toBe(1);
    expect(mid.toStepSec).toBe(0.5);
    expect(rulerTierActive(1075)).toBe(true);
    expect(rulerTierActive(1150)).toBe(false);
    expect(rulerTierFrame(1150).progress).toBe(1);
  });

  it("switches instantly when editor animation is off", () => {
    useSettingsStore().settings.animEnabled = false;
    noteRulerTier(1, 0, 0);
    expect(noteRulerTier(0.5, 1, 100)).toBe(false);
    const frame = rulerTierFrame(100);
    expect(frame.active).toBe(false);
    expect(frame.progress).toBe(1);
    expect(frame.toStepSec).toBe(0.5);
  });
});
