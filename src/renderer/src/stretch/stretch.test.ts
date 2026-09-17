import { beforeEach, describe, expect, it, vi } from "vitest";

const { soundtouch, signalsmith } = vi.hoisted(() => ({
  soundtouch: vi.fn(),
  signalsmith: vi.fn(),
}));

vi.mock("./soundtouch", () => ({ stretchWithSoundtouch: soundtouch }));
vi.mock("./signalsmith", () => ({ stretchWithSignalsmith: signalsmith }));

import { stretchAudioBuffer } from "./index";

const original = {} as AudioBuffer;
const result = { id: "stretched" } as unknown as AudioBuffer;

beforeEach(() => {
  soundtouch.mockReset();
  signalsmith.mockReset();
});

describe("stretchAudioBuffer", () => {
  it("uses signalsmith by default", async () => {
    signalsmith.mockResolvedValue(result);
    const out = await stretchAudioBuffer(original, 1.5);
    expect(signalsmith).toHaveBeenCalledWith(original, 1.5);
    expect(soundtouch).not.toHaveBeenCalled();
    expect(out).toBe(result);
  });

  it("uses soundtouch when selected", async () => {
    soundtouch.mockResolvedValue(result);
    const out = await stretchAudioBuffer(original, 1.5, "soundtouch");
    expect(soundtouch).toHaveBeenCalledWith(original, 1.5);
    expect(signalsmith).not.toHaveBeenCalled();
    expect(out).toBe(result);
  });

  it("falls back to soundtouch when signalsmith fails", async () => {
    signalsmith.mockRejectedValue(new Error("worklet unavailable"));
    soundtouch.mockResolvedValue(result);
    const out = await stretchAudioBuffer(original, 1.5, "signalsmith");
    expect(signalsmith).toHaveBeenCalledOnce();
    expect(soundtouch).toHaveBeenCalledWith(original, 1.5);
    expect(out).toBe(result);
  });
});
