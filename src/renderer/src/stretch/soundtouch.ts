import type { StretchRequest, StretchResponse } from "./soundtouch.worker";

/**
 * SoundTouch time-stretch on the renderer side.
 *
 * The heavy DSP runs in `soundtouch.worker.ts` so changing the speed during
 * playback no longer blocks the UI. Only one stretch is ever in flight: starting
 * a new one cancels the previous worker, which keeps rapid speed changes from
 * piling up CPU work.
 */

let active: { worker: Worker; reject: (err: unknown) => void } | null = null;

function cancelActive(): void {
  if (!active) return;
  const { worker, reject } = active;
  active = null;
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
  reject(new Error("stretch superseded"));
}

/**
 * Time-stretch a decoded AudioBuffer with SoundTouch so that it plays `tempo`
 * times faster/slower while keeping the original pitch. Returns a new
 * AudioBuffer sized for the new duration.
 */
export async function stretchWithSoundtouch(
  original: AudioBuffer,
  tempo: number,
): Promise<AudioBuffer> {
  cancelActive();

  const mono = original.numberOfChannels <= 1;
  const ch = mono ? 1 : 2;
  const channels: Float32Array[] = [];
  // copy: the worker owns the memory, and the original AudioBuffer must stay intact
  for (let c = 0; c < ch; c++)
    channels.push(original.getChannelData(c).slice());

  const worker = new Worker(
    new URL("./soundtouch.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );

  const res = await new Promise<StretchResponse>((resolve, reject) => {
    active = { worker, reject };
    worker.onmessage = (e: MessageEvent<StretchResponse>) => {
      if (active?.worker === worker) active = null;
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      if (active?.worker === worker) active = null;
      worker.terminate();
      reject(e.error ?? new Error(e.message));
    };
    const req: StretchRequest = {
      channels,
      sampleRate: original.sampleRate,
      tempo,
    };
    worker.postMessage(
      req,
      channels.map((c) => c.buffer),
    );
  });

  const ctx = new OfflineAudioContext(1, 1, original.sampleRate);
  const target = ctx.createBuffer(
    ch,
    Math.max(1, res.length),
    original.sampleRate,
  );
  for (let c = 0; c < ch; c++) {
    const data = res.channels[c];
    if (data) target.copyToChannel(data as Float32Array<ArrayBuffer>, c);
  }
  return target;
}
