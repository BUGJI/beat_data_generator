import { describe, expect, it } from "vitest";
import {
  advanceStepBoundary,
  nextStepBoundary,
  stepTargetX,
} from "./followStep";

describe("nextStepBoundary", () => {
  it("returns the next integer beat for a one-beat step", () => {
    expect(nextStepBoundary(0, 1)).toBe(1);
    expect(nextStepBoundary(0.5, 1)).toBe(1);
    expect(nextStepBoundary(1, 1)).toBe(2);
    expect(nextStepBoundary(7.999, 1)).toBe(8);
  });

  it("aligns two-beat steps to even beats", () => {
    expect(nextStepBoundary(0, 2)).toBe(2);
    expect(nextStepBoundary(1.2, 2)).toBe(2);
    expect(nextStepBoundary(2, 2)).toBe(4);
    expect(nextStepBoundary(3.9, 2)).toBe(4);
    expect(nextStepBoundary(4, 2)).toBe(6);
  });

  it("treats positions before beat zero and bad sizes safely", () => {
    expect(nextStepBoundary(-0.3, 1)).toBe(0);
    expect(nextStepBoundary(-3.2, 2)).toBe(-2);
    expect(nextStepBoundary(2.5, 0)).toBe(3);
    expect(nextStepBoundary(2.5, Number.NaN)).toBe(3);
  });
});

describe("advanceStepBoundary", () => {
  it("does nothing while the cursor has not been reached", () => {
    expect(advanceStepBoundary(0.9, 1, 1)).toEqual({
      crossed: null,
      nextBeat: 1,
    });
    expect(advanceStepBoundary(3.5, 4, 2)).toEqual({
      crossed: null,
      nextBeat: 4,
    });
  });

  it("crosses exactly one boundary", () => {
    expect(advanceStepBoundary(1.001, 1, 1)).toEqual({
      crossed: 1,
      nextBeat: 2,
    });
    expect(advanceStepBoundary(4.01, 4, 2)).toEqual({
      crossed: 4,
      nextBeat: 6,
    });
  });

  it("catches up to the latest boundary after a stall", () => {
    expect(advanceStepBoundary(5.2, 1, 1)).toEqual({
      crossed: 5,
      nextBeat: 6,
    });
    expect(advanceStepBoundary(9.5, 2, 2)).toEqual({
      crossed: 8,
      nextBeat: 10,
    });
  });

  it("initialises a missing cursor from the current beat", () => {
    expect(advanceStepBoundary(3.4, Number.NaN, 2)).toEqual({
      crossed: null,
      nextBeat: 4,
    });
  });
});

describe("stepTargetX", () => {
  it("places the boundary time at the left anchor", () => {
    expect(stepTargetX(1000, 100, 100)).toBe(0);
    expect(stepTargetX(2500, 100, 100)).toBe(150);
  });

  it("scales with zoom and anchor", () => {
    expect(stepTargetX(1000, 200, 50)).toBe(150);
    expect(stepTargetX(500, 90, 0)).toBe(45);
  });
});
