import { describe, expect, it } from "vitest";
import {
  MAX_KEYS_PER_BAG,
  bagWithinLimits,
  clonePluginBag,
  sanitizePanelLayout,
  sanitizePluginStore,
} from "./pluginDataSanitize";

describe("sanitizePluginStore", () => {
  it("drops a top-level __proto__ plugin id without polluting prototypes", () => {
    const raw = JSON.parse(
      '{"data":{"__proto__":{"polluted":true},"ok":{"a":1}}}',
    ) as unknown;

    const store = sanitizePluginStore(raw);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(store.data)).toBeNull();
    expect(store.data.ok).toEqual({ a: 1 });
    expect(Object.hasOwn(store.data, "__proto__")).toBe(false);
  });

  it("drops reserved keys inside a plugin bag", () => {
    const raw = JSON.parse(
      '{"data":{"p":{"safe":1,"__proto__":{"polluted":true},"constructor":2}}}',
    ) as unknown;

    const store = sanitizePluginStore(raw);

    expect(Object.getPrototypeOf(store.data.p)).toBeNull();
    expect(store.data.p).toEqual({ safe: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("drops malformed bags, empty ids and invalid rects", () => {
    const raw = {
      data: {
        "": { a: 1 },
        good: { ok: true },
        arrayBag: [1, 2],
      },
      panels: {
        __proto__: { x: 1, y: 2, w: 3, h: 4 },
        "p:panel": { x: 1, y: 2, w: 3, h: 4 },
        bad: { x: "nope", y: 2, w: 3, h: 4 },
      },
    };

    const store = sanitizePluginStore(raw);

    expect(Object.keys(store.data)).toEqual(["good"]);
    expect(Object.keys(store.panels)).toEqual(["p:panel"]);
    expect(Object.getPrototypeOf(store.panels)).toBeNull();
  });

  it("never throws on non-object input", () => {
    for (const raw of [null, 1, "x", [], true]) {
      const store = sanitizePluginStore(raw);
      expect(store.data).toEqual({});
      expect(store.panels).toEqual({});
    }
  });
});

describe("clonePluginBag / bagWithinLimits", () => {
  it("clones into a null-prototype object and filters reserved keys", () => {
    const bag = JSON.parse(
      '{"safe":1,"__proto__":{"polluted":true}}',
    ) as Record<string, unknown>;
    const clone = clonePluginBag(bag);
    expect(Object.getPrototypeOf(clone)).toBeNull();
    expect(clone.safe).toBe(1);
    expect(Object.hasOwn(clone, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects bags over the key budget", () => {
    const bag: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_KEYS_PER_BAG; i++) bag[`k${i}`] = i;
    expect(bagWithinLimits({ a: 1 })).toBe(true);
    expect(bagWithinLimits(bag)).toBe(false);
  });
});

describe("sanitizePanelLayout", () => {
  it("keeps valid rects and drops reserved keys", () => {
    const layout = sanitizePanelLayout({
      __proto__: { x: 1, y: 1, w: 1, h: 1 },
      "a:b": { x: 1, y: 2, w: 3, h: 4 },
    });
    expect(Object.getPrototypeOf(layout)).toBeNull();
    expect(Object.keys(layout)).toEqual(["a:b"]);
  });
});
