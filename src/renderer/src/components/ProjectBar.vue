<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { openAudioDialog, relinkAudio } from "../services/audioIO";
import { analysis, applyDetectedBpm, analyzeCurrent } from "../analysis";
import { SNAP_DIVISIONS } from "../metrics";
import { parseGridDenominator } from "../grid";
import { BPM_MIN } from "../tempo";
import { resetTapTempo, tapTempo, tapTempoState } from "../services/tapTempo";
import { resolveTheme, type ThemeOverrides } from "../theme";
import {
  AlignJustify,
  ArrowRight,
  Check,
  Clock,
  Grid2x2,
  ListChecks,
  Magnet,
  Sparkles,
} from "@lucide/vue";
import { BEAT_FX_IDS, type BeatFxId } from "@shared/beatFx";
import {
  useProjectStore,
  setBaseBpm,
  setBeatsPerBar,
  setOffset,
  alignMarkersToStep,
  setGridDiv,
} from "../stores/project";
import { useTransportStore, clickFollow } from "../stores/transport";
import { useSettingsStore } from "../stores/settings";
import { beatFxSelected, toggleBeatFxSelected } from "../stores/beatFx";
import { useViewStore } from "../stores/view";
import { useUiStore, toggleTimeAlign } from "../stores/ui";
import { useBeatFlash } from "./project/useBeatFlash";
import { useProjectStats } from "./project/useProjectStats";
import UiButton from "./ui/UiButton.vue";
import UiCombobox from "./ui/UiCombobox.vue";
import UiDropdownItem from "./ui/UiDropdownItem.vue";
import UiDropdownMenu from "./ui/UiDropdownMenu.vue";
import UiIconButton from "./ui/UiIconButton.vue";
import UiNumberInput from "./ui/UiNumberInput.vue";
import PluginBarButtons from "./PluginBarButtons.vue";

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
const { beatStyle, overlapStyle } = useBeatFlash(themeSpec);

const FX_LABEL_KEY: Record<BeatFxId, string> = {
  laneGlow: "follow.fxLaneGlow",
  markerFlash: "follow.fxMarkerFlash",
};
const fxMenuOpen = ref(false);
const fxSelectedAny = computed(() => BEAT_FX_IDS.some(beatFxSelected));
const fxActive = computed(() => ui.fxMasterOn && fxSelectedAny.value);
const fxTitle = computed(() => t("follow.fxQuickTip"));

/** Show short text labels beside the quick-action icons (settings toggle). */
const quickLabels = computed(() => settings.settings.quickBarLabels);
const quickLabel = (key: string): string | undefined =>
  quickLabels.value ? t(key) : undefined;

function onFxSelect(value: string): void {
  // Checking only fixes the set; the left-click master switch turns it on/off.
  toggleBeatFxSelected(value as BeatFxId);
}

/** Left-click master switch for every checked effect. */
function toggleMasterFx(): void {
  if (fxMenuOpen.value) {
    fxMenuOpen.value = false;
    return;
  }
  // Nothing checked yet: open the list instead of toggling a dead switch.
  if (!fxSelectedAny.value) {
    fxMenuOpen.value = true;
    return;
  }
  ui.fxMasterOn = !ui.fxMasterOn;
}

/**
 * Left-click toggles every checked effect; right-click opens the checkbox
 * list. reka-ui's trigger listens for `onClick`, so the toggle is handled in
 * the capture phase and stopped before the trigger can open the menu.
 * Enter/Space are handled directly for the same reason; ArrowDown still opens
 * the menu.
 */
function onFxClick(e: MouseEvent): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  toggleMasterFx();
}

function onFxKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.stopPropagation();
  e.preventDefault();
  toggleMasterFx();
}

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
const beatsPerBar = computed({
  get: () => project.beatsPerBar,
  set: (v: number) => setBeatsPerBar(v),
});

const offset = computed({
  get: () => project.offsetMs,
  set: (v: number | undefined) => {
    setOffset(v ?? 0);
  },
});

const {
  hasAudio,
  followOn,
  followTip,
  durationLabel,
  sampleRateLabel,
  barMsLabel,
  lastBeatLabel,
  markersLabel,
  zoomLabel,
  followPctLabel,
} = useProjectStats();

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

function onTapTempo(e: MouseEvent): void {
  if (e.shiftKey) resetTapTempo();
  else tapTempo();
}

// dev "free input" toggle relaxes numeric bounds/precision while typing
const freeInput = computed(() => settings.settings.devFreeInput);

// ---- beat grid / snap division: pick a preset or type a custom denominator ----

