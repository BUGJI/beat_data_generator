<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { X } from "@lucide/vue";
import {
  MAX_LOOP_CHILDREN,
  findBpmPoint,
  findMarker,
  useProjectStore,
} from "../../stores/project";
import { useSelectionStore } from "../../stores/selection";
import { useSettingsStore } from "../../stores/settings";
import { formatTime } from "../../services/timeline";
import { fmtBar } from "./geometry";
import TimelineMarkerAttrs from "./TimelineMarkerAttrs.vue";
import type { BpmMode, BpmPoint, Marker } from "../../types";
import UiButton from "../ui/UiButton.vue";
import UiCombobox from "../ui/UiCombobox.vue";
import UiInput from "../ui/UiInput.vue";
import UiNumberInput from "../ui/UiNumberInput.vue";
import UiRadioGroup from "../ui/UiRadioGroup.vue";
import UiSelect from "../ui/UiSelect.vue";
import UiSwitch from "../ui/UiSwitch.vue";
import { useBpmCardModel } from "./useBpmCardModel";
import { useMarkerCardModel } from "./useMarkerCardModel";
import { usePropCardPosition } from "./usePropCardPosition";

const props = defineProps<{ anchor: { x: number; y: number } }>();
const emit = defineEmits<{ close: []; delete: [] }>();

const { t } = useI18n();
const project = useProjectStore();
const selection = useSelectionStore();
const settings = useSettingsStore();

const selMarker = computed<Marker | null>(() => {
  const { kind, id } = selection.selected;
  return kind === "marker" && id ? (findMarker(id) ?? null) : null;
});
const selBpm = computed<BpmPoint | null>(() => {
  const { kind, id } = selection.selected;
  return kind === "bpm" && id ? (findBpmPoint(id) ?? null) : null;
});
const cardVisible = computed(
  () => selection.cardOpen && !!(selMarker.value || selBpm.value),
);
const freeInput = computed(() => settings.settings.devFreeInput);

const cardEl = ref<HTMLElement | null>(null);
const { cardPos, startCardDrag, onCardDrag, endCardDrag } = usePropCardPosition(
  computed(() => props.anchor),
  cardEl,
);

const {
  markerBeat,
  markerStep,
  markerTime,
  markerColor,
  selectedTrackId,
  trackOptions,
  loopOn,
  loopDraft,
  loopDraftBegin,
  loopDraftCommit,
  loopDraftCancel,
  canHalve,
  canDouble,
  loopCount,
  scaleLoopInterval,
  onLoopCountWheel,
} = useMarkerCardModel(selMarker);

const {
  bpmBeat,
  bpmStep,
  bpmTime,
  bpmMode,
  bpmModeOptions,
  bpmDraft,
  bpmDraftBegin,
  bpmDraftCommit,
  bpmDraftCancel,
  canHalveBpm,
  canDoubleBpm,
  scaleBpmValue,
  effBpm,
  gridOverride,
  gridOptions,
  gridDivModel,
} = useBpmCardModel(selBpm);
</script>

