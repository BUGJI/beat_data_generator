import { describe, expect, it } from "vitest";
import { BPM_LANE_H, MARKER_LANE_H, RULER_H } from "../../metrics";
import {
  BAR_LABEL_FULL_PX,
  BAR_LABEL_MIN_PX,
  barLabelAlpha,
  bpmOccupy,
  cappedSnapDiv,
  doSnap,
  fmtBar,
  fmtTick,
  laneKindAt,
  markerOccupy,
  rulerEdgeAlpha,
  rulerLabelDigits,
  screenToContentY,
  timeRulerStepSec,
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

  it("fmtTick adds sub-second precision without duplicate labels", () => {
    expect(fmtTick(0.5, 0.5)).toBe("0:00.5");
    expect(fmtTick(1.5, 0.5)).toBe("0:01.5");
    expect(fmtTick(65.2, 0.1)).toBe("1:05.2");
    expect(fmtTick(0.05, 0.05)).toBe("0:00.05");
  });

  it("fmtBar renders bar.beat with an optional fraction", () => {
    expect(fmtBar(0)).toBe("1.1");
    expect(fmtBar(4)).toBe("2.1");
    expect(fmtBar(1.5)).toBe("1.2+0.500");
  });
});

describe("ruler animation helpers", () => {
  it("picks the coarse step at zoom thresholds", () => {
    expect(timeRulerStepSec(4000)).toBe(0.02);
    expect(timeRulerStepSec(3500)).toBe(0.02);
    expect(timeRulerStepSec(3499)).toBe(0.05);
    expect(timeRulerStepSec(1400)).toBe(0.05);
    expect(timeRulerStepSec(1399)).toBe(0.1);
    expect(timeRulerStepSec(700)).toBe(0.1);
    expect(timeRulerStepSec(699)).toBe(0.2);
    expect(timeRulerStepSec(350)).toBe(0.2);
    expect(timeRulerStepSec(349)).toBe(0.5);
    expect(timeRulerStepSec(140)).toBe(0.5);
    expect(timeRulerStepSec(139)).toBe(1);
    expect(timeRulerStepSec(70)).toBe(1);
    expect(timeRulerStepSec(69)).toBe(2);
    expect(timeRulerStepSec(6)).toBe(15);
  });

  it("maps the step to fractional digits", () => {
    expect(rulerLabelDigits(1)).toBe(0);
    expect(rulerLabelDigits(0.5)).toBe(1);
    expect(rulerLabelDigits(0.2)).toBe(1);
    expect(rulerLabelDigits(0.1)).toBe(1);
    expect(rulerLabelDigits(0.05)).toBe(2);
    expect(rulerLabelDigits(0.02)).toBe(2);
  });

  it("fades labels at both edges", () => {
    expect(rulerEdgeAlpha(100, 500, 20)).toBe(1);
    expect(rulerEdgeAlpha(0, 500, 20)).toBe(0);
    expect(rulerEdgeAlpha(10, 500, 20)).toBeCloseTo(0.5, 6);
    expect(rulerEdgeAlpha(480, 500, 20)).toBe(0);
    expect(rulerEdgeAlpha(470, 500, 20)).toBeCloseTo(0.5, 6);
    expect(rulerEdgeAlpha(0, 500, 20, 0)).toBe(1);
  });

  it("fades bar numbers in over the slot-width range", () => {
    expect(barLabelAlpha(BAR_LABEL_MIN_PX)).toBe(0);
    expect(barLabelAlpha(BAR_LABEL_FULL_PX)).toBe(1);
    expect(
      barLabelAlpha((BAR_LABEL_MIN_PX + BAR_LABEL_FULL_PX) / 2),
    ).toBeCloseTo(0.5, 6);
    expect(barLabelAlpha(10)).toBe(0);
    expect(barLabelAlpha(200)).toBe(1);
  });
});
