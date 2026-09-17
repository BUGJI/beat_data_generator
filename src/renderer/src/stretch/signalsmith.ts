import SignalsmithStretch from "signalsmith-stretch";

/** Extra render tail so the worklet's final block is not cut off. */
const TAIL_SECONDS = 0.25;

/**
 * Experimental time-stretch via Signalsmith Stretch (WASM/AudioWorklet).
 *
 * Signalsmith is a realtime node, but we only need an offline buffer to match
 * the existing playback model, so it is rendered through an OfflineAudioContext
 * and trimmed to the expected stretched length. Requires `worker-src blob:` in
 * the CSP because the worklet module is loaded from a blob URL.
 */
export async function stretchWithSignalsmith(
  original: AudioBuffer,
  tempo: number,
): Promise<AudioBuffer> {
  const sr = original.sampleRate;
  const ch = Math.min(2, original.numberOfChannels);
  const expected = Math.max(1, Math.ceil(original.length / tempo));
  const tail = Math.ceil(sr * TAIL_SECONDS);

  const ctx = new OfflineAudioContext(ch, expected + tail, sr);
  const node = await SignalsmithStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [ch],
  });
  node.connect(ctx.destination);

  const channels: Float32Array[] = [];
  for (let c = 0; c < ch; c++) channels.push(original.getChannelData(c));
  await node.addBuffers(channels);
  await node.schedule({ active: true, input: 0, rate: tempo });

  const rendered = await ctx.startRendering();
  if (rendered.length === expected) return rendered;

  const out = new AudioBuffer({
    length: expected,
    numberOfChannels: ch,
    sampleRate: sr,
  });
  for (let c = 0; c < ch; c++) {
    const src = rendered.getChannelData(c);
    out.copyToChannel(src.subarray(0, Math.min(expected, src.length)), c);
  }
  return out;
}
