import { describe, expect, it } from "vitest";
import { StretchCancelledError } from "./errors";
import { StretchScheduler } from "./scheduler";

const fakeBuffer = (id: string): AudioBuffer =>
  ({ id, length: 100, numberOfChannels: 2 }) as unknown as AudioBuffer;

interface Harness {
  scheduler: StretchScheduler;
  pending: Array<{
    rate: number;
    resolve: (buffer: AudioBuffer) => void;
    reject: (error: unknown) => void;
  }>;
  cache: Map<string, AudioBuffer>;
  pendingEvents: boolean[];
  errors: unknown[];
  advanceEpoch: () => void;
  source: AudioBuffer;
}

function harness(): Harness {
  const cache = new Map<string, AudioBuffer>();
  const pending: Harness["pending"] = [];
  const pendingEvents: boolean[] = [];
  const errors: unknown[] = [];
  const source = fakeBuffer("source");
  let epoch = 0;

  const scheduler = new StretchScheduler({
    source: () => source,
    get: (key) => cache.get(key) ?? null,
    put: (key, buffer) => {
      cache.set(key, buffer);
    },
    render: (_source, rate) =>
      new Promise<AudioBuffer>((resolve, reject) => {
        pending.push({ rate, resolve, reject });
      }),
    epoch: () => epoch,
    onPending: (value) => pendingEvents.push(value),
    onError: (error) => errors.push(error),
  });

  return {
    scheduler,
    pending,
    cache,
    pendingEvents,
    errors,
    advanceEpoch: () => {
      epoch++;
    },
    source,
  };
}

describe("StretchScheduler", () => {
  it("renders a rate once and shares the promise", async () => {
    const h = harness();
    const buffer = fakeBuffer("stretched");
    const first = h.scheduler.request(1.5);
    const second = h.scheduler.request(1.5004);

    expect(h.pending).toHaveLength(1);
    expect(h.pending[0]!.rate).toBe(1.5);
    expect(h.scheduler.pending).toBe(true);

    h.pending[0]!.resolve(buffer);
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual({ key: "1.500", rate: 1.5, buffer });
    expect(b).toBe(a);
    expect(h.scheduler.pending).toBe(false);
    expect(h.cache.get("1.500")).toBe(buffer);
    expect(h.pendingEvents).toEqual([true, false]);
  });

  it("serves cached results without rendering again", async () => {
    const h = harness();
    const buffer = fakeBuffer("stretched");
    h.cache.set("1.500", buffer);

    const result = await h.scheduler.request(1.5);
    expect(result?.buffer).toBe(buffer);
    expect(result?.key).toBe("1.500");
    expect(h.pending).toHaveLength(0);
  });

  it("does not reuse a job from an invalidated epoch", async () => {
    const h = harness();
    const stale = h.scheduler.request(1.25);
    h.advanceEpoch();

    const fresh = h.scheduler.request(1.25);
    expect(h.pending).toHaveLength(2);

    h.pending[0]!.resolve(fakeBuffer("stale"));
    expect(await stale).toBeNull();

    const newer = fakeBuffer("fresh");
    h.pending[1]!.resolve(newer);
    expect((await fresh)?.buffer).toBe(newer);
    expect(h.cache.get("1.250")).toBe(newer);
  });

  it("does not cache a render that finished after invalidation", async () => {
    const h = harness();
    const buffer = fakeBuffer("stretched");
    const request = h.scheduler.request(1.25);
    h.advanceEpoch();
    h.pending[0]!.resolve(buffer);

    expect(await request).toBeNull();
    expect(h.cache.size).toBe(0);
  });

  it("reports failures and returns null", async () => {
    const h = harness();
    const error = new Error("boom");
    const request = h.scheduler.request(0.8);
    h.pending[0]!.reject(error);

    expect(await request).toBeNull();
    expect(h.errors).toEqual([error]);
  });

  it("stays quiet when a newer request cancels the old render", async () => {
    const h = harness();
    const request = h.scheduler.request(1.5);
    h.pending[0]!.reject(new StretchCancelledError());

    expect(await request).toBeNull();
    expect(h.errors).toHaveLength(0);
  });

  it("returns null when there is no source buffer", async () => {
    const cache = new Map<string, AudioBuffer>();
    const scheduler = new StretchScheduler({
      source: () => null,
      get: (key) => cache.get(key) ?? null,
      put: (key, buffer) => cache.set(key, buffer),
      render: async () => fakeBuffer("never"),
      epoch: () => 0,
    });
    expect(await scheduler.request(1.5)).toBeNull();
  });
});
