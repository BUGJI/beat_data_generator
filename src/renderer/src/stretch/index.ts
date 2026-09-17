import type { StretchEngine } from "@shared/settings";
import { stretchWithSoundtouch } from "./soundtouch";
import { stretchWithSignalsmith } from "./signalsmith";

/**
 * Time-stretch facade. Both backends render an offline, pitch-preserving
 * AudioBuffer for the requested `tempo`; the caller picks one via settings.
 * Signalsmith is newer/higher quality but experimental, so any failure (or
 * timeout) falls back to SoundTouch rather than blocking playback.
 */

const SIGNALSMITH_TIMEOUT_MS = 15_000;

let fellBack = false;

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

export async function stretchAudioBuffer(
  original: AudioBuffer,
  tempo: number,
  engine: StretchEngine = "soundtouch",
): Promise<AudioBuffer> {
  if (engine === "signalsmith") {
    try {
      return await withTimeout(
        stretchWithSignalsmith(original, tempo),
        SIGNALSMITH_TIMEOUT_MS,
      );
    } catch (err) {
      if (!fellBack) {
        fellBack = true;
        console.warn(
          "[stretch] signalsmith failed, falling back to soundtouch",
          err,
        );
      }
    }
  }
  return stretchWithSoundtouch(original, tempo);
}

export { stretchWithSoundtouch };
