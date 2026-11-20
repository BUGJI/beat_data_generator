<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AudioLines,
  Pause,
  Play,
  Repeat,
  SkipBack,
  Square,
  Volume2,
  VolumeX,
} from "@lucide/vue";
import {
  stop,
  togglePlay,
  seekTo,
  applySpeed,
  toggleLoop,
  SPEED_MIN,
} from "../services/playback";
import { formatTime, contentEndMs, bpmAtTime } from "../services/timeline";
import { useTransportStore, setVolume } from "../stores/transport";
import { useSettingsStore } from "../stores/settings";
import { patchSettings } from "../services/settingsPersistence";
import { useUiStore } from "../stores/ui";
import { parseGoto } from "../utils/goto";
import { analysis } from "../analysis";
import UiInput from "./ui/UiInput.vue";
import UiNumberInput from "./ui/UiNumberInput.vue";
import UiSlider from "./ui/UiSlider.vue";
import UiSwitch from "./ui/UiSwitch.vue";
import UiTooltip from "./ui/UiTooltip.vue";

const { t } = useI18n();
const transport = useTransportStore();
const settings = useSettingsStore();
const ui = useUiStore();

const playing = computed(() => transport.playing);
const hasAudio = computed(() => transport.hasAudio);
const vol = computed({
  get: () => transport.volume,
  set: (v: number) => setVolume(v),
});
const totalLabel = computed(() =>
  hasAudio.value ? formatTime(contentEndMs()) : "--:--.---",
);
const bpmLabel = computed(() => bpmAtTime(transport.positionMs).toFixed(1));
const liveBpmOn = computed(
  () => settings.settings.audioLiveBpm && !!analysis.liveBpm,
);
const liveBpmLabel = computed(() =>
  analysis.liveBpm ? analysis.liveBpm.toFixed(1) : "--",
);

const speed = computed({
  get: () => transport.rate,
  set: (v: number | undefined) => {
    applySpeed(v ?? 1, transport.pitchFollow);
  },
});
const freeInput = computed(() => settings.settings.devFreeInput);
const pitchFollow = computed({
  get: () => transport.pitchFollow,
  set: (v: boolean) => {
    applySpeed(transport.rate, v);
  },
});

const loopOn = computed(() => transport.loopEnabled);
const gridClickOn = computed(() => settings.settings.gridMetronome);
const loopTip = computed(() =>
  loopOn.value
    ? t("transport.loopOffTip", {
        a: formatTime(transport.loopStartMs),
        b: formatTime(transport.loopEndMs),
      })
    : t("transport.loopTip"),
);

function onToggleLoop(): void {
  toggleLoop();
}

function onToggleGridClick(): void {
  void patchSettings({ gridMetronome: !settings.settings.gridMetronome });
}

function resetRate(): void {
  applySpeed(1, transport.pitchFollow);
}

const muted = computed(() => transport.volume <= 0.0001);
const lastVolume = ref(transport.volume > 0 ? transport.volume : 0.85);
function toggleMute(): void {
  if (muted.value) setVolume(lastVolume.value || 0.85);
  else {
    lastVolume.value = transport.volume;
    setVolume(0);
  }
}

const editingPosition = ref(false);
const positionDraft = ref("");
const positionEl = ref<InstanceType<typeof UiInput> | null>(null);

async function beginPositionEdit(): Promise<void> {
  if (!hasAudio.value) return;
  if (editingPosition.value) return;
  positionDraft.value = formatTime(transport.positionMs);
  editingPosition.value = true;
  await nextTick();
  const input = positionEl.value?.$el as HTMLInputElement | undefined;
  input?.focus();
  input?.select();
}

function commitPosition(): void {
  if (!editingPosition.value) return;
  const ms = parseGoto(positionDraft.value);
  editingPosition.value = false;
  if (ms === null) return;
  seekTo(Math.min(ms, contentEndMs()));
}

function cancelPosition(): void {
  editingPosition.value = false;
}

