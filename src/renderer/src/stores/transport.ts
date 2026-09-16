import { defineStore } from "pinia";
import { ref } from "vue";
import { engine } from "../engine";
import { patchSettings } from "./settings";
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
  const audioMissing = ref(false);
  const audioConflict = ref(false);
  const rate = ref(1);
  const pitchFollow = ref(true);
  const buffering = ref(false);
  const followManual = ref(false);
  const followActive = ref(false);
  const followLocked = ref(false);

  return {
    playing,
    positionMs,
    volume,
    hasAudio,
    wave,
    audioMissing,
    audioConflict,
    rate,
    pitchFollow,
    buffering,
    followManual,
    followActive,
    followLocked,
  };
});

export function setVolume(v: number): void {
  useTransportStore().volume = v;
  engine.setVolume(v);
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
