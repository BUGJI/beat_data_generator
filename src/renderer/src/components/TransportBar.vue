<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  store,
  play,
  stop,
  togglePlay,
  seekTo,
  formatTime,
  durationReadout,
  setVolume,
} from "../store";

const { t } = useI18n();

const cur = computed(() => store.ui.positionMs);
const playing = computed(() => store.ui.playing);
const hasAudio = computed(() => store.ui.hasAudio);
const vol = computed({
  get: () => store.ui.volume,
  set: (v: number) => setVolume(v),
});
const totalLabel = computed(() =>
  hasAudio.value ? durationReadout() : "--:--.---",
);
</script>

<template>
  <footer class="transport">
    <div class="tr-left num">
      {{ t("transport.bpmReadout") }}: {{ store.project.bpm.toFixed(1) }}
    </div>

    <div class="tr-controls">
      <button
        class="btn-icon"
        :disabled="!hasAudio"
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
        :disabled="!hasAudio"
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
      <button
        class="btn-icon"
        :disabled="!hasAudio"
        :title="t('transport.stop')"
        @click="stop()"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" rx="1" />
        </svg>
      </button>

      <div class="tr-divider" />

      <div class="tr-time num">
        <span class="cur">{{ formatTime(cur) }}</span>
        <span class="sep">/</span>
        <span class="total">{{ totalLabel }}</span>
      </div>

      <div v-if="!playing" class="tr-fine">
        <el-button size="small" text class="num" @click="play()">{{
          t("transport.play")
        }}</el-button>
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
.tr-left {
  width: var(--bdg-left-w);
  font-size: 12px;
  color: var(--bdg-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
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
.tr-fine {
  display: none;
}
</style>
