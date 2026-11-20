import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const cache = new Map<string, AudioBuffer>();
  const source = {
    length: 44100,
    numberOfChannels: 2,
    duration: 1,
    sampleRate: 44100,
  } as unknown as AudioBuffer;
  const transport = {
    playing: false,
    positionMs: 0,
    rate: 1,
    pitchFollow: false,
    buffering: false,
    hasAudio: true,
    countingIn: false,
    followManual: false,
    followActive: false,
    followLocked: false,
  };
  const engine = {
    sourceBuffer: source,
    playing: false,
    positionMs: () => transport.positionMs,
    durationMs: () => 1000,
    seek: vi.fn(),
    pause: vi.fn(() => {
      engine.playing = false;
    }),
    playFrom: vi.fn(() => {
      engine.playing = true;
    }),
    getStretched: (key: string) => cache.get(key) ?? null,
    putStretched: (key: string, buffer: AudioBuffer) => {
      cache.set(key, buffer);
    },
    pinStretched: vi.fn(),
    stretchEpochValue: () => 1,
    cancelScheduledClicks: vi.fn(),
    scheduleClick: vi.fn(),
  };
  const stretch = vi.fn();
  const error = vi.fn();
  return {
    cache,
    source,
    transport,
    engine,
    stretch,
    error,
    settings: { settings: { countInBars: 0, stretchEngine: "soundtouch" } },
  };
});

vi.mock("../engine", () => ({ engine: h.engine }));
vi.mock("../stretch", () => ({ stretchAudioBuffer: h.stretch }));
vi.mock("../stores/transport", () => ({
  useTransportStore: () => h.transport,
  resetLoopState: vi.fn(),
}));
vi.mock("../stores/settings", () => ({
  useSettingsStore: () => h.settings,
}));
vi.mock("../stores/project", () => ({
  useProjectStore: () => ({ markers: [] }),
  findMarker: () => null,
}));
vi.mock("../stores/selection", () => ({ markerSelectionIds: () => [] }));
vi.mock("../ui/toast", () => ({ toast: { error: h.error } }));
vi.mock("../utils/text", () => ({ t: (key: string) => key }));
vi.mock("./flash", () => ({ refreshBeatFlash: vi.fn() }));
vi.mock("./gridClick", () => ({ resetGridClick: vi.fn() }));
vi.mock("./timeline", () => ({
  bpmAtTime: () => 120,
  beatOfTime: () => 0,
  beatsPerBarAtBeat: () => 4,
  contentEndMs: () => 1000,
  timeOfBeat: () => 0,
}));

import { applySpeed, pause, play } from "./playback";

const stretched = {
  length: 88200,
  numberOfChannels: 2,
  duration: 2,
  sampleRate: 44100,
} as unknown as AudioBuffer;

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  h.cache.clear();
  Object.assign(h.transport, {
    playing: false,
    positionMs: 0,
    rate: 1,
    pitchFollow: false,
    buffering: false,
    hasAudio: true,
    countingIn: false,
  });
  h.engine.playing = false;
  h.engine.playFrom.mockClear();
  h.engine.pause.mockClear();
  h.engine.pinStretched.mockClear();
  h.stretch.mockReset();
  h.stretch.mockResolvedValue(stretched);
  h.error.mockClear();
});

describe("playback stretch caching", () => {
  it("does not re-render when replaying the same rate", async () => {
    applySpeed(0.5, false);
    play();
    await flush();
    expect(h.stretch).toHaveBeenCalledTimes(1);
    expect(h.engine.playFrom).toHaveBeenCalledTimes(1);

    pause();
    play();
    await flush();
    expect(h.stretch).toHaveBeenCalledTimes(1);
    expect(h.engine.playFrom).toHaveBeenCalledTimes(2);
    expect(h.cache.get("0.500")).toBe(stretched);
  });

  it("caches a render that finishes after the user paused", async () => {
    let finish!: (buffer: AudioBuffer) => void;
    h.stretch.mockImplementationOnce(
      () =>
        new Promise<AudioBuffer>((resolve) => {
          finish = resolve;
        }),
    );

    applySpeed(0.5, false);
    play();
    await flush();
    expect(h.stretch).toHaveBeenCalledTimes(1);

    pause();
    finish(stretched);
    await flush();
    expect(h.engine.playFrom).not.toHaveBeenCalled();
    expect(h.cache.get("0.500")).toBe(stretched);

    play();
    await flush();
    expect(h.stretch).toHaveBeenCalledTimes(1);
    expect(h.engine.playFrom).toHaveBeenCalledTimes(1);
  });

  it("stops playback and reports a failed stretch", async () => {
    h.stretch.mockRejectedValueOnce(new Error("no worklet"));

    applySpeed(0.5, false);
    play();
    await flush();

    expect(h.transport.playing).toBe(false);
    expect(h.error).toHaveBeenCalledWith("transport.stretchFailed");
  });
});
