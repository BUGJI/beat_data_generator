import type { StretchEngine } from "@shared/settings";
import { StretchTooLargeError } from "./errors";
import { stretchWithSoundtouch } from "./soundtouch";
import { stretchWithSignalsmith } from "./signalsmith";

/**
 * Time-stretch facade. Both backends render an offline, pitch-preserving
 * AudioBuffer for the requested `tempo`; the caller picks one via settings.
 * Signalsmith is newer/higher quality but experimental, so a failure (or
 * timeout) falls back to SoundTouch rather than blocking playback.
 */

const SIGNALSMITH_MIN_TIMEOUT_MS = 15_000;
const SIGNALSMITH_MAX_TIMEOUT_MS = 120_000;
/** After this many consecutive failures, skip Signalsmith for the session. */
const SIGNALSMITH_MAX_FAILURES = 2;
/** Refuse renders whose PCM would be larger than this (1.5 GiB). */
const MAX_STRETCH_BUFFER_BYTES = 1536 * 1024 * 1024;

let signalsmithFailures = 0;

/** Allow Signalsmith to be tried again (e.g. the engine setting changed). */
export function resetStretchFallback(): void {
  signalsmithFailures = 0;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Long renders need more than the fixed startup budget. */
function signalsmithTimeout(original: AudioBuffer): number {
  const duration = Number.isFinite(original.duration) ? original.duration : 0;
  const byDuration = duration * 1000;
  return Math.min(
    SIGNALSMITH_MAX_TIMEOUT_MS,
    Math.max(SIGNALSMITH_MIN_TIMEOUT_MS, byDuration),
  );
}

/** Estimated output PCM for the stretched buffer. */
export function estimateStretchBytes(
  original: AudioBuffer,
  tempo: number,
): number {
  if (!(tempo > 0)) return 0;
  const channels = Math.min(
    2,
    Math.max(1, Number(original.numberOfChannels) || 1),
  );
  const length = Number.isFinite(original.length) ? original.length : 0;
  return Math.ceil(length / tempo) * channels * 4;
}

export async function stretchAudioBuffer(
  original: AudioBuffer,
  tempo: number,
  engine: StretchEngine = "signalsmith",
): Promise<AudioBuffer> {
  const estimated = estimateStretchBytes(original, tempo);
  if (estimated > MAX_STRETCH_BUFFER_BYTES) {
    throw new StretchTooLargeError(estimated);
  }
  if (
    engine === "signalsmith" &&
    signalsmithFailures < SIGNALSMITH_MAX_FAILURES
  ) {
    try {
      const rendered = await withTimeout(
        stretchWithSignalsmith(original, tempo),
        signalsmithTimeout(original),
      );
      signalsmithFailures = 0;
      return rendered;
    } catch (err) {
      signalsmithFailures++;
      if (signalsmithFailures === SIGNALSMITH_MAX_FAILURES) {
        console.warn(
          "[stretch] signalsmith failed repeatedly, falling back to soundtouch",
          err,
        );
      }
    }
  }
  return stretchWithSoundtouch(original, tempo);
}

export { stretchWithSoundtouch };
