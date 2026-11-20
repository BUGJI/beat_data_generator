import { describe, expect, it } from "vitest";
import {
  BPM_SEGMENT_BAR_ALPHA,
  BPM_SEGMENT_BAR_MIN_ALPHA,
  BPM_SEGMENT_BOUNDARY_ALPHA,
  BPM_SEGMENT_FILL_ALPHA,
  BPM_SEGMENT_FILL_MIN_ALPHA,
  bpmSegmentAlpha,
  bpmSegmentBar,
  bpmSegmentBoundary,
  bpmSegmentFill,
  bpmSegmentHsl,
  bpmSegmentTheme,
  type BpmSegmentInput,
} from "./bpmSegments";

const input = (over: Partial<BpmSegmentInput> = {}): BpmSegmentInput => ({
  beatStart: 0,
  index: 0,
  bpm: 120,
  baseBpm: 120,
  gridOverride: false,
  ...over,
});

const dark = bpmSegmentTheme("#f59e0b", "#38bdf8", "#0e1116");
const light = bpmSegmentTheme("#d97706", "#0284c7", "#f4f6f9");

describe("bpmSegmentTheme", () => {
  it("detects light and dark backgrounds", () => {
    expect(dark.light).toBe(false);
    expect(light.light).toBe(true);
  });

  it("anchors on the theme BPM and accent colors", () => {
    expect(dark.primary.h).toBeGreaterThan(20);
    expect(dark.primary.h).toBeLessThan(50);
    expect(dark.secondary.h).toBeGreaterThan(180);
    expect(dark.secondary.h).toBeLessThan(220);
    expect(dark.primary.s).toBeGreaterThan(40);
  });

  it("keeps anchors saturated but not neon", () => {
    expect(dark.primary.s).toBeLessThanOrEqual(72);
    expect(dark.secondary.s).toBeLessThanOrEqual(72);
  });

  it("separates warm same-hue anchors by lightness", () => {
    const warm = bpmSegmentTheme("#f59e0b", "#fb923c", "#14100b");
    expect(Math.abs(warm.primary.h - warm.secondary.h)).toBeLessThan(24);
    expect(warm.secondary.l - warm.primary.l).toBeGreaterThanOrEqual(14);
    expect(bpmSegmentHsl(input({ index: 0 }), warm).l).not.toBe(
      bpmSegmentHsl(input({ index: 1 }), warm).l,
    );
  });
});

describe("bpmSegmentHsl", () => {
  it("is deterministic for identical segment factors", () => {
    expect(bpmSegmentHsl(input(), dark)).toEqual(bpmSegmentHsl(input(), dark));
  });

  it("alternates between the two theme anchors by segment order", () => {
    const hues = [0, 1, 2, 3].map((index) =>
      bpmSegmentHsl(input({ index }), dark).h.toFixed(1),
    );
    expect(hues[0]).not.toBe(hues[1]);
    expect(hues[1]).not.toBe(hues[2]);
    expect(hues[2]).not.toBe(hues[3]);
    expect(hues[0]).toBe(hues[2]);
    expect(hues[1]).toBe(hues[3]);
  });

  it("alternates even when the segment starts used to hash the same way", () => {
    const hues = [0, 16, 24, 32].map((beatStart, index) =>
      bpmSegmentHsl(input({ beatStart, index }), dark).h.toFixed(1),
    );
    expect(hues[1]).not.toBe(hues[2]);
    expect(hues[2]).not.toBe(hues[3]);
  });

  it("keeps earlier colors when a later segment is appended", () => {
    const before = [0, 1, 2].map((index) =>
      bpmSegmentFill(input({ index }), dark, 55),
    );
    const after = [0, 1, 2, 3].map((index) =>
      bpmSegmentFill(input({ index }), dark, 55),
    );
    expect(after.slice(0, 3)).toEqual(before);
  });

  it("nudges hue by at most 4 degrees for a tempo change", () => {
    const base = bpmSegmentHsl(input({ beatStart: 2 }), dark);
    const faster = bpmSegmentHsl(input({ beatStart: 2, bpm: 240 }), dark);
    const slower = bpmSegmentHsl(input({ beatStart: 2, bpm: 60 }), dark);
    expect(Math.abs(faster.h - base.h)).toBeLessThanOrEqual(4);
    expect(Math.abs(slower.h - base.h)).toBeLessThanOrEqual(4);
    expect(faster.h).not.toBe(slower.h);
  });

  it("keeps light themes darker and dark themes brighter", () => {
    expect(bpmSegmentHsl(input(), light).l).toBeGreaterThanOrEqual(34);
    expect(bpmSegmentHsl(input(), light).l).toBeLessThanOrEqual(48);
    expect(bpmSegmentHsl(input(), dark).l).toBeGreaterThanOrEqual(46);
    expect(bpmSegmentHsl(input(), dark).l).toBeLessThanOrEqual(64);
  });

  it("wraps hue into the 0–360 range", () => {
    const hsl = bpmSegmentHsl(input({ beatStart: 123.5 }), dark);
    expect(hsl.h).toBeGreaterThanOrEqual(0);
    expect(hsl.h).toBeLessThan(360);
  });
});

describe("bpmSegmentAlpha", () => {
  it("maps intensity 0–100 between the min and max anchors", () => {
    expect(bpmSegmentAlpha(0, 0.02, 0.12)).toBeCloseTo(0.02);
    expect(bpmSegmentAlpha(100, 0.02, 0.12)).toBeCloseTo(0.12);
    expect(bpmSegmentAlpha(50, 0.02, 0.12)).toBeCloseTo(0.07);
  });

  it("clamps out-of-range intensity", () => {
    expect(bpmSegmentAlpha(-20, 0.02, 0.12)).toBeCloseTo(0.02);
    expect(bpmSegmentAlpha(140, 0.02, 0.12)).toBeCloseTo(0.12);
  });
});

describe("segment color strings", () => {
  it("scales the fill alpha with intensity", () => {
    const faint = bpmSegmentFill(input(), dark, 0);
    const strong = bpmSegmentFill(input(), dark, 100);
    expect(faint).toBe(bpmSegmentFill(input(), dark, 0));
    expect(faint).toContain(BPM_SEGMENT_FILL_MIN_ALPHA.toFixed(2));
    expect(strong).toContain(BPM_SEGMENT_FILL_ALPHA.toFixed(2));
  });

  it("keeps the bar visible even at intensity 0", () => {
    expect(bpmSegmentBar(input(), dark, 0)).toContain(
      (BPM_SEGMENT_BAR_MIN_ALPHA * 0.85).toFixed(2),
    );
    expect(bpmSegmentBar(input({ gridOverride: true }), dark, 100)).toContain(
      BPM_SEGMENT_BAR_ALPHA.toFixed(2),
    );
  });

  it("emphasizes override segments on the bar", () => {
    const normal = bpmSegmentBar(input(), dark, 100);
    const override = bpmSegmentBar(input({ gridOverride: true }), dark, 100);
    expect(override).not.toBe(normal);
  });

  it("uses one fixed boundary color per theme", () => {
    expect(bpmSegmentBoundary(dark)).toBe(bpmSegmentBoundary(dark));
    expect(bpmSegmentBoundary(dark)).toContain(
      BPM_SEGMENT_BOUNDARY_ALPHA.toFixed(2),
    );
  });
});
