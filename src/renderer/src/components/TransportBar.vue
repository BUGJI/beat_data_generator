<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import {
  store,
  stop,
  togglePlay,
  seekTo,
  formatTime,
  contentEndMs,
  setVolume,
  applySpeed,
  bpmAtTime,
} from "../store";
import { analysis } from "../analysis";

const { t } = useI18n();

const playing = computed(() => store.ui.playing);
const hasAudio = computed(() => store.ui.hasAudio);
const vol = computed({
  get: () => store.ui.volume,
  set: (v: number) => setVolume(v),
});
const totalLabel = computed(() =>
  hasAudio.value ? formatTime(contentEndMs()) : "--:--.---",
);
const bpmLabel = computed(() => bpmAtTime(store.ui.positionMs).toFixed(1));
const liveBpmOn = computed(() => store.ui.settings.audioLiveBpm && !!analysis.liveBpm);
const liveBpmLabel = computed(() =>
  analysis.liveBpm ? analysis.liveBpm.toFixed(1) : "--",
);

const speed = computed({
  get: () => store.ui.rate,
  set: (v: number | undefined) => {
    applySpeed(v ?? 1, store.ui.pitchFollow);
  },
});
const freeInput = computed(() => store.ui.settings.devFreeInput);
const pitchFollow = computed({
  get: () => store.ui.pitchFollow,
  set: (v: boolean) => {
    applySpeed(store.ui.rate, v);
  },
});

// ---- rate control: hover + mouse wheel (wheel up faster, down slower) ----

let wheelAcc = 0;
let wheelRaf = 0;

function onRateWheel(e: WheelEvent): void {
  e.preventDefault();
  wheelAcc += e.deltaY;
  if (wheelRaf) return;
  wheelRaf = requestAnimationFrame(() => {
    wheelRaf = 0;
    const d = wheelAcc;
    wheelAcc = 0;
    if (!d) return;
    const steps = Math.round(d / 100); // each wheel notch ≈ 0.05
    // snap onto the 0.05 grid first so values like 1.00 stay reachable
    const cur = store.ui.rate;
    const grid = Math.round(cur / 0.05) * 0.05;
    let v = grid - steps * 0.05;
    v = Math.min(4, Math.max(0.1, v));
    const next = Math.round(v * 100) / 100;
    if (next !== cur) applySpeed(next, store.ui.pitchFollow);
  });
}

onBeforeUnmount(() => {
  cancelAnimationFrame(wheelRaf);
  wheelRaf = 0;
});
</script>

<template>
  <footer class="transport">
    <div class="rate-zone">
      <div class="tr-left num">
        <span class="bpm-dot" />
        <span class="bpm-main">BPM {{ bpmLabel }}</span>
        <span
          v-if="liveBpmOn"
          class="live-bpm"
          :title="t('transport.bpmReadout')"
        >{{ t("transport.bpmReadout") }}: {{ liveBpmLabel }}</span>
      </div>
      <div
        class="rate-ctl"
        :title="t('transport.rateTooltip')"
        @wheel="onRateWheel"
      >
        <span class="rate-label">{{ t("transport.speedRate") }}</span>
        <el-input-number
          v-model="speed"
          :min="freeInput ? undefined : 0.1"
          :max="freeInput ? undefined : 4"
          :step="0.05"
          :precision="freeInput ? undefined : 2"
          size="small"
          controls-position="right"
          class="num rate-input"
        />
      </div>
      <div class="rate-ctl" :title="t('transport.pitchTooltip')">
        <el-switch v-model="pitchFollow" size="small" />
        <span class="rate-label">{{ t("transport.pitchFollow") }}</span>
      </div>
    </div>

    <div class="tr-controls">
      <button
        class="btn-icon"
        :title="t('transport.backStart')"
        @click="seekTo(0)"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
          <path d="M3 2h2v12H3zM13 2v12L6 8z" />
        </svg>
      </button>
      <button
        class="btn-big"
        :class="{ playing }"
        :title="playing ? t('transport.pause') : t('transport.play')"
        @click="togglePlay()"
      >
        <svg
          v-if="!playing"
          viewBox="0 0 16 16"
          width="18"
          height="18"
          fill="currentColor"
        >
          <path d="M4 2l10 6-10 6z" />
        </svg>
        <svg
          v-else
          viewBox="0 0 16 16"
          width="18"
          height="18"
          fill="currentColor"
        >
          <path d="M4 2h3v12H4zM9 2h3v12H9z" />
        </svg>
      </button>
      <button class="btn-icon" :title="t('transport.stop')" @click="stop()">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" rx="1" />
        </svg>
      </button>

      <div class="tr-divider" />

      <span v-if="store.ui.buffering" class="buffering">{{
        t("transport.buffering")
      }}</span>
      <div class="tr-time num">
        <span class="cur">{{ formatTime(store.ui.positionMs) }}</span>
        <span class="sep">/</span>
        <span class="total">{{ totalLabel }}</span>
      </div>
    </div>

    <div class="tr-right">
      <span class="vol-label">{{ t("transport.volume") }}</span>
      <el-slider
        v-model="vol"
        :min="0"
        :max="1"
        :step="0.01"
        class="vol-slider"
      />
    </div>
  </footer>
