import { describe, expect, it } from "vitest";
import {
  barInfoAt,
  barStartsInRange,
  beatAtBarStart,
  beatsPerBarAt,
  buildMeterSegments,
  isBarStartAt,
  meterInfoAt,
  normalizeBeatsPerBar,
} from "./meter";
import type { BpmPoint } from "./types";

const point = (beat: number, beatsPerBar?: number): BpmPoint => ({
  id: `p${beat}`,
  beat,
  mode: "abs",
  value: 120,
  ...(beatsPerBar === undefined ? {} : { beatsPerBar }),
});

describe("buildMeterSegments", () => {
  it("uses one segment for the global meter", () => {
    expect(buildMeterSegments(4, [])).toEqual([
      {
        beatStart: 0,
        beatEnd: null,
        beatsPerBar: 4,
        override: false,
        barStart: 0,
      },
    ]);
  });

  it("starts an override segment at its BPM point", () => {
    expect(buildMeterSegments(4, [point(8, 3), point(20, 6)])).toEqual([
      {
        beatStart: 0,
        beatEnd: 8,
        beatsPerBar: 4,
        override: false,
        barStart: 0,
      },
      {
        beatStart: 8,
        beatEnd: 20,
        beatsPerBar: 3,
        override: true,
        barStart: 2,
      },
      {
        beatStart: 20,
        beatEnd: null,
        beatsPerBar: 6,
        override: true,
        barStart: 6,
      },
    ]);
  });

  it("inherits across points that do not set a meter", () => {
    expect(buildMeterSegments(4, [point(4), point(8, 3), point(12)])).toEqual([
      {
        beatStart: 0,
        beatEnd: 8,
        beatsPerBar: 4,
        override: false,
        barStart: 0,
      },
      {
        beatStart: 8,
        beatEnd: null,
        beatsPerBar: 3,
        override: true,
        barStart: 2,
      },
    ]);
  });

  it("merges an override equal to the current meter", () => {
    expect(buildMeterSegments(4, [point(4, 4), point(8, 3)])).toEqual([
      {
        beatStart: 0,
        beatEnd: 8,
        beatsPerBar: 4,
        override: false,
        barStart: 0,
      },
      {
        beatStart: 8,
        beatEnd: null,
        beatsPerBar: 3,
        override: true,
        barStart: 2,
      },
    ]);
  });
});

describe("bar math across meter changes", () => {
  const segments = buildMeterSegments(4, [point(8, 3), point(20, 6)]);

  it("numbers bars continuously through a meter change", () => {
    expect(barInfoAt(segments, 0)).toMatchObject({
      bar: 1,
      inBar: 0,
      beatsPerBar: 4,
    });
    expect(barInfoAt(segments, 6)).toMatchObject({
      bar: 2,
      inBar: 2,
      beatsPerBar: 4,
    });
    expect(barInfoAt(segments, 8)).toMatchObject({
      bar: 3,
      inBar: 0,
      beatsPerBar: 3,
    });
    expect(barInfoAt(segments, 11)).toMatchObject({
      bar: 4,
      inBar: 0,
      beatsPerBar: 3,
    });
    expect(barInfoAt(segments, 20)).toMatchObject({
      bar: 7,
      inBar: 0,
      beatsPerBar: 6,
    });
  });

  it("maps a bar number back to its start beat", () => {
    expect(beatAtBarStart(segments, 1)).toBe(0);
    expect(beatAtBarStart(segments, 3)).toBe(8);
    expect(beatAtBarStart(segments, 4)).toBe(11);
    expect(beatAtBarStart(segments, 7)).toBe(20);
    expect(beatAtBarStart(segments, 8)).toBe(26);
  });

  it("reports bar starts and the active meter", () => {
    expect(isBarStartAt(segments, 8)).toBe(true);
    expect(isBarStartAt(segments, 9)).toBe(false);
    expect(beatsPerBarAt(segments, 9)).toBe(3);
    expect(meterInfoAt(segments, 20)).toEqual({
      beatsPerBar: 6,
      override: true,
    });
  });

  it("lists bar lines inside a beat range", () => {
    expect(barStartsInRange(segments, 0, 12)).toEqual([
      { beat: 0, bar: 1 },
      { beat: 4, bar: 2 },
      { beat: 8, bar: 3 },
      { beat: 11, bar: 4 },
    ]);
  });
});

describe("normalizeBeatsPerBar", () => {
  it("rounds and clamps to 1..16", () => {
    expect(normalizeBeatsPerBar(4)).toBe(4);
    expect(normalizeBeatsPerBar("3")).toBe(3);
    expect(normalizeBeatsPerBar(2.6)).toBe(3);
    expect(normalizeBeatsPerBar(0)).toBe(1);
    expect(normalizeBeatsPerBar(99)).toBe(16);
    expect(normalizeBeatsPerBar(Number.NaN)).toBe(4);
  });
});
