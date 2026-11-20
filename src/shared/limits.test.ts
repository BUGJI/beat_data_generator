import { describe, expect, it } from "vitest";
import { FREE_NUMBERS, STRICT_NUMBERS, numberPolicy } from "./limits";

describe("numberPolicy", () => {
  it("maps the free-input flag to a stable policy object", () => {
    expect(numberPolicy(true)).toBe(FREE_NUMBERS);
    expect(numberPolicy(false)).toBe(STRICT_NUMBERS);
    expect(FREE_NUMBERS.free).toBe(true);
    expect(STRICT_NUMBERS.free).toBe(false);
  });
});
