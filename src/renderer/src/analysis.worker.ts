/// <reference lib="webworker" />
import { beat_track, quickTempo, loop, feature } from "pleco-xa";

/**
 * pleco-xa analysis worker.
 *
 * Runs the heavy DSP (beat-track DP, loop detection, mel spectrogram) and the
 * periodic live-BPM readout off the renderer's main thread so the editor stays
 * responsive while audio loads and while it plays. Receives mono signals
 * (transferred) and returns results.
 */

export type AnalyseRequest = {
  kind: "analyze";
  id: number;
  y: Float32Array;
  sr: number;
  /** Absolute start of `y` within the full track, in seconds. Results are
   *  shifted back by this so beats / loop times always reference the whole
   *  track even when only a bounded excerpt was analysed. */
  startSec?: number;
  wantLoop: boolean;
  wantSpectrum: boolean;
};

export type AnalyseResponse = {
  kind: "analyze";
  id: number;
  bpm: number | null;
  beats: number[];
  loopStart: number | null;
  loopEnd: number | null;
  loopConfidence: number | null;
  spectrum: Array<Float32Array> | null;
  error?: string;
};

export type LiveRequest = {
  kind: "live";
  id: number;
  y: Float32Array;
  sr: number;
};

export type LiveResponse = {
  kind: "live";
  id: number;
  bpm: number | null;
  error?: string;
};

export type WorkerResponse = AnalyseResponse | LiveResponse;

/**
 * Absolute ceiling on the analysed span, independent of the renderer's
 * setting, so a caller that bypasses the UI (e.g. a plugin) still cannot hand
 * the DSP a multi-hour signal whose full STFT would exhaust memory.
 */
const ANALYSIS_HARD_MAX_SEC = 3600;

const post = (msg: WorkerResponse): void =>
  (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(
    msg,
  );

self.onmessage = async (e: MessageEvent<AnalyseRequest | LiveRequest>) => {
  const req = e.data;
  if (!req) return;

  if (req.kind === "live") {
    const res: LiveResponse = { kind: "live", id: req.id, bpm: null };
    try {
      const y = new Float32Array(req.y);
      if (req.sr > 0 && y.length > 0) {
        const { bpm } = quickTempo(y, req.sr, {
          windowSec: 6,
          minBpm: 60,
          maxBpm: 240,
        });
        res.bpm = Number.isFinite(bpm) ? bpm : null;
      }
    } catch (err) {
      res.error = err instanceof Error ? err.message : String(err);
    }
    post(res);
    return;
  }

  if (req.kind !== "analyze") return;

  const res: AnalyseResponse = {
    kind: "analyze",
    id: req.id,
    bpm: null,
    beats: [],
    loopStart: null,
    loopEnd: null,
    loopConfidence: null,
    spectrum: null,
  };

  try {
    const sr = req.sr;
    const startSec = Number.isFinite(req.startSec)
      ? (req.startSec as number)
      : 0;
    const hardMax = sr > 0 ? Math.floor(ANALYSIS_HARD_MAX_SEC * sr) : 0;
    const source = req.y ? new Float32Array(req.y) : new Float32Array();
    const y =
      hardMax > 0 && source.length > hardMax
        ? source.subarray(0, hardMax)
        : source;
    const bt = beat_track(y, sr, { units: "time" });
    res.bpm =
      typeof bt.tempo === "number" && Number.isFinite(bt.tempo)
        ? bt.tempo
        : null;
    res.beats = Array.isArray(bt.beats)
      ? (bt.beats as number[])
          .filter((n) => Number.isFinite(n))
          .map((n) => n + startSec)
      : [];

    if (req.wantLoop && sr > 0) {
      const shim = {
        getChannelData: () => y,
        sampleRate: sr,
        length: y.length,
        duration: y.length / sr,
      };
      const lp = await loop.detect(shim, { strategy: "fast" });
      res.loopStart =
        typeof lp.loopStart === "number" ? lp.loopStart + startSec : null;
      res.loopEnd =
        typeof lp.loopEnd === "number" ? lp.loopEnd + startSec : null;
      res.loopConfidence =
        typeof lp.confidence === "number" ? lp.confidence : null;
    }

    if (req.wantSpectrum && sr > 0 && y.length > 0) {
      const mel = feature.melspectrogram(y, {
        sr,
        n_mels: 56,
        power: 2,
      });
      res.spectrum = Array.isArray(mel) ? mel : null;
    }
  } catch (err) {
    res.error = err instanceof Error ? err.message : String(err);
  }

  post(res);
};
