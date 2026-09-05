<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  store,
  openAudioDialog,
  relinkAudio,
  beatMs,
  barMs,
  formatTime,
} from "../store";
import { engine } from "../engine";
import { SNAP_DIVISIONS } from "../metrics";

const { t } = useI18n();

const hasAudio = computed(() => store.ui.hasAudio);
const audioName = computed(() => store.project.audioName ?? "");
const bpm = computed({
  get: () => store.project.bpm,
  set: (v: number | undefined) => {
    store.project.bpm = clamp(v, 20, 400, 120);
  },
});
const offset = computed({
  get: () => store.project.offsetMs,
  set: (v: number | undefined) => {
    store.project.offsetMs = Math.round(clamp(v ?? 0, -100000, 100000, 0));
  },
});

function clamp(
  v: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (v === undefined || Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

const durationLabel = computed(() =>
  hasAudio.value ? formatTime(engine.durationMs()) : "--:--.---",
);
const sampleRateLabel = computed(() =>
  store.ui.wave ? `${(store.ui.wave.sampleRate / 1000).toFixed(1)} kHz` : "-",
);
const beatLabel = computed(
  () =>
    `${beatMs(store.project.bpm).toFixed(1)} ms / ${barMs(store.project.bpm).toFixed(1)} ms`,
);
const markerCount = computed(() => store.project.markers.length);
const markerLast = computed(() => {
  if (store.project.markers.length === 0) return "--:--.---";
  const last = Math.max(...store.project.markers.map((m) => m.timeMs));
  return formatTime(last);
});
</script>

<template>
  <section class="projectbar">
    <div class="pb-left">
      <div class="pb-title">{{ t("sidebar.project") }}</div>

      <div class="song-row">
        <div class="song-info" :class="{ none: !audioName }">
          <div class="song-name" :title="audioName">
            {{ audioName || t("sidebar.noSong") }}
          </div>
          <div v-if="hasAudio" class="song-sub num">
            {{ t("sidebar.songName") }}
          </div>
        </div>
        <el-button
          v-if="!hasAudio"
          type="primary"
          size="small"
          round
          @click="openAudioDialog()"
        >
          {{ t("sidebar.chooseSong") }}
        </el-button>
        <el-button v-else size="small" text round @click="relinkAudio()">
          {{ t("sidebar.relink") }}
        </el-button>
      </div>

      <div class="param-grid">
        <label class="field">
          <span class="field-label" :title="t('sidebar.bpmTooltip')">
            {{ t("sidebar.bpm") }}
          </span>
          <el-input-number
            v-model="bpm"
            :min="20"
            :max="400"
            :step="1"
            :precision="1"
            size="small"
            controls-position="right"
            class="num"
          />
        </label>
        <label class="field">
          <span class="field-label" :title="t('sidebar.offsetTooltip')">
            {{ t("sidebar.offset") }}
          </span>
          <el-input-number
            v-model="offset"
            :min="-100000"
            :max="100000"
            :step="5"
            size="small"
            controls-position="right"
            class="num"
          />
        </label>
      </div>

      <div class="snap-row">
        <el-switch v-model="store.ui.snapEnabled" size="small" />
        <span class="snap-label">{{ t("sidebar.snapToGrid") }}</span>
        <el-select
          v-model="store.ui.snapDiv"
          size="small"
          class="snap-select"
          :disabled="!store.ui.snapEnabled"
        >
          <el-option
            v-for="d in SNAP_DIVISIONS"
            :key="d"
            :value="d"
            :label="t(`sidebar.snapDiv${d}`)"
          />
        </el-select>
      </div>

      <div v-if="store.ui.audioMissing" class="warn">
        {{ t("dialogs.audioMissing") }}
        <el-button size="small" text type="primary" @click="relinkAudio()">
          {{ t("sidebar.relink") }}
        </el-button>
      </div>
    </div>

    <div class="pb-right">
      <div class="chip">
        <span class="chip-k">{{ t("sidebar.duration") }}</span>
        <span class="chip-v num">{{ durationLabel }}</span>
      </div>
      <div class="chip">
        <span class="chip-k">{{ t("sidebar.sampleRate") }}</span>
        <span class="chip-v num">{{ sampleRateLabel }}</span>
      </div>
      <div class="chip">
        <span class="chip-k">{{ t("sidebar.count") }}</span>
        <span class="chip-v num">{{ markerCount }}</span>
      </div>
      <div class="chip">
        <span class="chip-k">{{ t("sidebar.lastMark") }}</span>
        <span class="chip-v num">{{ markerLast }}</span>
      </div>
      <div class="chip">
        <span class="chip-k">{{ t("sidebar.gridShows") }}</span>
        <span class="chip-v num">{{ beatLabel }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.projectbar {
  flex: none;
  display: flex;
  align-items: stretch;
  background: var(--bdg-bg-panel);
  border-bottom: 1px solid var(--bdg-border);
  min-height: 0;
}
.pb-left {
  width: var(--bdg-left-w);
  flex: none;
  padding: 8px 12px 10px;
  border-right: 1px solid var(--bdg-border);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.pb-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--bdg-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.song-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.song-info {
  flex: 1;
  min-width: 0;
}
.song-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-info.none .song-name {
  color: var(--bdg-text-dim);
  font-weight: 400;
}
.song-sub {
  font-size: 10px;
  color: var(--bdg-text-dim);
}
.param-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.field-label {
  font-size: 11px;
  color: var(--bdg-text-dim);
}
.snap-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.snap-label {
  font-size: 12px;
  color: var(--bdg-text);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.snap-select {
  width: 92px;
  flex: none;
}
.warn {
  font-size: 12px;
  color: #fbbf24;
  display: flex;
  align-items: center;
  gap: 2px;
}
.pb-right {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 6px 16px;
}
.chip {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.chip-k {
  font-size: 10px;
  color: var(--bdg-text-dim);
}
.chip-v {
  font-size: 13px;
  color: var(--bdg-text);
  font-weight: 600;
}
</style>
