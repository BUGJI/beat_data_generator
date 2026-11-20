import { describe, expect, it } from "vitest";
import {
  followBounds,
  followDecision,
  smoothScrollX,
  type FollowInput,
} from "./follow";

const input = (patch: Partial<FollowInput>): FollowInput => ({
  active: false,
  locked: false,
  enabled: true,
  playheadPx: 0,
  viewX: 0,
  viewportW: 1000,
  followPercent: 90,
  ...patch,
});

describe("followBounds", () => {
  it("derives a symmetric zone when the right edge is past the middle", () => {
    const ninety = followBounds(1000, 90);
    expect(ninety.right).toBe(900);
    expect(ninety.left).toBeCloseTo(100, 6);
    const seventyFive = followBounds(1000, 75);
    expect(seventyFive.right).toBe(750);
    expect(seventyFive.left).toBeCloseTo(250, 6);
  });

  it("collapses to a line below the middle", () => {
    expect(followBounds(1000, 30)).toEqual({ left: 300, right: 300 });
  });

  it("clamps the percentage", () => {
    expect(followBounds(1000, -10)).toEqual({ left: 0, right: 0 });
    expect(followBounds(1000, 200)).toEqual({ left: 0, right: 1000 });
  });
});

describe("followDecision", () => {
  it("stays idle before the playhead reaches the right edge", () => {
    expect(followDecision(input({ playheadPx: 500 }))).toEqual({
      active: false,
      targetX: null,
    });
  });

  it("engages once the playhead crosses the right edge", () => {
    expect(followDecision(input({ playheadPx: 950 }))).toEqual({
      active: true,
      targetX: 50,
    });
  });

  it("does not auto-engage when disabled or locked", () => {
    expect(followDecision(input({ playheadPx: 2000, enabled: false }))).toEqual(
      { active: false, targetX: null },
    );
    expect(followDecision(input({ playheadPx: 2000, locked: true }))).toEqual({
      active: false,
      targetX: null,
    });
  });

  it("keeps the view still while the playhead is inside the zone", () => {
    expect(followDecision(input({ active: true, playheadPx: 500 }))).toEqual({
      active: true,
      targetX: null,
    });
  });

  it("keeps a manual follow alive when the auto setting is off", () => {
    expect(
      followDecision(input({ active: true, enabled: false, playheadPx: 500 })),
    ).toEqual({ active: true, targetX: null });
  });

  it("re-pins the playhead when it runs past the right edge", () => {
    expect(followDecision(input({ active: true, playheadPx: 5000 }))).toEqual({
      active: true,
      targetX: 4100,
    });
  });

  it("leaves a loop wrap alone when it lands inside the zone", () => {
    expect(
      followDecision(input({ active: true, viewX: 400, playheadPx: 600 })),
    ).toEqual({ active: true, targetX: null });
  });

  it("re-anchors a backward jump that leaves the zone", () => {
    const decision = followDecision(
      input({ active: true, viewX: 400, playheadPx: 300 }),
    );
    expect(decision.active).toBe(true);
    expect(decision.targetX).toBeCloseTo(200, 6);
  });

  it("handles the 0% and 100% edges", () => {
    expect(followDecision(input({ followPercent: 0, playheadPx: 50 }))).toEqual(
      { active: true, targetX: 50 },
    );
    expect(
      followDecision(
        input({ followPercent: 100, active: true, playheadPx: 500 }),
      ),
    ).toEqual({ active: true, targetX: null });
    expect(
      followDecision(
        input({ followPercent: 100, active: true, playheadPx: -50 }),
      ),
    ).toEqual({ active: true, targetX: -50 });
  });

  it("ignores a zero-width viewport", () => {
    expect(followDecision(input({ viewportW: 0, playheadPx: 500 }))).toEqual({
      active: false,
      targetX: null,
    });
  });
});

describe("smoothScrollX", () => {
  it("jumps straight to the target when animation is off", () => {
    expect(smoothScrollX(0, 120, 16, false)).toBe(120);
  });

  it("does not move on a zero or negative delta", () => {
    expect(smoothScrollX(10, 120, 0, true)).toBe(10);
  });

  it("snaps when the remaining distance is negligible", () => {
    expect(smoothScrollX(119.8, 120, 16, true)).toBe(120);
  });

  it("eases toward the target with time-based damping", () => {
    const next = smoothScrollX(0, 100, 90, true);
    expect(next).toBeCloseTo(100 * (1 - Math.exp(-1)), 6);
    expect(next).toBeLessThan(100);
    expect(next).toBeGreaterThan(60);
  });
});
