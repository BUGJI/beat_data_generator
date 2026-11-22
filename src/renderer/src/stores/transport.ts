import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { engine } from "../engine";
import { patchSettings } from "../services/settingsPersistence";
import { useProjectStore } from "./project";
import type { WaveData } from "../types";

/**
 * Playback session state: transport position, audio presence/waveform and the
 * speed / follow / volume controls. Session-only; nothing here is persisted.
 */
export const useTransportStore = defineStore("transport", () => {
  const playing = ref(false);
  const positionMs = ref(0);
  const volume = ref(0.85);
  const hasAudio = ref(false);
  const wave = ref<WaveData | null>(null);
  /** True while an audio file is being decoded / peaks are being built. */
  const audioLoading = ref(false);
  const audioMissing = ref(false);
  const audioConflict = ref(false);
  const rate = ref(1);
  const pitchFollow = ref(true);
  const buffering = ref(false);
  const followManual = ref(false);
  const followActive = ref(false);
  const followLocked = ref(false);
  const countingIn = ref(false);
  const loopEnabled = ref(false);
  const loopStartMs = ref(0);
  const loopEndMs = ref(0);

  // Content length shown by the timeline / readouts: audio duration or the last
  // tempo point, whichever is longer, plus a small tail. A store getter (rather
  // than a module-level computed) so it is cached per instance and re-evaluates
  // when the project document or the loaded waveform changes.
  const contentEndMs = computed(() => {
    const p = useProjectStore();
    // reading the waveform object too, so reloading audio re-evaluates the cache
    void wave.value;
    const map = p.tempoMap;
    const audioLen = hasAudio.value ? engine.durationMs() : 0;
    // Per-track arrays are sorted by beat, so the latest beat is the last item
    // of each list. This avoids converting every marker to a time (a tempo-map
    // lookup each) on every edit — noticeable while dragging markers.
    let maxBeat = -Infinity;
    for (const arr of p.markersByTrack.values()) {
      const last = arr[arr.length - 1];
      if (last && last.beat > maxBeat) maxBeat = last.beat;
    }
    let maxMarker = maxBeat === -Infinity ? 0 : map.timeOfBeat(maxBeat);
    for (const pt of p.bpmPoints) {
      const tm = map.timeOfBeat(pt.beat);
      if (tm > maxMarker) maxMarker = tm;
    }
    const minLen = Math.max(audioLen, maxMarker);
    if (minLen <= 0) return map.timeOfBeat(16);
    return Math.max(minLen + 2000, map.timeOfBeat(16));
  });

  return {
    playing,
    positionMs,
    volume,
    hasAudio,
    wave,
    audioLoading,
    audioMissing,
    audioConflict,
    rate,
    pitchFollow,
    buffering,
    followManual,
    followActive,
    followLocked,
    countingIn,
    loopEnabled,
    loopStartMs,
    loopEndMs,
    contentEndMs,
  };
});

export function setVolume(v: number): void {
  useTransportStore().volume = v;
  engine.setVolume(v);
}

export function resetLoopState(): void {
  const t = useTransportStore();
  t.loopEnabled = false;
  t.loopStartMs = 0;
  t.loopEndMs = 0;
  engine.setLoop(false, 0, 0);
}

export function disableFollowOnScrub(): void {
  const t = useTransportStore();
  if (t.playing) {
    t.followActive = false;
    t.followLocked = true;
  }
}

export function clickFollow(): void {
  const t = useTransportStore();
  if (t.buffering) return;
  if (t.playing) {
    if (t.followActive) {
      t.followActive = false;
      t.followLocked = true;
    } else {
      t.followActive = true;
      t.followLocked = false;
    }
    return;
  }
  t.followManual = !t.followManual;
  void patchSettings({ followPreset: t.followManual });
  if (!t.followManual) t.followActive = false;
}
