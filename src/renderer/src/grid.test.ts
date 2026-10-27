import { describe, expect, it } from "vitest";
import {
  buildGridSegments,
  gridDivAt,
  normalizeGridDiv,
  parseGridDenominator,
} from "./grid";
import type { BpmPoint } from "./types";

const point = (beat: number, gridDiv?: number): BpmPoint => ({
  id: `p${beat}`,
  beat,
  mode: "abs",
  value: 120,
  ...(gridDiv === undefined ? {} : { gridDiv }),
});

describe("buildGridSegments", () => {
  it("uses one segment for the global division", () => {
    expect(buildGridSegments(4, [])).toEqual([
      { beatStart: 0, beatEnd: null, div: 4, override: false },
    ]);
  });

  it("starts an override segment at its BPM point", () => {
    expect(buildGridSegments(4, [point(8, 16), point(16, 8)])).toEqual([
      { beatStart: 0, beatEnd: 8, div: 4, override: false },
      { beatStart: 8, beatEnd: 16, div: 16, override: true },
      { beatStart: 16, beatEnd: null, div: 8, override: true },
    ]);
  });

  it("inherits across points that do not set a grid", () => {
    expect(buildGridSegments(4, [point(4), point(8, 8), point(12)])).toEqual([
      { beatStart: 0, beatEnd: 8, div: 4, override: false },
      { beatStart: 8, beatEnd: null, div: 8, override: true },
    ]);
  });

  it("merges an override equal to the current division", () => {
    expect(buildGridSegments(4, [point(4, 4), point(8, 8)])).toEqual([
      { beatStart: 0, beatEnd: 8, div: 4, override: false },
      { beatStart: 8, beatEnd: null, div: 8, override: true },
    ]);
  });

  it("ignores invalid and non-positive points", () => {
    expect(
      buildGridSegments(4, [
        point(0, 16),
        point(-2, 16),
        point(4, Number.NaN),
        point(8, 0),
        point(12, 8),
      ]),
    ).toEqual([
      { beatStart: 0, beatEnd: 12, div: 4, override: false },
      { beatStart: 12, beatEnd: null, div: 8, override: true },
    ]);
  });
});

describe("gridDivAt", () => {
  const segments = buildGridSegments(4, [point(8, 16), point(16, 8)]);

  it("looks up the segment covering the beat", () => {
    expect(gridDivAt(segments, -1)).toBe(4);
    expect(gridDivAt(segments, 7.999)).toBe(4);
    expect(gridDivAt(segments, 8)).toBe(16);
    expect(gridDivAt(segments, 15.999)).toBe(16);
    expect(gridDivAt(segments, 16)).toBe(8);
    expect(gridDivAt(segments, 1000)).toBe(8);
  });

  it("falls back to the default when empty", () => {
    expect(gridDivAt([], 8)).toBe(4);
  });
});

describe("grid division parsing", () => {
  it("normalizes positive values and falls back otherwise", () => {
    expect(normalizeGridDiv(8)).toBe(8);
    expect(normalizeGridDiv("8")).toBe(8);
    expect(normalizeGridDiv(0)).toBe(4);
    expect(normalizeGridDiv(-1)).toBe(4);
    expect(normalizeGridDiv(Number.NaN)).toBe(4);
  });

  it("parses presets, custom denominators and 1/N input", () => {
    expect(parseGridDenominator(8)).toBe(8);
    expect(parseGridDenominator("8")).toBe(8);
    expect(parseGridDenominator("1/16")).toBe(16);
    expect(parseGridDenominator(" 1/3 ")).toBe(3);
    expect(parseGridDenominator("0")).toBeNull();
    expect(parseGridDenominator("abc")).toBeNull();
    expect(parseGridDenominator("1/0")).toBeNull();
  });
});
