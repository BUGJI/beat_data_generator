import { beforeAll, describe, expect, it } from "vitest";
import {
  encodeWav,
  sampleOfMs,
  sliceAudioBuffer,
  type AudioBufferLike,
} from "./audioCrop";

/** Minimal AudioBuffer stand-in so slice tests run without a Web Audio context. */
class FakeAudioBuffer implements AudioBufferLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  private data: Float32Array[];

  constructor(opts: {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
  }) {
    this.numberOfChannels = opts.numberOfChannels;
    this.length = opts.length;
    this.sampleRate = opts.sampleRate;
    this.data = Array.from(
      { length: opts.numberOfChannels },
      () => new Float32Array(opts.length),
    );
  }

  getChannelData(channel: number): Float32Array {
    return this.data[channel]!;
  }
}

beforeAll(() => {
  (globalThis as unknown as { AudioBuffer: unknown }).AudioBuffer =
    FakeAudioBuffer;
});

function makeBuffer(channels: number, length: number): AudioBufferLike {
  return new FakeAudioBuffer({
    numberOfChannels: channels,
    length,
    sampleRate: 1000,
  });
}

function readAscii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++)
    s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("sampleOfMs", () => {
  it("converts ms to a sample index", () => {
    expect(sampleOfMs(500, 1000, 2000)).toBe(500);
  });

  it("clamps to [0, length] and handles non-finite input", () => {
    expect(sampleOfMs(-10, 1000, 2000)).toBe(0);
    expect(sampleOfMs(99999, 1000, 2000)).toBe(2000);
    expect(sampleOfMs(Number.NaN, 1000, 2000)).toBe(0);
  });
});

describe("sliceAudioBuffer", () => {
  it("cuts the requested [startMs, endMs) span", () => {
    const buf = makeBuffer(1, 10) as unknown as AudioBuffer;
    const src = buf.getChannelData(0);
    for (let i = 0; i < 10; i++) src[i] = i;
    const out = sliceAudioBuffer(buf, 2, 5);
    expect(out.length).toBe(3);
    expect(Array.from(out.getChannelData(0))).toEqual([2, 3, 4]);
  });

  it("throws on an empty range", () => {
    const buf = makeBuffer(1, 10) as unknown as AudioBuffer;
    expect(() => sliceAudioBuffer(buf, 5, 5)).toThrow();
    expect(() => sliceAudioBuffer(buf, 8, 3)).toThrow();
  });
});

describe("encodeWav", () => {
  it("writes a valid 44-byte PCM header", () => {
    const buf = makeBuffer(2, 4);
    const wav = encodeWav(buf);
    const view = new DataView(wav.buffer);
    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(readAscii(view, 12, 4)).toBe("fmt ");
    expect(readAscii(view, 36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(1000); // sampleRate
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2); // frames * channels * 2
    expect(wav.byteLength).toBe(44 + 4 * 2 * 2);
  });

  it("interleaves channels and clamps out-of-range samples", () => {
    const buf = makeBuffer(2, 2);
    buf.getChannelData(0)[0] = 0;
    buf.getChannelData(0)[1] = 2; // clamp high
    buf.getChannelData(1)[0] = -2; // clamp low
    buf.getChannelData(1)[1] = 1;
    const view = new DataView(encodeWav(buf).buffer);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(32767);
  });
});
