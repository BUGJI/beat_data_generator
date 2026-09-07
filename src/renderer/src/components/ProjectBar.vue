<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  store,
  openAudioDialog,
  relinkAudio,
  setBaseBpm,
  setOffset,
  contentEndMs,
  formatTime,
  tempoMap,
  timeOfBeat,
  markerCount,
  visibleMarkers,
  clickFollow,
  toggleTimeAlign,
} from "../store";
import { SNAP_DIVISIONS } from "../metrics";

const { t } = useI18n();

// ---- beat indicators ----
// left: lights on every marker passed; right: lights when >=2 markers coincide,
// colour mapping to how many markers share the instant. Both fade in 0.1s and
// can be re-triggered (interrupted) by the next event.

const FLASH_MS = 100;

function hexRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function flashStyle(
  k: number,
  color: string,
): { background: string; borderColor: string; boxShadow: string } {
  const c = hexRgb(color);
  const rgb = `${c.r},${c.g},${c.b}`;
  return {
    background: `rgba(${rgb},${(0.08 + 0.92 * k).toFixed(3)})`,
    borderColor: `rgba(${rgb},${(0.35 + 0.65 * k).toFixed(3)})`,
    boxShadow: k > 0 ? `0 0 14px rgba(${rgb},${(0.9 * k).toFixed(3)})` : "none",
  };
}

