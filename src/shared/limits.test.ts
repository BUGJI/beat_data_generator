import { describe, expect, it } from "vitest";
import { isFreeInput, setFreeInput } from "./limits";

describe("free input flag", () => {
  it("defaults to false", () => {
    setFreeInput(false);
    expect(isFreeInput()).toBe(false);
  });

  it("reflects the last value that was set", () => {
    setFreeInput(true);
    expect(isFreeInput()).toBe(true);
    setFreeInput(false);
    expect(isFreeInput()).toBe(false);
  });
});