<template>
  <div
    v-if="cardVisible"
    ref="cardEl"
    class="prop-card"
    :style="{ left: cardPos.x + 'px', top: cardPos.y + 'px' }"
    @pointerdown.stop
    @pointerup.stop
    @pointermove.stop
    @pointercancel.stop
    @wheel.stop
    @contextmenu.stop
  >
    <template v-if="selMarker">
      <div
        class="pc-head"
        @pointerdown.stop="startCardDrag"
        @pointermove.stop="onCardDrag"
        @pointerup.stop="endCardDrag"
        @pointercancel.stop="endCardDrag"
      >
        <span class="pc-dot" :style="{ background: markerColor }" />
        <b>{{ t("keys.marker") }}</b>
        <button
          class="pc-x"
          :title="t('a11y.close')"
          :aria-label="t('a11y.close')"
          @click="emit('close')"
        >
          <X class="size-3" />
        </button>
      </div>
      <label class="pc-field">
        <span>{{ t("prop.beatPos") }}</span>
        <UiNumberInput
          v-model="markerBeat"
          :min="freeInput ? undefined : 0"
          :step="markerStep"
          :precision="4"
          class="w-full"
        />
      </label>
      <div class="pc-sub num">
        {{ t("prop.asBar") }}: {{ fmtBar(markerBeat) }} · {{ t("prop.time") }}:
        {{ formatTime(markerTime) }}
      </div>
      <label class="pc-field">
        <span>{{ t("prop.track") }}</span>
        <UiSelect
          v-model="selectedTrackId"
          size="sm"
          :options="trackOptions"
          class="w-full"
        />
      </label>
      <div class="pc-loop-row">
        <span class="pc-field-label">{{ t("prop.loop") }}</span>
        <UiSwitch v-model="loopOn" :aria-label="t('prop.loop')" />
      </div>
      <template v-if="loopOn">
        <div class="pc-loop-fields">
          <div class="pc-field">
            <span>{{ t("prop.loopInterval") }}</span>
            <div class="pc-stepper num">
              <button
                type="button"
                class="pc-step"
                :disabled="!canHalve"
                @click="scaleLoopInterval(1 / 2)"
              >
                −
              </button>
              <UiInput
                v-model="loopDraft"
                class="pc-step-input"
                @focus="loopDraftBegin"
                @blur="loopDraftCommit"
                @keyup.enter="loopDraftCommit"
                @keyup.esc="loopDraftCancel"
              />
              <button
                type="button"
                class="pc-step"
                :disabled="!canDouble"
                @click="scaleLoopInterval(2)"
              >
                ＋
              </button>
            </div>
          </div>
          <label class="pc-field">
            <span>{{ t("prop.loopCount") }}</span>
            <UiNumberInput
              v-model="loopCount"
              :min="freeInput ? undefined : 1"
              :max="freeInput ? undefined : MAX_LOOP_CHILDREN"
              :step="1"
              class="w-full"
              @wheel="onLoopCountWheel"
            />
          </label>
        </div>
        <div class="pc-sub num">{{ t("prop.loopHint") }}</div>
      </template>

      <TimelineMarkerAttrs :marker="selMarker" />
    </template>

    <template v-else-if="selBpm">
      <div
        class="pc-head"
        @pointerdown.stop="startCardDrag"
        @pointermove.stop="onCardDrag"
        @pointerup.stop="endCardDrag"
        @pointercancel.stop="endCardDrag"
      >
        <span class="pc-dot bpm" />
        <b>{{ t("keys.bpmPoint") }}</b>
        <button
          class="pc-x"
          :title="t('a11y.close')"
          :aria-label="t('a11y.close')"
          @click="emit('close')"
        >
          <X class="size-3" />
        </button>
      </div>
      <label class="pc-field">
        <span>{{ t("prop.beatPos") }}</span>
        <UiNumberInput
          v-model="bpmBeat"
          :min="freeInput ? undefined : 0"
          :step="bpmStep"
          :precision="4"
          class="w-full"
        />
      </label>
      <div class="pc-sub num">
        {{ t("prop.asBar") }}: {{ fmtBar(bpmBeat) }} · {{ t("prop.time") }}:
        {{ formatTime(bpmTime) }}
      </div>
      <div class="pc-mode">
        <UiRadioGroup
          :model-value="bpmMode"
          :options="bpmModeOptions"
          @update:model-value="(v: string) => (bpmMode = v as BpmMode)"
        />
      </div>
      <div class="pc-field">
        <span>{{
          bpmMode === "mult" ? t("prop.multValue") : t("prop.absValue")
        }}</span>
        <div class="pc-stepper num">
          <button
            type="button"
            class="pc-step"
            :disabled="!canHalveBpm"
            @click="scaleBpmValue(1 / 2)"
          >
            −
          </button>
          <UiInput
            v-model="bpmDraft"
            class="pc-step-input"
            @focus="bpmDraftBegin"
            @blur="bpmDraftCommit"
            @keyup.enter="bpmDraftCommit"
            @keyup.esc="bpmDraftCancel"
          />
          <button
            type="button"
            class="pc-step"
            :disabled="!canDoubleBpm"
            @click="scaleBpmValue(2)"
          >
            ＋
          </button>
        </div>
      </div>
      <div class="pc-sub num">
        {{ t("prop.effective") }}: {{ effBpm.toFixed(1) }} BPM
      </div>
      <div class="pc-loop-row">
        <span class="pc-field-label">{{ t("prop.gridOverride") }}</span>
        <UiSwitch
          v-model="gridOverride"
          :disabled="project.bpmLocked"
          :aria-label="t('prop.gridOverride')"
        />
      </div>
      <template v-if="gridOverride">
        <label class="pc-field">
          <span>{{ t("prop.gridDiv") }}</span>
          <UiCombobox
            v-model="gridDivModel"
            size="sm"
            creatable
            :disabled="project.bpmLocked"
            :label="t('prop.gridDiv')"
            :options="gridOptions"
          />
        </label>
        <div class="pc-sub">{{ t("prop.gridHint") }}</div>
      </template>
    </template>

    <div class="pc-actions">
      <UiButton size="sm" variant="danger" @click="emit('delete')">{{
        t("prop.delete")
      }}</UiButton>
    </div>
  </div>
