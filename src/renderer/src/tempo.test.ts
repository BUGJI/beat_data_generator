import { describe, it, expect } from "vitest";
import {
  BPM_MAX,
  BPM_MIN,
  buildTempoMap,
  clampBpm,
  snapBeat,
  beatParts,
  fmtBarBeat,
} from "./tempo";
import type { BpmPoint } from "./types";

const point = (
  beat: number,
  mode: BpmPoint["mode"],
  value: number,
): BpmPoint => ({ id: `p${beat}`, beat, mode, value });

describe("clampBpm", () => {
  it("clamps to the allowed range", () => {
    expect(clampBpm(0)).toBe(BPM_MIN);
    expect(clampBpm(5000)).toBe(BPM_MAX);
    expect(clampBpm(120)).toBe(120);
  });
});

describe("snapBeat", () => {
  it("rounds to whole beats when div <= 1", () => {
    expect(snapBeat(1.4, 1)).toBe(1);
    expect(snapBeat(1.6, 1)).toBe(2);
    expect(snapBeat(2.5, 0)).toBe(3);
  });

  it("snaps to 1/div subdivisions", () => {
    expect(snapBeat(1.26, 4)).toBe(1.25);
    expect(snapBeat(1.13, 4)).toBe(1.25);
    expect(snapBeat(1.1, 4)).toBe(1);
    expect(snapBeat(2.015, 32)).toBeCloseTo(2, 10);
  });

  it("keeps values already on the grid", () => {
    expect(snapBeat(3.25, 4)).toBe(3.25);
    expect(snapBeat(8, 32)).toBe(8);
  });
});

describe("beatParts / fmtBarBeat", () => {
  it("splits beats into 4/4 bar and in-bar positions", () => {
    expect(beatParts(0)).toEqual({ bar: 1, inBar: 0 });
    expect(beatParts(4)).toEqual({ bar: 2, inBar: 0 });
    expect(beatParts(17.25)).toEqual({ bar: 5, inBar: 1.25 });
    expect(beatParts(-3)).toEqual({ bar: 1, inBar: 0 });
  });

  it("formats bar and beat", () => {
    expect(fmtBarBeat(17.25)).toBe("5·1.25");
    expect(fmtBarBeat(5)).toBe("2·1");
  });
});

describe("buildTempoMap", () => {
  it("maps beats and time for a constant tempo", () => {
    const map = buildTempoMap(120, 0, []);
    expect(map.timeOfBeat(0)).toBe(0);
    expect(map.timeOfBeat(1)).toBe(500);
    expect(map.timeOfBeat(4)).toBe(2000);
    expect(map.beatOfTime(1000)).toBe(2);
    expect(map.bpmAtBeat(10)).toBe(120);
    expect(map.bpmAtTime(1000)).toBe(120);
    expect(map.segments).toHaveLength(1);
  });

  it("applies the offset", () => {
    const map = buildTempoMap(120, 250, []);
    expect(map.timeOfBeat(0)).toBe(250);
    expect(map.timeOfBeat(1)).toBe(750);
    expect(map.beatOfTime(250)).toBe(0);
    expect(map.beatOfTime(750)).toBe(1);
  });

  it("handles absolute tempo changes", () => {
    const map = buildTempoMap(120, 0, [point(4, "abs", 60)]);
    expect(map.bpmAtBeat(3.99)).toBe(120);
    expect(map.bpmAtBeat(4)).toBe(60);
    expect(map.timeOfBeat(4)).toBe(2000);
    expect(map.timeOfBeat(8)).toBe(6000);
    expect(map.segments).toHaveLength(2);
    expect(map.segments[0].timeEndMs).toBe(2000);
  });

  it("handles multiplier tempo changes", () => {
    const map = buildTempoMap(120, 0, [point(4, "mult", 2)]);
    expect(map.bpmAtBeat(4)).toBe(240);
    // 4 beats @120 (2000ms) + 4 beats @240 (1000ms)
    expect(map.timeOfBeat(8)).toBe(3000);
  });

  it("clamps the base bpm and point values", () => {
    const map = buildTempoMap(5000, 0, [point(2, "abs", 1)]);
    expect(map.bpmAtBeat(0)).toBe(BPM_MAX);
    expect(map.bpmAtBeat(2)).toBe(BPM_MIN);
  });

  it("sorts points and ignores non-positive beats", () => {
    const map = buildTempoMap(120, 0, [
      point(8, "abs", 60),
      point(4, "abs", 240),
      point(0, "abs", 30),
    ]);
    expect(map.bpmAtBeat(4)).toBe(240);
    expect(map.bpmAtBeat(8)).toBe(60);
    expect(map.segments).toHaveLength(3);
  });

  it("round-trips beat <-> time across segments", () => {
    const map = buildTempoMap(100, 137, [
      point(3, "abs", 150),
      point(5.5, "mult", 0.5),
    ]);
    for (const b of [0, 1, 3, 4.25, 5.5, 9, 17.125]) {
      expect(map.beatOfTime(map.timeOfBeat(b))).toBeCloseTo(b, 6);
      expect(map.bpmAtTime(map.timeOfBeat(b))).toBeCloseTo(map.bpmAtBeat(b), 6);
    }
  });
});
