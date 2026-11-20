import { describe, expect, it } from "vitest";
import {
  baseName,
  dirName,
  isAbsolutePath,
  isInside,
  isSafeId,
  joinPath,
  normalizeSlashes,
  relativeToDir,
  stripExtension,
} from "./path";

describe("normalizeSlashes", () => {
  it("turns backslashes into forward slashes", () => {
    expect(normalizeSlashes("a\\b\\c.ts")).toBe("a/b/c.ts");
    expect(normalizeSlashes("a/b")).toBe("a/b");
  });
});

describe("dirName", () => {
  it("returns the parent directory", () => {
    expect(dirName("a/b/c.ts")).toBe("a/b");
    expect(dirName("C:\\x\\y")).toBe("C:/x");
  });

  it("returns an empty string when there is no separator", () => {
    expect(dirName("c.ts")).toBe("");
    expect(dirName("/x")).toBe("");
  });
});

describe("baseName", () => {
  it("returns the last path segment for either slash style", () => {
    expect(baseName("a/b/c.ts")).toBe("c.ts");
    expect(baseName("C:\\x\\y.mp3")).toBe("y.mp3");
    expect(baseName("c.ts")).toBe("c.ts");
  });
});

describe("isAbsolutePath", () => {
  it("accepts POSIX and Windows drive paths", () => {
    expect(isAbsolutePath("/x/y")).toBe(true);
    expect(isAbsolutePath("C:/x")).toBe(true);
    expect(isAbsolutePath("C:\\x")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isAbsolutePath("rel/x")).toBe(false);
    expect(isAbsolutePath("c.ts")).toBe(false);
  });
});

describe("joinPath", () => {
  it("joins with a single separator", () => {
    expect(joinPath("a/b", "c.ts")).toBe("a/b/c.ts");
    expect(joinPath("a/b/", "/c")).toBe("a/b/c");
  });

  it("normalizes when there is no directory", () => {
    expect(joinPath("", "c.ts")).toBe("c.ts");
    expect(joinPath("", "a\\b")).toBe("a/b");
  });
});

describe("relativeToDir", () => {
  it("computes a relative path below the directory", () => {
    expect(relativeToDir("/a/b", "/a/b/c/d")).toBe("c/d");
    expect(relativeToDir("/a", "/a/b")).toBe("b");
  });

  it("walks up when the target is a sibling", () => {
    expect(relativeToDir("/a/b", "/a/x")).toBe("../x");
  });

  it("returns null when it cannot be expressed", () => {
    expect(relativeToDir("/a/b", "/a/b")).toBeNull();
    expect(relativeToDir("C:/a", "D:/b")).toBeNull();
    expect(relativeToDir("", "/a")).toBeNull();
  });
});

describe("isInside", () => {
  it("accepts the root itself and descendants", () => {
    expect(isInside("/plugins/a", "/plugins/a")).toBe(true);
    expect(isInside("/plugins/a", "/plugins/a/main.js")).toBe(true);
    expect(isInside("C:\\plugins\\a", "C:/plugins/a/renderer.js")).toBe(true);
    expect(isInside("C:/plugins/a", "c:/plugins/a/renderer.js")).toBe(true);
  });

  it("rejects a sibling with the same prefix", () => {
    expect(isInside("/plugins/a", "/plugins/ab/main.js")).toBe(false);
  });

  it("rejects traversal that escapes the root", () => {
    expect(isInside("/plugins/a", "/plugins/a/../../evil.js")).toBe(false);
    expect(isInside("C:/plugins/a", "C:/plugins/a/../b/x.js")).toBe(false);
    expect(isInside("/plugins/a", "/etc/passwd")).toBe(false);
  });

  it("rejects a different drive", () => {
    expect(isInside("C:/plugins/a", "D:/plugins/a/main.js")).toBe(false);
  });

  it("rejects empty inputs", () => {
    expect(isInside("", "/x")).toBe(false);
    expect(isInside("/x", "")).toBe(false);
  });
});

describe("isSafeId", () => {
  it("accepts dot/dash/underscore ids", () => {
    expect(isSafeId("bdg_plugin.phira-2")).toBe(true);
    expect(isSafeId("example-basic")).toBe(true);
  });

  it("rejects separators, traversal and reserved names", () => {
    for (const bad of ["", " ", ".", "..", "../x", "a/b", "a\\b", "a\0b"]) {
      expect(isSafeId(bad)).toBe(false);
    }
  });
});

describe("stripExtension", () => {
  it("drops the directory and the last extension", () => {
    expect(stripExtension("C:/music/song.mp3")).toBe("song");
    expect(stripExtension("a/b/c.tar.gz")).toBe("c.tar");
    expect(stripExtension("untitled")).toBe("untitled");
  });
});
