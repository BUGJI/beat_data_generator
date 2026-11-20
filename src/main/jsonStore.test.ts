import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({
  default: { error: () => {} },
}));

import { readJson, writeJsonAtomic } from "./jsonStore";

let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), "bdg-json-"));
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("readJson", () => {
  it("parses an existing file", () => {
    const root = tempDir();
    const path = join(root, "x.json");
    writeFileSync(path, '{"a":1}', "utf-8");
    expect(readJson(path, () => ({ a: 0 }))).toEqual({ a: 1 });
  });

  it("returns a fresh fallback for missing or broken files", () => {
    const root = tempDir();
    const missing = join(root, "missing.json");
    const broken = join(root, "broken.json");
    writeFileSync(broken, "{not json", "utf-8");

    const a = readJson(missing, () => ({ a: 1 }));
    const b = readJson(broken, () => ({ a: 1 }));
    expect(a).toEqual({ a: 1 });
    expect(b).toEqual({ a: 1 });
    expect(a).not.toBe(b);
  });
});

describe("writeJsonAtomic", () => {
  it("writes JSON and can replace it", () => {
    const root = tempDir();
    const path = join(root, "nested", "state.json");

    expect(writeJsonAtomic(path, { version: 1 })).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ version: 1 });

    expect(writeJsonAtomic(path, { version: 2 })).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ version: 2 });
  });

  it("returns false instead of throwing when the directory cannot be made", () => {
    const root = tempDir();
    const fileAsDir = join(root, "not-a-dir");
    writeFileSync(fileAsDir, "x", "utf-8");

    expect(writeJsonAtomic(join(fileAsDir, "state.json"), { a: 1 })).toBe(
      false,
    );
  });
});