</template>

<style scoped>
.transport {
  flex: none;
  height: var(--bdg-transport-h);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: linear-gradient(0deg, #14181f, #171c24);
  border-top: 1px solid var(--bdg-border);
}
.rate-zone {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding-right: 16px;
  margin-right: 4px;
  border-right: 1px solid var(--bdg-border);
  height: 100%;
}
.tr-left {
  font-size: 13px;
  color: var(--bdg-text);
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.buffering {
  font-size: 11px;
  color: #fbbf24;
  letter-spacing: 0.05em;
}
.rate-ctl {
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 6px;
  padding: 2px 4px;
}
.rate-ctl:hover {
  background: rgba(148, 163, 184, 0.08);
}
.rate-ctl:hover .rate-label {
  color: var(--bdg-text);
}
.rate-label {
  font-size: 11px;
  color: var(--bdg-text-dim);
  white-space: nowrap;
}
.rate-input {
  width: 92px;
}
.bpm-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
}
.bpm-main {
  font-weight: 700;
}
.live-bpm {
  font-size: 11px;
  color: var(--bdg-accent);
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.22);
  padding: 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.tr-controls {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.btn-icon,
.btn-big {
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--bdg-text);
  background: transparent;
  border-radius: 8px;
  font-family: inherit;
}
.btn-icon {
  width: 30px;
  height: 30px;
}
.btn-icon:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.14);
}
.btn-big {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--bdg-accent), #0ea5e9);
  color: #04121d;
  box-shadow: 0 2px 10px rgba(56, 189, 248, 0.35);
}
.btn-big:hover:not(:disabled) {
  filter: brightness(1.1);
}
.btn-big.playing {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  box-shadow: 0 2px 10px rgba(251, 191, 36, 0.35);
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
.tr-divider {
  width: 1px;
  height: 26px;
  background: var(--bdg-border);
  margin: 0 4px;
}
.tr-time {
  font-size: 17px;
  letter-spacing: 0.5px;
}
.tr-time .cur {
  color: var(--bdg-text);
  font-weight: 700;
}
.tr-time .sep {
  color: var(--bdg-text-dim);
  margin: 0 8px;
}
.tr-time .total {
  color: var(--bdg-text-dim);
}
.tr-right {
  width: 260px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.vol-label {
  font-size: 11px;
  color: var(--bdg-text-dim);
  white-space: nowrap;
}
.vol-slider {
  flex: 1;
  --el-slider-main-bg-color: var(--bdg-accent);
  --el-slider-runway-bg-color: rgba(148, 163, 184, 0.2);
}
</style>
