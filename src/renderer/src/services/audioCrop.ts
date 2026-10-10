/**
 * Pure audio cropping helpers.
 *
 * `sliceAudioBuffer` cuts a decoded AudioBuffer to `[startMs, endMs)` and
 * `encodeWav` serializes an AudioBuffer (or anything AudioBuffer-shaped) to an
 * uncompressed 16-bit PCM WAV. The encoder is dependency-free so a plugin can
 * export a trimmed WAV without pulling in a codec library.
 */

/** Minimal shape the WAV encoder needs; a real AudioBuffer satisfies it. */
export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/** Clamp a value into `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Sample index of `ms` in a buffer of `sampleRate`, clamped to `[0, length]`. */
export function sampleOfMs(
  ms: number,
  sampleRate: number,
  length: number,
): number {
  const s = Math.round((ms / 1000) * sampleRate);
  return clamp(Number.isFinite(s) ? s : 0, 0, length);
}

/**
 * Cut `buffer` to the `[startMs, endMs)` span.
 *
 * Throws when the resulting span is empty (start >= end) so callers surface a
 * clear error instead of producing a silent 1-sample buffer.
 */
export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startMs: number,
  endMs: number,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const start = sampleOfMs(startMs, sampleRate, buffer.length);
  const end = sampleOfMs(endMs, sampleRate, buffer.length);
  const length = end - start;
  if (length <= 0) throw new Error("audio crop range is empty");
  const out = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length,
    sampleRate,
  });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c).subarray(start, end);
    out.getChannelData(c).set(src);
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i) & 0xff);
  }
}

/**
 * Encode an AudioBuffer-like source to a 16-bit PCM WAV file.
 *
 * Interleaves channels and clamps samples to `[-1, 1]` before quantizing, so an
 * out-of-range float can never wrap around to the opposite polarity.
 */
export function encodeWav(buffer: AudioBufferLike): Uint8Array {
  const channels = Math.max(1, buffer.numberOfChannels);
  const frames = Math.max(0, buffer.length);
  const sampleRate = Math.max(1, buffer.sampleRate);
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = clamp(data[c]?.[i] ?? 0, -1, 1);
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += bytesPerSample;
    }
  }
  return out;
}
