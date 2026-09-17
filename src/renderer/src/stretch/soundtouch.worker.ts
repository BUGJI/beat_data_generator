/// <reference lib="webworker" />
import { SoundTouch, SimpleFilter, WebAudioBufferSource } from "soundtouchjs";

/**
 * SoundTouch time-stretch worker.
 *
 * The stretch loop is CPU-heavy (hundreds of ms to seconds for a full song), so
 * it runs here instead of on the renderer's main thread; that is what kept the
 * UI stuttering when the speed was changed mid-playback. The renderer hands over
 * deinterleaved channel copies and gets the stretched PCM back.
 */

export interface StretchRequest {
  channels: Float32Array[];
  sampleRate: number;
  tempo: number;
}

export interface StretchResponse {
  channels: Float32Array[];
  length: number;
}

const CHUNK = 65536;

/** AudioBuffer-shaped shim so soundtouchjs can read plain channel arrays. */
function bufferLike(channels: Float32Array[], sampleRate: number) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData: (c: number): Float32Array =>
      channels[Math.min(c, channels.length - 1)] as Float32Array,
  };
}

self.onmessage = (e: MessageEvent<StretchRequest>): void => {
  const { channels, sampleRate, tempo } = e.data;
  const ch = channels.length;
  const n = channels[0].length;
  const outCap = Math.ceil(n / tempo) + sampleRate + 8192;
  const out = new Float32Array(outCap * ch);

  const st = new SoundTouch();
  st.sampleRate = sampleRate;
  st.channels = ch;
  st.rate = 1;
  st.pitch = 1;
  st.tempo = tempo;

  const source = new WebAudioBufferSource(
    bufferLike(channels, sampleRate) as unknown as AudioBuffer,
  );
  const filter = new SimpleFilter(source, st, () => {});
  const tmp = new Float32Array(CHUNK * ch);
  let total = 0;
  let guard = 0;
  while (total < outCap && guard++ < 1e6) {
    const got = filter.extract(tmp, CHUNK);
    if (got === 0) break;
    if (total + got > outCap) break;
    out.set(tmp.subarray(0, got * ch), total * ch);
    total += got;
  }

  const result: StretchResponse = { channels: [], length: total };
  for (let c = 0; c < ch; c++) {
    const arr = new Float32Array(total);
    for (let i = 0; i < total; i++) arr[i] = out[i * ch + c] as number;
    result.channels.push(arr);
  }
  (self as unknown as Worker).postMessage(
    result,
    result.channels.map((a) => a.buffer),
  );
};
