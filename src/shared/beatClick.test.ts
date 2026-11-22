import { describe, expect, it } from "vitest";
import { BEAT_CLICK_LIMIT_CAP, totalClickGain } from "./beatClick";

describe("totalClickGain", () => {
  it("keeps merge at one click whatever the overlap count", () => {
    expect(totalClickGain(1, "merge")).toBe(1);
    expect(totalClickGain(4, "merge")).toBe(1);
    expect(totalClickGain(99, "merge")).toBe(1);
  });

  it("grows the limited policy sub-linearly and caps it", () => {
    expect(totalClickGain(1, "limit")).toBe(1);
    expect(totalClickGain(2, "limit")).toBeCloseTo(Math.SQRT2);
    expect(totalClickGain(4, "limit")).toBe(BEAT_CLICK_LIMIT_CAP);
    expect(totalClickGain(16, "limit")).toBe(BEAT_CLICK_LIMIT_CAP);
  });

  it("keeps the legacy stacked amplitude", () => {
    expect(totalClickGain(1, "stack")).toBe(1);
    expect(totalClickGain(3, "stack")).toBe(3);
  });

  it("normalises invalid and fractional counts", () => {
    expect(totalClickGain(0, "stack")).toBe(1);
    expect(totalClickGain(-5, "stack")).toBe(1);
    expect(totalClickGain(2.9, "stack")).toBe(2);
    expect(totalClickGain(Number.NaN, "limit")).toBe(1);
  });
});