</template>

<style scoped>
.prop-card {
  position: absolute;
  z-index: var(--bdg-z-card);
  width: 236px;
  background: var(--bdg-menu);
  border: 1px solid var(--bdg-border-strong);
  border-radius: calc(var(--bdg-radius, 6px) * 2);
  padding: 10px;
  box-shadow: 0 8px 24px var(--bdg-shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}
.pc-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--bdg-menu);
  cursor: move;
  user-select: none;
  touch-action: none;
}
.pc-dot {
  width: 9px;
  height: 9px;
  border-radius: var(--bdg-radius-2xs);
  transform: rotate(45deg);
  flex: none;
}
.pc-dot.bpm {
  background: var(--bdg-bpm);
}
.pc-x {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--bdg-ctl-sm);
  height: var(--bdg-ctl-sm);
  background: none;
  border: none;
  border-radius: var(--bdg-radius, 6px);
  color: var(--bdg-text-dim);
  cursor: pointer;
}
.pc-x:hover {
  background: rgb(var(--bdg-neutral) / 0.12);
  color: var(--bdg-text);
}
.pc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
}
.pc-mode {
  display: flex;
}
.pc-sub {
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
}
.pc-actions {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--bdg-border);
  padding-top: 8px;
}

.pc-loop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pc-loop-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.pc-attrs {
  border-top: 1px solid var(--bdg-border);
  padding-top: 8px;
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.pc-attrs-title {
  font-size: var(--bdg-fs-11);
  font-weight: 700;
  color: var(--bdg-text);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pc-missing-tag {
  font-size: var(--bdg-fs-9);
  color: var(--bdg-amber);
  background: rgb(var(--bdg-amber-rgb) / 0.14);
  padding: 1px 6px;
  border-radius: var(--bdg-radius-sm);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
}
.pc-missing {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--bdg-text-dim);
  font-size: var(--bdg-fs-11);
}
.pc-raw {
  margin: 0;
  padding: 6px;
  background: rgb(var(--bdg-neutral) / 0.06);
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius, 6px);
  max-height: 120px;
  overflow: auto;
  font-size: var(--bdg-fs-10);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--bdg-text);
}
.pc-enum {
  width: 100%;
}
.pc-stepper {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.pc-step-input {
  width: 100%;
}
.pc-step {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  min-width: 22px;
  max-width: 22px;
  box-sizing: border-box;
  border-radius: var(--bdg-radius-md);
  border: 1px solid var(--bdg-border-strong);
  background: rgb(var(--bdg-neutral) / 0.08);
  color: var(--bdg-text);
  font-size: var(--bdg-fs-13);
  line-height: 1;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.pc-step:hover:not(:disabled) {
  background: rgb(var(--bdg-neutral) / 0.2);
  color: var(--bdg-accent);
}
.pc-step:disabled {
  opacity: 0.3;
  cursor: default;
}
</style>
