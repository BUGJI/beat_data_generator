<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { openAudioDialog, relinkAudio } from "../services/audioIO";
import {
  contentEndMs,
  formatTime,
  tempoMap,
  timeOfBeat,
} from "../services/timeline";
import { analysis, applyDetectedBpm, analyzeCurrent } from "../analysis";
import { SNAP_DIVISIONS } from "../metrics";
import { BPM_MIN } from "../tempo";
import { hexToRgb, resolveTheme, type ThemeOverrides } from "../theme";
import {
  AlignJustify,
  ArrowRight,
  Clock,
  Grid2x2,
  ListChecks,
  Sparkles,
} from "@lucide/vue";
import {
  useProjectStore,
  setBaseBpm,
  setOffset,
  markerCount,
  visibleMarkers,
  alignMarkersToStep,
} from "../stores/project";
import { useTransportStore, clickFollow } from "../stores/transport";
import { useSettingsStore } from "../stores/settings";
import { useViewStore } from "../stores/view";
import { useUiStore, toggleTimeAlign } from "../stores/ui";
import UiButton from "./ui/UiButton.vue";
import UiCombobox from "./ui/UiCombobox.vue";
import UiIconButton from "./ui/UiIconButton.vue";
import UiNumberInput from "./ui/UiNumberInput.vue";

const project = useProjectStore();
const transport = useTransportStore();
const settings = useSettingsStore();
const view = useViewStore();
const ui = useUiStore();

const themeSpec = computed(() =>
  resolveTheme(
    settings.settings.themePreset,
    settings.settings.themeOverrides as ThemeOverrides,
  ),
);

const { t } = useI18n();

// ---- beat indicators ----
// left: lights on every marker passed; right: lights when >=2 markers coincide,
// colour mapping to how many markers share the instant. Both fade in 0.1s and
// can be re-triggered (interrupted) by the next event.

const FLASH_MS = 100;