function makeFlash(source: () => number) {
  const intensity = ref(0);
  let start = 0;
  let raf = 0;
  watch(source, () => {
    start = performance.now();
    cancelAnimationFrame(raf);
    const step = (): void => {
      const k = Math.max(0, 1 - (performance.now() - start) / FLASH_MS);
      intensity.value = k;
      if (k > 0) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  const stop = (): void => cancelAnimationFrame(raf);
  return { intensity, stop };
}

const beat = makeFlash(() => store.ui.beatPulse);
const overlap = makeFlash(() => store.ui.overlapPulse);

onBeforeUnmount(() => {
  beat.stop();
  overlap.stop();
});

const overlapColor = computed(() => {
  const n = store.ui.overlapCount;
  if (n >= 4) return "#f43f5e";
  if (n === 3) return "#fb923c";
  return "#fbbf24";
});

const beatStyle = computed(() => flashStyle(beat.intensity.value, "#38bdf8"));
const overlapStyle = computed(() =>
  flashStyle(overlap.intensity.value, overlapColor.value),
);

const hasAudio = computed(() => store.ui.hasAudio);
const followOn = computed(() =>
  store.ui.playing ? store.ui.followActive : store.ui.followManual,
);
const followTip = computed(() => {
  if (store.ui.playing)
    return store.ui.followActive ? t("follow.onTip") : t("follow.offPlayTip");
  return t("follow.stopTip");
});
const audioName = computed(() => {
  const n = store.project.audioName;
  if (!n) return "";
  return n.split(/[\\/]/).pop() ?? n;
});
const baseBpm = computed({
  get: () => store.project.baseBpm,
  set: (v: number | undefined) => {
    setBaseBpm(v ?? 120);
  },
});
const offset = computed({
  get: () => store.project.offsetMs,
  set: (v: number | undefined) => {
    setOffset(v ?? 0);
  },
});

const durationLabel = computed(() =>
  hasAudio.value ? formatTime(contentEndMs()) : "--:--.---",
);
const sampleRateLabel = computed(() =>
  store.ui.wave ? `${(store.ui.wave.sampleRate / 1000).toFixed(1)} kHz` : "-",
);
const barMsLabel = computed(() => {
  const m = tempoMap();
  return `${(m.timeOfBeat(1) - m.timeOfBeat(0)).toFixed(1)} ms/${m.bpmAtBeat(0).toFixed(1)} BPM`;
});
const lastBeatLabel = computed(() => {
  const markers = visibleMarkers();
  if (markers.length === 0) return "--:--.---";
  const last = Math.max(...markers.map((m) => timeOfBeat(m.beat)));
  return formatTime(last);
});
const markersLabel = computed(() => String(markerCount()));
const zoomLabel = computed(
  () => `${store.ui.pxPerSec.toFixed(1)} px/s`,
);
const followPctLabel = computed(
  () => `${store.ui.settings.followPercent}%`,
);

function wheelOffset(e: WheelEvent): void {
  const step = Math.sign(e.deltaY) * 5;
  const cur = store.project.offsetMs;
  const v = freeInput.value ? cur - step : Math.max(-100000, Math.min(100000, cur - step));
  if (v !== cur) offset.value = v;
}

function toggleSnap(): void {
  store.ui.snapEnabled = !store.ui.snapEnabled;
}

// dev "free input" toggle relaxes numeric bounds/precision while typing
const freeInput = computed(() => store.ui.settings.devFreeInput);

// ---- beat grid / snap division: pick a preset or type a custom denominator ----

const snapOptions = computed<Array<{ value: number; label: string }>>(() => {
  const custom = store.ui.snapDiv;
  const list = SNAP_DIVISIONS.map((d) => ({
    value: d as number,
    label: `1/${d}`,
  }));
  if (!list.some((o) => o.value === custom)) {
    list.push({ value: custom, label: `1/${custom}` });
    list.sort((a, b) => a.value - b.value);
  }
  return list;
});

function parseSnapDenominator(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const m = /^(?:1\/)?(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!m) return null;
  const d = Number(m[1]);
  return d > 0 ? d : null;
}

const snapDiv = computed({
  get: () => store.ui.snapDiv,
  set: (v: string | number) => {
    const d = parseSnapDenominator(v);
    if (d !== null) store.ui.snapDiv = d;
  },
});
</script>

<template>
  <section class="projectbar">
    <div class="pb-left">
      <div class="song-row">
        <div class="song-info" :class="{ none: !audioName }">
          <div class="song-name" :title="audioName">
            {{ audioName || t("sidebar.noSong") }}
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
            {{ t("sidebar.baseBpm") }}
          </span>
          <el-input-number
            v-model="baseBpm"
            :min="freeInput ? undefined : 20"
            :max="freeInput ? undefined : 999"
            :step="1"
            :precision="freeInput ? undefined : 1"
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
            :min="freeInput ? undefined : -100000"
            :max="freeInput ? undefined : 100000"
            :step="5"
            size="small"
            controls-position="right"
            class="num"
            @wheel.prevent="wheelOffset"
          />
        </label>
      </div>

      <div class="snap-row">
        <span class="snap-label">{{ t("sidebar.snapToGrid") }}</span>
        <el-select
          v-model="snapDiv"
          size="small"
          class="snap-select"
          filterable
          allow-create
          default-first-option
        >
          <el-option
            v-for="d in snapOptions"
            :key="d.value"
            :value="d.value"
            :label="d.label"
          />
        </el-select>
        <span class="snap-unit">{{ t("sidebar.snapUnit") }}</span>
      </div>

      <div v-if="store.ui.audioMissing || store.ui.audioConflict" class="warn">
        {{
          store.ui.audioConflict
            ? t("dialogs.audioMismatch")
            : t("dialogs.audioMissing")
        }}
        <el-button size="small" text type="primary" @click="relinkAudio()">
          {{ t("sidebar.relink") }}
        </el-button>
      </div>
    </div>

    <div class="pb-right">
      <div class="pb-chips">
        <div class="chip">
          <span class="chip-k">{{ t("sidebar.zoom") }}</span>
          <span class="chip-v num">{{ zoomLabel }}</span>
        </div>
        <div class="chip">
          <span class="chip-k">{{ t("sidebar.duration") }}</span>
          <span class="chip-v num">{{ durationLabel }}</span>
        </div>
        <div class="chip">
          <span class="chip-k">{{ t("sidebar.sampleRate") }}</span>
          <span class="chip-v num">{{ sampleRateLabel }}</span>
        </div>
        <div class="chip">
          <span class="chip-k">{{ t("sidebar.markers") }}</span>
          <span class="chip-v num">{{ markersLabel }}</span>
        </div>
        <div class="chip">
          <span class="chip-k">{{ t("sidebar.lastMark") }}</span>
          <span class="chip-v num">{{ lastBeatLabel }}</span>
        </div>
        <div class="chip">
          <span class="chip-k">{{ t("sidebar.gridShows") }}</span>
          <span class="chip-v num">{{ barMsLabel }}</span>
        </div>
        <div class="chip">
          <span class="chip-k" :title="t('follow.pctTip')">{{
            t("sidebar.followTrigger")
          }}</span>
          <span class="chip-v num" :title="t('follow.pctTip')">{{
            followPctLabel
          }}</span>
        </div>
      </div>

      <div class="pb-quick">
        <span
          class="beat-ind"
          :style="beatStyle"
          :title="t('follow.beatTip')"
        />
        <span
          class="beat-ind beat-overlap"
          :style="overlapStyle"
          :title="t('follow.overlapTip')"
        />
        <button
          class="quick-icon"
          :class="{ on: store.ui.glowEnabled }"
          :title="t('follow.glowTip')"
          @click="store.ui.glowEnabled = !store.ui.glowEnabled"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 9.5l5.1-1.9z"
              fill="currentColor"
              stroke="none"
            />
            <circle cx="18.6" cy="5.4" r="1.4" fill="currentColor" />
            <circle cx="5.4" cy="18.6" r="1.4" fill="currentColor" />
          </svg>
        </button>
        <button
          class="follow-btn"
          :class="{ on: followOn }"
          :title="followTip"
          @click="clickFollow()"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
        <span class="quick-divider" />
        <button
          class="quick-icon"
          :class="{ on: store.ui.snapEnabled }"
          :title="t('sidebar.snapToGrid')"
          @click="toggleSnap()"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <rect x="3" y="3" width="7.2" height="7.2" rx="1.2" />
            <rect x="13.8" y="3" width="7.2" height="7.2" rx="1.2" />
            <rect x="3" y="13.8" width="7.2" height="7.2" rx="1.2" />
            <rect x="13.8" y="13.8" width="7.2" height="7.2" rx="1.2" />
          </svg>
        </button>
        <span class="quick-divider" />
        <button
          class="quick-icon"
          :class="{ on: store.ui.quickPlace }"
          :title="t('follow.quickTip')"
          @click="store.ui.quickPlace = !store.ui.quickPlace"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M4 7h11" />
            <path d="M4 12h14" />
            <path d="M4 17h8" />
            <circle cx="19" cy="6" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="19.5" cy="12" r="1.7" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          class="quick-icon"
          :class="{ on: store.ui.timeAlign }"
          :title="t('follow.timeAlignTip')"
          @click="toggleTimeAlign()"
        >
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 8v4l3 2" />
          </svg>
        </button>
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
.snap-unit {
  flex: none;
  font-size: 11px;
  color: var(--bdg-text-dim);
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
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 6px 16px;
}
.pb-chips {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.pb-quick {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--bdg-border);
}
.quick-label {
  font-size: 12px;
  color: var(--bdg-text);
}
.beat-ind {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1.5px solid var(--bdg-border-strong);
  background: rgba(148, 163, 184, 0.08);
}
.beat-overlap {
  border-radius: 50%;
}
.quick-divider {
  width: 1px;
  height: 18px;
  background: var(--bdg-border);
  margin: 0 2px;
  flex: none;
}
.quick-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--bdg-border-strong);
  background: rgba(148, 163, 184, 0.08);
  color: var(--bdg-text-dim);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.quick-icon:hover {
  background: rgba(148, 163, 184, 0.18);
  color: var(--bdg-text);
}
.quick-icon.on {
  color: var(--bdg-accent);
  background: rgba(56, 189, 248, 0.16);
  border-color: rgba(56, 189, 248, 0.45);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}
.chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--bdg-accent), var(--bdg-accent-2));
  box-shadow: 0 0 6px rgba(56, 189, 248, 0.55);
  flex: none;
}
.follow-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--bdg-border-strong);
  background: rgba(148, 163, 184, 0.08);
  color: var(--bdg-text-dim);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.follow-btn:hover {
  background: rgba(148, 163, 184, 0.18);
  color: var(--bdg-text);
}
.follow-btn.on {
  color: var(--bdg-accent);
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.16);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}
.quick-sub {
  font-size: 11px;
  color: var(--bdg-text-dim);
  margin-left: auto;
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
