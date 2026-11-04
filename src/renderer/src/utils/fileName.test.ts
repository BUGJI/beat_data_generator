import { describe, expect, it } from "vitest";
import { safeFileBase } from "./fileName";

describe("safeFileBase", () => {
  it("keeps a normal name unchanged", () => {
    expect(safeFileBase("My Song")).toBe("My Song");
  });

  it("replaces characters that are invalid in file names", () => {
    expect(safeFileBase('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("trims surrounding whitespace", () => {
    expect(safeFileBase("  song  ")).toBe("song");
  });

  it("falls back for empty, whitespace-only or missing names", () => {
    expect(safeFileBase("")).toBe("untitled");
    expect(safeFileBase("   ")).toBe("untitled");
    expect(safeFileBase(null)).toBe("untitled");
    expect(safeFileBase(undefined, "project")).toBe("project");
  });
});
