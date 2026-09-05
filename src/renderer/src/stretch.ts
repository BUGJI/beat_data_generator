import { SoundTouch, SimpleFilter, WebAudioBufferSource } from "soundtouchjs";

const CHUNK = 65536;

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Time-stretch a decoded AudioBuffer so that it plays `tempo` times faster/slower
 * while keeping the original pitch. Returns a new AudioBuffer sized for the new
 * duration. Pure offline processing with periodic yields to keep the UI alive.
 */
export async function stretchAudioBuffer(
  original: AudioBuffer,
  tempo: number,
): Promise<AudioBuffer> {
  const n = original.length;
  const outCap = Math.ceil(n / tempo) + original.sampleRate + 8192;
  const out = new Float32Array(outCap * 2);
  const st = new SoundTouch();
  st.sampleRate = original.sampleRate;
  st.channels = 2;
  st.rate = 1;
  st.pitch = 1;
  st.tempo = tempo;
  const source = new WebAudioBufferSource(original);
  const filter = new SimpleFilter(source, st, () => {});
  const tmp = new Float32Array(CHUNK * 2);
  let total = 0;
  let guard = 0;
  let sinceYield = 0;
  while (total < outCap && guard++ < 1e6) {
    const got = filter.extract(tmp, CHUNK);
    if (got === 0) break;
    if (total + got > outCap) break;
    out.set(tmp.subarray(0, got * 2), total * 2);
    total += got;
    if (++sinceYield >= 8) {
      sinceYield = 0;
      await tick();
    }
  }
  const mono = original.numberOfChannels <= 1;
  const ctx = new OfflineAudioContext(1, 1, original.sampleRate);
  const target = ctx.createBuffer(
    mono ? 1 : 2,
    Math.max(1, total),
    original.sampleRate,
  );
  const L = target.getChannelData(0);
  for (let i = 0; i < total; i++) L[i] = out[i * 2];
  if (!mono) {
    const R = target.getChannelData(1);
    for (let i = 0; i < total; i++) R[i] = out[i * 2 + 1];
  }
  return target;
}