const snapOptions = computed<Array<{ value: number; label: string }>>(() => {
  const custom = project.gridDiv;
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

const snapDivModel = computed({
  get: () => String(project.gridDiv),
  set: (v: string) => {
    const d = parseGridDenominator(v);
    if (d !== null) setGridDiv(d);
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
            <UiButton
              size="sm"
              class="tap-btn"
              :title="t('sidebar.tapTempoTip')"
              @click="onTapTempo"
            >
              {{ t("sidebar.tapTempo") }}
              <span v-if="tapTempoState.count > 1" class="tap-count num">
                {{ tapTempoState.count }}
              </span>
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

      <div class="snap-grid">
        <label class="field">
          <span class="field-label" :title="t('sidebar.snapDivTip')">
            {{ t("sidebar.snapToGrid") }}
          </span>
          <div class="snap-ctl">
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
        </label>
        <label class="field">
          <span class="field-label" :title="t('sidebar.beatsPerBarTip')">
            {{ t("sidebar.beatsPerBar") }}
          </span>
          <div class="snap-ctl">
            <UiNumberInput
              v-model="beatsPerBar"
              :min="freeInput ? undefined : 1"
              :max="freeInput ? undefined : 16"
              :step="1"
              :precision="0"
              class="beats-input"
              :label="t('sidebar.beatsPerBar')"
            />
            <span class="snap-unit">{{ t("sidebar.beatUnit") }}</span>
          </div>
        </label>
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

      <div class="pb-quick" :class="{ 'with-labels': quickLabels }">
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
        <span
          class="fx-quick"
          @click.capture="onFxClick"
          @keydown.capture="onFxKeydown"
          @contextmenu.prevent="fxMenuOpen = true"
        >
          <UiDropdownMenu v-model:open="fxMenuOpen" @select="onFxSelect">
            <template #trigger>
              <UiIconButton
                :title="fxTitle"
                :active="fxActive"
                :pressed="fxActive"
                :label="quickLabel('follow.lblFx')"
              >
                <Sparkles :size="15" />
              </UiIconButton>
            </template>
            <UiDropdownItem
              v-for="fx in BEAT_FX_IDS"
              :key="fx"
              :value="fx"
              keep-open
              :title="t('follow.fxTip')"
            >
              <Check v-if="beatFxSelected(fx)" :size="14" />
              <span v-else class="w-[14px]" />
              <span>{{ t(FX_LABEL_KEY[fx]) }}</span>
            </UiDropdownItem>
          </UiDropdownMenu>
        </span>
        <UiIconButton
          :title="followTip"
          :active="followOn"
          :pressed="followOn"
          :label="quickLabel('follow.lblFollow')"
          @click="clickFollow()"
        >
          <ArrowRight :size="15" />
        </UiIconButton>
        <span class="quick-divider" />
        <UiIconButton
          :title="t('sidebar.snapToGrid')"
          :active="view.snapEnabled"
          :pressed="view.snapEnabled"
          :label="quickLabel('follow.lblSnap')"
          @click="toggleSnap()"
        >
          <Grid2x2 :size="15" />
        </UiIconButton>
        <UiIconButton
          :title="t('follow.magnetTip')"
          :active="view.magnetEnabled"
          :pressed="view.magnetEnabled"
          :disabled="!view.snapEnabled"
          :label="quickLabel('follow.lblMagnet')"
          @click="view.magnetEnabled = !view.magnetEnabled"
        >
          <Magnet :size="15" />
        </UiIconButton>
        <span class="quick-divider" />
        <UiIconButton
          :title="t('follow.quickTip')"
          :active="ui.quickPlace"
          :pressed="ui.quickPlace"
          :label="quickLabel('follow.lblPlace')"
          @click="ui.quickPlace = !ui.quickPlace"
        >
          <ListChecks :size="15" />
        </UiIconButton>
        <UiIconButton
          :title="t('follow.timeAlignTip')"
          :active="ui.timeAlign"
          :pressed="ui.timeAlign"
          :label="quickLabel('follow.lblTimeAlign')"
          @click="toggleTimeAlign()"
        >
          <Clock :size="15" />
        </UiIconButton>
        <UiIconButton
          :title="t('follow.alignTip')"
          :label="quickLabel('follow.lblAlign')"
          @click="onAlignMarkers"
        >
          <AlignJustify :size="15" />
        </UiIconButton>
        <PluginBarButtons />
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
  font-size: var(--bdg-fs-13);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-info.none .song-name {
  color: var(--bdg-text-dim);
  font-weight: 400;
}
.param-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.field-label {
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.tap-btn {
  flex: none;
  gap: 3px;
}
.tap-count {
  font-size: var(--bdg-fs-10);
  color: var(--bdg-text-dim);
}
.snap-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.snap-ctl {
  display: flex;
  align-items: center;
  gap: 6px;
}
.snap-select {
  flex: 1;
  min-width: 0;
}
.beats-input {
  width: 60px;
  flex: none;
}
.snap-unit {
  flex: none;
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
  white-space: nowrap;
}
.warn {
  font-size: var(--bdg-fs-12);
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
/* Labels widen every button, so let the row wrap instead of overflowing. */
.pb-quick.with-labels {
  flex-wrap: wrap;
  row-gap: 4px;
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
.chip {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.chip-k {
  font-size: var(--bdg-fs-10);
  color: var(--bdg-text-dim);
}
.chip-v {
  font-size: var(--bdg-fs-13);
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
