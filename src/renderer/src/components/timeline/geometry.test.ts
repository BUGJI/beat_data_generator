import { describe, expect, it } from "vitest";
import { BPM_LANE_H, MARKER_LANE_H, RULER_H } from "../../metrics";
import {
  bpmOccupy,
  cappedSnapDiv,
  doSnap,
  effectiveSegments,
  fmtBar,
  fmtTick,
  laneKindAt,
  markerOccupy,
  screenToContentY,
  visibleRows,
} from "./geometry";
import type { BpmPoint, Marker } from "./types";

describe("screenToContentY / laneKindAt", () => {
  it("offets by the ruler and scroll", () => {
    expect(screenToContentY(RULER_H, 0)).toBe(0);
    expect(screenToContentY(RULER_H + 10, 30)).toBe(40);
  });

  it("finds the bpm lane, then marker lanes", () => {
    expect(laneKindAt(RULER_H + 1, 0)).toEqual({ kind: "bpm", index: -1 });
    expect(laneKindAt(RULER_H + BPM_LANE_H + 1, 0)).toEqual({
      kind: "marker",
      index: 0,
    });
    expect(laneKindAt(RULER_H + BPM_LANE_H + MARKER_LANE_H + 1, 0)).toEqual({
      kind: "marker",
      index: 1,
    });
  });
});

describe("doSnap", () => {
  it("leaves the value alone when snapping is off", () => {
    expect(doSnap(1.37, false, 4)).toBe(1.37);
  });

  it("snaps to the subdivision when on and clamps negatives to 0", () => {
    expect(doSnap(1.37, true, 4)).toBeCloseTo(1.25, 6);
    expect(doSnap(-2, true, 4)).toBe(0);
  });
});

describe("cappedSnapDiv", () => {
  it("coarsens finer grids as zoom drops", () => {
    expect(cappedSnapDiv(80, 32)).toBe(4);
    expect(cappedSnapDiv(200, 32)).toBe(8);
    expect(cappedSnapDiv(400, 32)).toBe(16);
    expect(cappedSnapDiv(800, 32)).toBe(32);
    expect(cappedSnapDiv(800, 4)).toBe(4);
  });
});

describe("visibleRows", () => {
  it("includes the bpm lane and visible marker lanes", () => {
    const rows = visibleRows(1000, 0, 2);
    expect(rows[0]).toMatchObject({ i: -1, bpm: true });
    expect(rows.filter((r) => !r.bpm).map((r) => r.i)).toEqual([0, 1]);
  });
});

describe("effectiveSegments", () => {
  it("starts at the base bpm and applies absolute points", () => {
    const points: BpmPoint[] = [{ id: "p", beat: 4, mode: "abs", value: 150 }];
    const segs = effectiveSegments(120, points);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ beatStart: 0, beatEnd: 4, bpm: 120 });
    expect(segs[1]).toMatchObject({ beatStart: 4, beatEnd: null, bpm: 150 });
  });
});

describe("occupancy", () => {
  const marker = (id: string, beat: number): Marker =>
    ({ id, trackId: "t", beat }) as Marker;

  it("markerOccupy respects the except set", () => {
    const markers = [marker("a", 1), marker("b", 2)];
    expect(markerOccupy(markers, 1)).toBe(true);
    expect(markerOccupy(markers, 1.5)).toBe(false);
    expect(markerOccupy(markers, 1, new Set(["a"]))).toBe(false);
  });

  it("bpmOccupy matches within tolerance", () => {
    const pts = [{ id: "p", beat: 4, mode: "abs", value: 120 }] as BpmPoint[];
    expect(bpmOccupy(pts, 4)).toBe(true);
    expect(bpmOccupy(pts, 4.5)).toBe(false);
  });
});

describe("formatting", () => {
  it("fmtTick renders m:ss", () => {
    expect(fmtTick(0)).toBe("0:00");
    expect(fmtTick(65)).toBe("1:05");
  });

  it("fmtBar renders bar.beat with an optional fraction", () => {
    expect(fmtBar(0)).toBe("1.1");
    expect(fmtBar(4)).toBe("2.1");
    expect(fmtBar(1.5)).toBe("1.2+0.500");
  });
});
