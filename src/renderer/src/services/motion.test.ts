import { describe, expect, it } from "vitest";
import {
  MOTION_SPEED_SCALE,
  resolveMotionScale,
  resolveReduceMotion,
} from "./motion";

describe("resolveReduceMotion", () => {
  it("follows the OS preference by default", () => {
    expect(resolveReduceMotion("system", true)).toBe(true);
    expect(resolveReduceMotion("system", false)).toBe(false);
  });

  it("can force reduce or full motion regardless of the OS", () => {
    expect(resolveReduceMotion("on", false)).toBe(true);
    expect(resolveReduceMotion("off", true)).toBe(false);
  });
});

describe("resolveMotionScale", () => {
  it("maps each speed tier to its multiplier", () => {
    expect(resolveMotionScale("slow", false)).toBe(MOTION_SPEED_SCALE.slow);
    expect(resolveMotionScale("normal", false)).toBe(1);
    expect(resolveMotionScale("fast", false)).toBe(MOTION_SPEED_SCALE.fast);
  });

  it("returns zero when motion is reduced", () => {
    expect(resolveMotionScale("slow", true)).toBe(0);
    expect(resolveMotionScale("normal", true)).toBe(0);
    expect(resolveMotionScale("fast", true)).toBe(0);
  });
});
