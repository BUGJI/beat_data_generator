import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useProjectStore } from "../stores/project";
import { parseGoto } from "./goto";

beforeEach(() => {
  setActivePinia(createPinia());
  useProjectStore().baseBpm = 120;
  useProjectStore().offsetMs = 0;
});

describe("parseGoto", () => {
  it("parses minutes:seconds and raw seconds", () => {
    expect(parseGoto("1:23.456")).toBe(83456);
    expect(parseGoto("83.456")).toBe(83456);
    expect(parseGoto(" 0:05 ")).toBe(5000);
  });

  it("parses bar.beat positions from the tempo map", () => {
    expect(parseGoto("b1.1")).toBe(0);
    expect(parseGoto("b3.2")).toBe(4500);
    expect(parseGoto("b2")).toBe(2000);
    useProjectStore().beatsPerBar = 3;
    expect(parseGoto("b3.2")).toBe(3500);
  });

  it("rejects empty or malformed input", () => {
    expect(parseGoto("")).toBeNull();
    expect(parseGoto("abc")).toBeNull();
    expect(parseGoto("1:2:3")).toBeNull();
  });
});
