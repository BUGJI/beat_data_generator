import { describe, expect, it } from "vitest";
import {
  audioBufferBytes,
  rateCacheKey,
  rateFromKey,
  StretchCache,
} from "./cache";

const fakeBuffer = (length: number, channels = 2): AudioBuffer =>
  ({ length, numberOfChannels: channels }) as unknown as AudioBuffer;

describe("rateCacheKey", () => {
  it("quantizes rates to 3 decimals", () => {
    expect(rateCacheKey(1.5004)).toBe("1.500");
    expect(rateCacheKey(1.0500000001)).toBe("1.050");
    expect(rateFromKey("1.250")).toBe(1.25);
  });

  it("falls back to 1 for invalid rates", () => {
    expect(rateCacheKey(Number.NaN)).toBe("1.000");
    expect(rateFromKey("nope")).toBe(1);
  });
});

describe("audioBufferBytes", () => {
  it("counts Float32 PCM for every channel", () => {
    expect(audioBufferBytes(fakeBuffer(100, 2))).toBe(800);
    expect(audioBufferBytes(fakeBuffer(100, 1))).toBe(400);
  });
});

describe("StretchCache", () => {
  it("returns entries and refreshes LRU recency", () => {
    const cache = new StretchCache(1600);
    const a = fakeBuffer(100);
    const b = fakeBuffer(100);
    const c = fakeBuffer(100);
    cache.put("a", a);
    cache.put("b", b);
    expect(cache.get("a")).toBe(a);

    cache.put("c", c);
    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toBe(a);
    expect(cache.get("c")).toBe(c);
  });

  it("never evicts the pinned playback entry", () => {
    const cache = new StretchCache(1600);
    const a = fakeBuffer(100);
    const b = fakeBuffer(100);
    const c = fakeBuffer(100);
    cache.put("a", a);
    cache.pin("a");
    cache.put("b", b);
    cache.put("c", c);

    expect(cache.get("a")).toBe(a);
    expect(cache.get("c")).toBe(c);
    expect(cache.get("b")).toBeNull();
  });

  it("keeps a single oversized entry but evicts it for the next one", () => {
    const cache = new StretchCache(100);
    const a = fakeBuffer(100);
    const b = fakeBuffer(100);
    cache.put("a", a);
    expect(cache.get("a")).toBe(a);
    expect(cache.sizeBytes).toBeGreaterThan(cache.limitBytes);

    cache.put("b", b);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe(b);
  });

  it("keeps a newly added entry while an oversized pinned entry is present", () => {
    const cache = new StretchCache(100);
    const a = fakeBuffer(100);
    const b = fakeBuffer(100);
    cache.put("a", a);
    cache.pin("a");

    cache.put("b", b);
    expect(cache.get("b")).toBe(b);

    cache.pin("b");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe(b);
  });

  it("evicts immediately when the budget shrinks", () => {
    const cache = new StretchCache(2400);
    const a = fakeBuffer(100);
    const b = fakeBuffer(100);
    const c = fakeBuffer(100);
    cache.put("a", a);
    cache.put("b", b);
    cache.put("c", c);

    cache.setMaxBytes(800);
    expect(cache.size).toBe(1);
    expect(cache.get("c")).toBe(c);
  });

  it("replaces an existing key without double counting bytes", () => {
    const cache = new StretchCache(800);
    cache.put("a", fakeBuffer(100));
    cache.put("a", fakeBuffer(50));
    expect(cache.size).toBe(1);
    expect(cache.sizeBytes).toBe(400);
  });

  it("clears entries and pins", () => {
    const cache = new StretchCache(1600);
    cache.put("a", fakeBuffer(100));
    cache.pin("a");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.sizeBytes).toBe(0);
    expect(cache.pinned).toBeNull();
  });
});