watch(
  () => ui.positionFocus,
  (nonce) => {
    if (nonce > 0) void beginPositionEdit();
  },
);

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
    const cur = transport.rate;
    const free = freeInput.value;
    const grid = free ? cur : Math.round(cur / 0.05) * 0.05;
    let v = grid - steps * 0.05;
    if (!free) v = Math.max(SPEED_MIN, v);
    const next = free ? v : Math.round(v * 100) / 100;
    if (next !== cur) applySpeed(next, transport.pitchFollow);
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
          >{{ t("transport.bpmReadout") }}: {{ liveBpmLabel }}</span
        >
      </div>
      <div
        class="rate-ctl"
        :title="t('transport.rateTooltip')"
        @wheel="onRateWheel"
      >
        <span class="rate-label">{{ t("transport.speedRate") }}</span>
        <UiNumberInput
          v-model="speed"
          :min="freeInput ? undefined : SPEED_MIN"
          :step="0.05"
          :precision="freeInput ? undefined : 2"
          :label="t('transport.speedRate')"
          class="rate-input"
        />
      </div>
      <div class="rate-ctl" :title="t('transport.pitchTooltip')">
        <UiSwitch v-model="pitchFollow" :label="t('transport.pitchFollow')" />
        <span class="rate-label">{{ t("transport.pitchFollow") }}</span>
      </div>
      <span
        class="rate-label reset-rate"
        :title="t('transport.rateResetTip')"
        @click="resetRate"
      >
        {{ t("transport.rateReset") }}
      </span>
    </div>

    <div class="tr-controls">
      <UiTooltip :content="t('transport.backStart')" side="top">
        <button
          class="btn-icon"
          :disabled="!hasAudio"
          :aria-label="t('transport.backStart')"
          @click="seekTo(0)"
        >
          <SkipBack class="size-4" />
        </button>
      </UiTooltip>
      <UiTooltip
        :content="playing ? t('transport.pause') : t('transport.play')"
        side="top"
      >
        <button
          class="btn-big"
          :class="{ playing }"
          :disabled="!hasAudio"
          :aria-label="playing ? t('transport.pause') : t('transport.play')"
          @click="togglePlay()"
        >
          <Pause v-if="playing" class="size-[18px]" />
          <Play v-else class="size-[18px]" />
        </button>
      </UiTooltip>
      <UiTooltip :content="t('transport.stop')" side="top">
        <button
          class="btn-icon"
          :disabled="!hasAudio"
          :aria-label="t('transport.stop')"
          @click="stop()"
        >
          <Square class="size-3.5" />
        </button>
      </UiTooltip>
      <UiTooltip :content="loopTip" side="top">
        <button
          class="btn-icon"
          :class="{ on: loopOn }"
          :disabled="!hasAudio"
          :aria-label="t('transport.loop')"
          :aria-pressed="loopOn"
          @click="onToggleLoop()"
        >
          <Repeat class="size-4" />
        </button>
      </UiTooltip>
      <UiTooltip :content="t('transport.gridClickTip')" side="top">
        <button
          class="btn-icon"
          :class="{ on: gridClickOn }"
          :disabled="!hasAudio"
          :aria-label="t('transport.gridClick')"
          :aria-pressed="gridClickOn"
          @click="onToggleGridClick()"
        >
          <AudioLines class="size-4" />
        </button>
      </UiTooltip>

      <div class="tr-divider" />

      <span v-if="transport.countingIn" class="buffering">{{
        t("transport.countIn")
      }}</span>
      <span v-else-if="transport.buffering" class="buffering">{{
        t("transport.buffering")
      }}</span>
      <div class="tr-time num">
        <UiInput
          v-if="editingPosition"
          ref="positionEl"
          v-model="positionDraft"
          size="sm"
          class="position-input"
          :placeholder="t('transport.positionPlaceholder')"
          :aria-label="t('transport.position')"
          @blur="commitPosition"
          @keydown.enter.prevent="commitPosition"
          @keydown.esc.prevent="cancelPosition"
        />
        <button
          v-else
          class="cur position-btn"
          :title="t('transport.positionTip')"
          :aria-label="t('transport.position')"
          @click="beginPositionEdit()"
        >
          {{ formatTime(transport.positionMs) }}
        </button>
        <span class="sep">/</span>
        <span class="total">{{ totalLabel }}</span>
      </div>
    </div>

    <div class="tr-right">
      <button
        class="btn-icon mute-btn"
        :aria-label="t('transport.mute')"
        :title="muted ? t('transport.unmute') : t('transport.mute')"
        @click="toggleMute()"
      >
        <VolumeX v-if="muted" class="size-4" />
        <Volume2 v-else class="size-4" />
      </button>
      <span class="vol-label">{{ t("transport.volume") }}</span>
      <UiSlider
        v-model="vol"
        :min="0"
        :max="1"
        :step="0.01"
        :label="t('transport.volume')"
        class="vol-slider"
      />
    </div>
  </footer>
