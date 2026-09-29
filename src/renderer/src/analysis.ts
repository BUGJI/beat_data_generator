import { reactive } from "vue";
import { engine } from "./engine";
import {
  useProjectStore,
  setBaseBpm,
  addTrack,
  addMarker,
  isBpmLocked,
} from "./stores/project";
import { useTransportStore } from "./stores/transport";
import { tempoMap } from "./services/timeline";
import { historyGestureBegin, historyGestureEnd } from "./services/history";
import { useSettingsStore } from "./stores/settings";
import { t } from "./utils/text";
import type { AnalyseResponse, LiveResponse } from "./analysis.worker";

/**
 * Audio analysis bridge around pleco-xa.
 *
 * Heavy analysis (global beat-track, loop detection, mel spectrogram) runs in
 * a Web Worker so it never blocks the editor UI on audio load. Each capability
 * is gated by an independent setting toggle. A lightweight live-BPM poll runs
 * on a timer over a short audio window while playback is active and never
 * writes into the project.
 */

export const analysis = reactive<{
  bpm: number | null;
  beats: number[]; // seconds
  loopStart: number | null;
  loopEnd: number | null;
  loopConfidence: number | null;
  liveBpm: number | null;
  spectrum: Array<Float32Array> | null;
  spectrumKey: number;
  analyzing: boolean;
}>({
  bpm: null,
  beats: [],
  loopStart: null,
  loopEnd: null,
  loopConfidence: null,
  liveBpm: null,
  spectrum: null,
  spectrumKey: 0,
  analyzing: false,
});

function mono(): Float32Array | null {
  const buf = engine.sourceBuffer;
  if (!buf || buf.length === 0) return null;
  return buf.getChannelData(0) as Float32Array;
}

function sampleRate(): number | null {
  const buf = engine.sourceBuffer;
  return buf ? buf.sampleRate : null;
}

/** Linear-decimate a float signal to a target sample rate (analysis tier). */
function downsample(
  y: Float32Array,
  src: number,
  target: number,
): Float32Array {
  if (src <= target || src <= 0) return y;
  const ratio = src / target;
  const outLen = Math.max(1, Math.floor(y.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(y.length - 1, i0 + 1);
    const f = pos - i0;
    out[i] = y[i0]! * (1 - f) + y[i1]! * f;
  }
  return out;
}

// ---- worker plumbing ----

let worker: Worker | null = null;
let workerId = 0;
/** Identifies the most recently requested full analysis; older in-flight
 *  results are dropped so a slow load can never overwrite a newer one. */
let analysisSeq = 0;
let analyzingCount = 0;
const pending = new Map<number, (res: AnalyseResponse) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent<AnalyseResponse | LiveResponse>) => {
    const res = e.data;
    if (!res) return;
    if (res.kind === "live") {
      const cb = livePending.get(res.id);
      livePending.delete(res.id);
      if (cb) cb(res.bpm);
      return;
    }
    if (res.kind !== "analyze") return;
    const cb = pending.get(res.id);
    pending.delete(res.id);
    if (cb) cb(res);
  };
  worker.onerror = (err) => {
    console.error("[analysis] worker error", err?.message ?? err);
    // Fail every waiting request instead of leaving them pending forever, then
    // drop the broken worker so the next request spins up a fresh one.
    const message = err instanceof Error ? err.message : String(err);
    for (const [id, resolve] of pending) {
      resolve({
        kind: "analyze",
        id,
        bpm: null,
        beats: [],
        loopStart: null,
        loopEnd: null,
        loopConfidence: null,
        spectrum: null,
        error: message,
      });
    }
    pending.clear();
    for (const [, resolve] of livePending) resolve(null);
    livePending.clear();
    worker = null;
  };
  return worker;
}

/** Fire a beat/loop/spectrum analysis in the worker. */
function requestAnalysis(
  wantLoop: boolean,
  wantSpectrum: boolean,
): Promise<AnalyseResponse> {
  const y = mono();
  const sr = sampleRate();
  if (!y || !sr) {
    return Promise.resolve({
      kind: "analyze",
      id: -1,
      bpm: null,
      beats: [],
      loopStart: null,
      loopEnd: null,
      loopConfidence: null,
      spectrum: null,
    });
  }
  // Downsample to a research-grade sample rate before transferring to keep
  // the worker cheap; 22050 Hz is plenty for tempo/loop/spectra analysis.
  const sig = downsample(y, sr, Math.min(sr, 22050));
  const downSr = sr < 22050 ? sr : 22050;
  const id = ++workerId;
  return new Promise<AnalyseResponse>((resolve) => {
    pending.set(id, resolve);
    const w = ensureWorker();
    w.postMessage(
      { kind: "analyze", id, y: sig, sr: downSr, wantLoop, wantSpectrum },
      [sig.buffer],
    );
  });
}