function flashStyle(
  k: number,
  color: string,
): { background: string; borderColor: string; boxShadow: string } {
  const c = hexToRgb(color);
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

const beat = makeFlash(() => ui.beatPulse);
const overlap = makeFlash(() => ui.overlapPulse);

onBeforeUnmount(() => {
  beat.stop();
  overlap.stop();
});

const overlapColor = computed(() => {
  const n = ui.overlapCount;
  const s = themeSpec.value;
  if (n >= 4) return s.danger;
  if (n === 3) return s.bpm;
  return s.amber;
});

const beatStyle = computed(() =>
  flashStyle(beat.intensity.value, themeSpec.value.accent),
);
const overlapStyle = computed(() =>
  flashStyle(overlap.intensity.value, overlapColor.value),
);

const hasAudio = computed(() => transport.hasAudio);
const followOn = computed(() =>
  transport.playing ? transport.followActive : transport.followManual,
);
const followTip = computed(() => {
  if (transport.playing)
    return transport.followActive ? t("follow.onTip") : t("follow.offPlayTip");
  return t("follow.stopTip");
});
const audioName = computed(() => {
  const n = project.audioName;
  if (!n) return "";
  return n.split(/[\\/]/).pop() ?? n;
});
const baseBpm = computed({
  get: () => project.baseBpm,
  set: (v: number | undefined) => {
    setBaseBpm(v ?? 120);
  },
});
const offset = computed({
  get: () => project.offsetMs,
  set: (v: number | undefined) => {
    setOffset(v ?? 0);
  },
});

const durationLabel = computed(() =>
  hasAudio.value ? formatTime(contentEndMs()) : "--:--.---",
);
const sampleRateLabel = computed(() =>
  transport.wave ? `${(transport.wave.sampleRate / 1000).toFixed(1)} kHz` : "-",
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
const zoomLabel = computed(() => `${view.pxPerSec.toFixed(1)} px/s`);
const followPctLabel = computed(() => `${settings.settings.followPercent}%`);

function wheelOffset(e: WheelEvent): void {
  const step = Math.sign(e.deltaY) * 5;
  const cur = project.offsetMs;
  const v = cur - step;
  if (v !== cur) offset.value = v;
}

function toggleSnap(): void {
  view.snapEnabled = !view.snapEnabled;
}

function onAlignMarkers(): void {
  alignMarkersToStep();
}

// dev "free input" toggle relaxes numeric bounds/precision while typing
const freeInput = computed(() => settings.settings.devFreeInput);

// ---- beat grid / snap division: pick a preset or type a custom denominator ----

const snapOptions = computed<Array<{ value: number; label: string }>>(() => {
  const custom = view.snapDiv;
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
  if (typeof raw === "number")
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  const m = /^(?:1\/)?(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!m) return null;
  const d = Number(m[1]);
  return d > 0 ? d : null;
}

const snapDivModel = computed({
  get: () => String(view.snapDiv),
  set: (v: string) => {
    const d = parseSnapDenominator(v);
    if (d !== null) view.snapDiv = d;
  },
});

const snapSelectOptions = computed(() =>
  snapOptions.value.map((o) => ({ value: String(o.value), label: o.label })),
);

const detecting = ref(false);

async function onDetectBpm(): Promise<void> {
  if (detecting.value) return;
  if (analysis.bpm != null && !analysis.analyzing) {
    detecting.value = true;
    try {
      applyDetectedBpm();
    } finally {
      detecting.value = false;
    }
    return;
  }
  detecting.value = true;
  try {
    await analyzeCurrent();
    applyDetectedBpm();
  } finally {
    detecting.value = false;
  }
}
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
        <UiButton
          v-if="!hasAudio"
          variant="solid"
          size="sm"
          @click="openAudioDialog()"
        >
          {{ t("sidebar.chooseSong") }}
        </UiButton>
        <UiButton v-else size="sm" @click="relinkAudio()">
          {{ t("sidebar.relink") }}
        </UiButton>
      </div>

      <div class="param-grid">
        <label class="field">
          <span class="field-label" :title="t('sidebar.bpmTooltip')">
            {{ t("sidebar.baseBpm") }}
          </span>
          <div class="bpm-row">
            <UiNumberInput
              v-model="baseBpm"
              :min="freeInput ? undefined : BPM_MIN"
              :step="1"
              :precision="freeInput ? undefined : 1"
              class="bpm-input"
            />
            <UiButton
              size="sm"
              class="detect-btn"
              :title="t('sidebar.detectBpmTip')"
              :loading="detecting"
              :disabled="detecting || analysis.analyzing"
              @click="onDetectBpm"
            >
              {{ t("sidebar.detectBpm") }}
            </UiButton>
          </div>
        </label>
        <label class="field">
          <span class="field-label" :title="t('sidebar.offsetTooltip')">
            {{ t("sidebar.offset") }}
          </span>
          <UiNumberInput
            v-model="offset"
            :step="5"
            @wheel.prevent="wheelOffset"
          />
        </label>
      </div>

      <div class="snap-row">
        <span class="snap-label">{{ t("sidebar.snapToGrid") }}</span>
        <UiCombobox
          v-model="snapDivModel"
          size="sm"
          class="snap-select"
          creatable
          :label="t('sidebar.snapToGrid')"
          :options="snapSelectOptions"
        />
        <span class="snap-unit">{{ t("sidebar.snapUnit") }}</span>
      </div>

      <div
        v-if="transport.audioMissing || transport.audioConflict"
        class="warn"
      >
        {{
          transport.audioConflict
            ? t("dialogs.audioMismatch")
            : t("dialogs.audioMissing")
        }}
        <UiButton size="sm" variant="soft" @click="relinkAudio()">
          {{ t("sidebar.relink") }}
        </UiButton>
      </div>
    </div>

    <div class="pb-right">
      <div class="pb-chips">
        <div class="chip chip-opt">
          <span class="chip-k">{{ t("sidebar.zoom") }}</span>
          <span class="chip-v num">{{ zoomLabel }}</span>
        </div>
        <div class="chip">
          <span class="chip-k">{{ t("sidebar.duration") }}</span>
          <span class="chip-v num">{{ durationLabel }}</span>
        </div>
        <div class="chip chip-opt">
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
        <div class="chip chip-opt">
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
        <UiIconButton
          :title="t('follow.glowTip')"
          :active="ui.glowEnabled"
          :pressed="ui.glowEnabled"
          @click="ui.glowEnabled = !ui.glowEnabled"
        >
          <Sparkles :size="15" />
        </UiIconButton>
        <UiIconButton
          :title="followTip"
          :active="followOn"
          :pressed="followOn"
          @click="clickFollow()"
        >
          <ArrowRight :size="15" />
        </UiIconButton>
        <span class="quick-divider" />
        <UiIconButton
          :title="t('sidebar.snapToGrid')"
          :active="view.snapEnabled"
          :pressed="view.snapEnabled"
          @click="toggleSnap()"
        >
          <Grid2x2 :size="15" />
        </UiIconButton>
        <span class="quick-divider" />
        <UiIconButton
          :title="t('follow.quickTip')"
          :active="ui.quickPlace"
          :pressed="ui.quickPlace"
          @click="ui.quickPlace = !ui.quickPlace"
        >
          <ListChecks :size="15" />
        </UiIconButton>
        <UiIconButton
          :title="t('follow.timeAlignTip')"
          :active="ui.timeAlign"
          :pressed="ui.timeAlign"
          @click="toggleTimeAlign()"
        >
          <Clock :size="15" />
        </UiIconButton>
        <UiIconButton :title="t('follow.alignTip')" @click="onAlignMarkers">
          <AlignJustify :size="15" />
        </UiIconButton>
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
  font-size: calc(11px * var(--bdg-font-scale, 1));
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
  font-size: calc(13px * var(--bdg-font-scale, 1));
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
  font-size: calc(10px * var(--bdg-font-scale, 1));
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
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
}
.bpm-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bpm-input {
  flex: 1;
  min-width: 0;
}
.detect-btn {
  flex: none;
}
.snap-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.snap-label {
  font-size: calc(12px * var(--bdg-font-scale, 1));
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
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
}
.warn {
  font-size: calc(12px * var(--bdg-font-scale, 1));
  color: var(--bdg-amber);
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
  color: var(--bdg-text);
}
.beat-ind {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: var(--bdg-radius-xs);
  border: 1.5px solid var(--bdg-border-strong);
  background: rgb(var(--bdg-neutral) / 0.08);
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
.chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--bdg-accent), var(--bdg-accent-2));
  box-shadow: 0 0 6px rgb(var(--bdg-accent-rgb) / 0.55);
  flex: none;
}
.quick-sub {
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
  margin-left: auto;
}
.chip {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.chip-k {
  font-size: calc(10px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
}
.chip-v {
  font-size: calc(13px * var(--bdg-font-scale, 1));
  color: var(--bdg-text);
  font-weight: 600;
}
/* Narrow windows: drop the least-critical readouts before the layout squeezes. */
@media (max-width: 1280px) {
  .pb-chips {
    gap: 12px;
  }
}
@media (max-width: 1120px) {
  .chip-opt {
    display: none;
  }
  .pb-right {
    padding: 6px 10px;
  }
}
@media (max-width: 1024px) {
  .pb-quick {
    flex-wrap: wrap;
    row-gap: 4px;
  }
}
</style>
