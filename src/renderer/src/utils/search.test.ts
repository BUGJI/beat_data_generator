import { describe, expect, it } from "vitest";
import { lastAtOrBefore, lowerBound } from "./search";

const key = (n: number): number => n;

describe("lastAtOrBefore", () => {
  it("finds the last item at or before the target", () => {
    const items = [0, 4, 8];
    expect(lastAtOrBefore(items, key, -1)).toBe(-1);
    expect(lastAtOrBefore(items, key, 0)).toBe(0);
    expect(lastAtOrBefore(items, key, 3)).toBe(0);
    expect(lastAtOrBefore(items, key, 4)).toBe(1);
    expect(lastAtOrBefore(items, key, 9)).toBe(2);
  });

  it("returns -1 for an empty list", () => {
    expect(lastAtOrBefore([], key, 1)).toBe(-1);
  });
});

describe("lowerBound", () => {
  it("finds the first item at or after the target", () => {
    const items = [0, 4, 8];
    expect(lowerBound(items, key, -1)).toBe(0);
    expect(lowerBound(items, key, 0)).toBe(0);
    expect(lowerBound(items, key, 1)).toBe(1);
    expect(lowerBound(items, key, 4)).toBe(1);
    expect(lowerBound(items, key, 9)).toBe(3);
  });

  it("returns the length for an empty list", () => {
    expect(lowerBound([], key, 1)).toBe(0);
  });
});