function applyWorkerResult(res: AnalyseResponse): void {
  analysis.bpm = res.bpm;
  analysis.beats = Array.isArray(res.beats) ? res.beats : [];
  analysis.loopStart = res.loopStart;
  analysis.loopEnd = res.loopEnd;
  analysis.loopConfidence = res.loopConfidence;
  if (res.spectrum) {
    analysis.spectrum = res.spectrum;
    analysis.spectrumKey++;
  } else if (res.error) {
    analysis.spectrum = null;
  }
}

/** Shared analysis run: the latest request wins, and `analyzing` tracks any
 *  in-flight run. `autoApply` gates writing detected BPM/beats into the project
 *  (off when re-analyzing or when opening an existing project). */
async function runAnalysis(autoApply: boolean): Promise<void> {
  const mySeq = ++analysisSeq;
  analyzingCount++;
  analysis.analyzing = true;
  try {
    const res = await requestAnalysis(
      useSettingsStore().settings.audioLoopDetect,
      useSettingsStore().settings.audioSpectrum,
    );
    if (mySeq !== analysisSeq) return; // superseded by a newer audio load
    if (res.error) console.error("[analysis]", res.error);
    applyWorkerResult(res);
    if (!autoApply) return;
    // Never auto-touch the project mid-playback: a reload while playing should
    // only fill the readout, not rewrite BPM / tracks under the user.
    if (useTransportStore().playing) return;
    if (useSettingsStore().settings.audioAutoBpm && res.bpm && !isBpmLocked()) {
      setBaseBpm(Math.round(res.bpm));
    }
    if (useSettingsStore().settings.audioAutoBeats && res.beats.length) {
      generateBeatMarkers();
    }
  } finally {
    analyzingCount = Math.max(0, analyzingCount - 1);
    if (analyzingCount === 0) analysis.analyzing = false;
  }
}

/**
 * Re-run analysis for the current audio, honouring loop/spectrum toggles.
 * Returns immediately; state updates when the worker reports back.
 */
export async function analyzeCurrent(): Promise<void> {
  if (analysis.analyzing) return;
  await runAnalysis(false);
}

/** Run on every audio load, honouring each independent toggle. */
export async function onAudioLoaded(autoApply = true): Promise<void> {
  analysis.liveBpm = null;
  await runAnalysis(autoApply);
}

/** Apply detected BPM to the project baseBpm. */
export function applyDetectedBpm(): void {
  if (!analysis.bpm) return;
  setBaseBpm(Math.round(analysis.bpm));
}

/** Place markers at detected beats on a dedicated auto-beat track. */
export function generateBeatMarkers(): void {
  const beats = analysis.beats;
  if (beats.length === 0) return;
  const trackName = t("settings.audio.autoBeatTrackName");
  let track = useProjectStore().tracks.find(
    (t) => t.name === trackName && (!t.type || t.type === "beat"),
  );
  const map = tempoMap();
  if (!track) track = addTrack(trackName);
  historyGestureBegin();
  try {
    for (const sec of beats) {
      const beat = map.beatOfTime(sec * 1000);
      addMarker(track.id, beat);
    }
  } finally {
    historyGestureEnd();
  }
}

// ---- live BPM readout (never writes to the project) ----

let liveTimer: number | undefined;
const livePending = new Map<number, (bpm: number | null) => void>();
let liveSeq = 0;

/** Push a small mono window to the worker for a live tempo estimate. */
function requestLive(seg: Float32Array, sr: number): Promise<number | null> {
  const id = ++liveSeq;
  return new Promise<number | null>((resolve) => {
    livePending.set(id, resolve);
    const w = ensureWorker();
    w.postMessage({ kind: "live", id, y: seg, sr }, [seg.buffer]);
  });
}

function pollLiveBpm(): void {
  // Only compute while playing AND the live-BPM feature is enabled; the
  // heaviest part (quickTempo) runs inside the worker so playback never jerks.
  if (!useSettingsStore().settings.audioLiveBpm) return;
  const y = mono();
  const src = sampleRate();
  const yLen = y ? y.length : 0;
  if (!y || !src || yLen === 0 || !useTransportStore().playing) return;
  const winSec = 6;
  const startSec = Math.max(
    0,
    useTransportStore().positionMs / 1000 - winSec / 2,
  );
  const start = Math.min(yLen - 1, Math.floor(startSec * src));
  const end = Math.min(yLen, start + winSec * src);
  if (end - start < src * 0.5) return;
  const downSr = Math.min(src, 22050);
  const seg = downsample((y as Float32Array).subarray(start, end), src, downSr);
  void requestLive(seg, downSr).then((bpm) => {
    if (bpm !== null) analysis.liveBpm = bpm;
    // keep the last good readout if this window was ambiguous
  });
}

export function startLiveBpm(): void {
  if (liveTimer !== undefined) return;
  liveTimer = window.setInterval(pollLiveBpm, 2000);
}

export function stopLiveBpm(): void {
  if (liveTimer !== undefined) {
    clearInterval(liveTimer);
    liveTimer = undefined;
  }
}

export function initAnalysis(): void {
  startLiveBpm();
  void analyzeCurrent();
}
