import { describe, expect, it } from "vitest";
import { fileSizeWithin, isAbsoluteFileArg, utf8ByteLength } from "./files";

describe("isAbsoluteFileArg", () => {
  it("accepts absolute POSIX and Windows paths", () => {
    expect(isAbsoluteFileArg("/tmp/song.mp3")).toBe(true);
    expect(isAbsoluteFileArg("C:\\music\\song.mp3")).toBe(true);
    expect(isAbsoluteFileArg("D:/x/y.bdg")).toBe(true);
  });

  it("rejects relative paths and non-strings", () => {
    for (const bad of ["", "song.mp3", "./x", "../x", null, 1, {}, []]) {
      expect(isAbsoluteFileArg(bad)).toBe(false);
    }
  });
});

describe("utf8ByteLength", () => {
  it("counts UTF-8 bytes, not code units", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("节拍")).toBe(6);
    expect(utf8ByteLength("🐱")).toBe(4);
  });
});

describe("fileSizeWithin", () => {
  it("checks the on-disk size before a read", async () => {
    expect(await fileSizeWithin("package.json", 10)).toBe(false);
    expect(await fileSizeWithin("package.json", 10_000_000)).toBe(true);
  });

  it("rejects missing files and directories", async () => {
    expect(await fileSizeWithin("no/such/file.bdg", 1024)).toBe(false);
    expect(await fileSizeWithin("src", 1024)).toBe(false);
  });
});