</template>

<style scoped>
.transport {
  flex: none;
  height: var(--bdg-transport-h);
  /* Equal side columns keep the transport controls centred on the window
     regardless of how wide the rate / volume groups are. */
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 16px;
  padding: 0 16px;
  background: linear-gradient(0deg, var(--bdg-bg-sunken), var(--bdg-bg-panel));
  border-top: 1px solid var(--bdg-border);
}
.rate-zone {
  flex: none;
  justify-self: start;
  display: flex;
  align-items: center;
  gap: 14px;
  padding-right: 16px;
  margin-right: 4px;
  border-right: 1px solid var(--bdg-border);
  height: 100%;
}
.tr-left {
  font-size: var(--bdg-fs-13);
  color: var(--bdg-text);
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.buffering {
  font-size: var(--bdg-fs-11);
  color: var(--bdg-amber);
  letter-spacing: 0.05em;
}
.rate-ctl {
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: var(--bdg-radius, 6px);
  padding: 2px 4px;
}
.rate-ctl:hover {
  background: rgb(var(--bdg-neutral) / 0.08);
}
.rate-ctl:hover .rate-label {
  color: var(--bdg-text);
}
.rate-label {
  font-size: var(--bdg-fs-11);
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
  background: var(--bdg-bpm);
}
.bpm-main {
  font-weight: 700;
}
.live-bpm {
  font-size: var(--bdg-fs-11);
  color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.12);
  border: 1px solid rgb(var(--bdg-accent-rgb) / 0.22);
  padding: 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.tr-controls {
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
  border-radius: var(--bdg-radius, 6px);
  font-family: inherit;
}
.btn-icon {
  width: var(--bdg-ctl-md);
  height: var(--bdg-ctl-md);
}
.btn-icon:hover:not(:disabled) {
  background: rgb(var(--bdg-neutral) / 0.14);
}
.btn-icon.on:not(:disabled) {
  color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.16);
}
.reset-rate {
  cursor: pointer;
  user-select: none;
  padding: 1px 6px;
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius-sm);
}
.reset-rate:hover {
  color: var(--bdg-text);
  background: rgb(var(--bdg-neutral) / 0.12);
}
.position-btn {
  border: none;
  background: transparent;
  color: var(--bdg-text);
  font-family: inherit;
  font-size: inherit;
  font-weight: 700;
  letter-spacing: inherit;
  padding: 0 2px;
  border-radius: var(--bdg-radius-sm);
  cursor: text;
}
.position-btn:hover {
  background: rgb(var(--bdg-neutral) / 0.12);
}
.position-input {
  width: 112px;
}
.mute-btn {
  flex: none;
  width: var(--bdg-ctl-sm);
  height: var(--bdg-ctl-sm);
}
.btn-big {
  width: var(--bdg-ctl-xl);
  height: var(--bdg-ctl-xl);
  border-radius: 50%;
  background: linear-gradient(135deg, var(--bdg-accent), var(--bdg-accent-2));
  color: rgb(var(--bdg-bg-rgb));
  box-shadow: 0 2px 10px rgb(var(--bdg-accent-rgb) / 0.35);
}
.btn-big:hover:not(:disabled) {
  filter: brightness(1.1);
}
.btn-big.playing {
  background: linear-gradient(135deg, var(--bdg-amber), var(--bdg-bpm));
  box-shadow: 0 2px 10px rgb(var(--bdg-amber-rgb) / 0.35);
}
button:disabled {
  opacity: var(--bdg-disabled-opacity);
  cursor: default;
}
.tr-divider {
  width: 1px;
  height: 26px;
  background: var(--bdg-border);
  margin: 0 4px;
}
.tr-time {
  font-size: var(--bdg-fs-17);
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
  width: min(260px, 26vw);
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 10px;
}
.vol-label {
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
  white-space: nowrap;
}
.vol-slider {
  flex: 1;
}
@media (max-width: 1180px) {
  .vol-label {
    display: none;
  }
  .rate-zone {
    gap: 8px;
    padding-right: 10px;
  }
  .rate-input {
    width: 76px;
  }
}
</style>
