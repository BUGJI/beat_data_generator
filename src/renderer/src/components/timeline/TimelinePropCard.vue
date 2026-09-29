<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  useProjectStore,
  MAX_LOOP_CHILDREN,
  changeMarkerTrack,
  moveMarker,
  updateBpmPoint,
  updateMarkerLoop,
} from "../../stores/project";
import { useSelectionStore } from "../../stores/selection";
import { useSettingsStore } from "../../stores/settings";
import { useViewStore } from "../../stores/view";
import {
  effectiveBpmFor,
  formatTime,
  markerTime as storeMarkerTime,
  timeOfBeat,
} from "../../services/timeline";
import { BPM_MIN } from "../../tempo";
import { fmtBar } from "./geometry";
import TimelineMarkerAttrs from "./TimelineMarkerAttrs.vue";
import type { BpmMode, BpmPoint, Marker } from "../../types";
import UiButton from "../ui/UiButton.vue";
import UiInput from "../ui/UiInput.vue";
import UiNumberInput from "../ui/UiNumberInput.vue";
import UiRadioGroup from "../ui/UiRadioGroup.vue";
import UiSelect from "../ui/UiSelect.vue";
import UiSwitch from "../ui/UiSwitch.vue";

const props = defineProps<{ anchor: { x: number; y: number } }>();
const emit = defineEmits<{ close: []; delete: [] }>();

const { t } = useI18n();
const project = useProjectStore();
const selection = useSelectionStore();
const settings = useSettingsStore();
const view = useViewStore();

const selMarker = computed<Marker | null>(() =>
  selection.selected.kind === "marker"
    ? (project.markers.find((m) => m.id === selection.selected.id) ?? null)
    : null,
);
const selBpm = computed<BpmPoint | null>(() =>
  selection.selected.kind === "bpm"
    ? (project.bpmPoints.find((p) => p.id === selection.selected.id) ?? null)
    : null,
);
const cardVisible = computed(
  () => selection.cardOpen && !!(selMarker.value || selBpm.value),
);
const freeInput = computed(() => settings.settings.devFreeInput);

const markerBeat = computed({
  get: () => selMarker.value?.beat ?? 0,
  set: (v: number) => {
    const m = selMarker.value;
    if (m) moveMarker(m.id, freeInput.value ? v : Math.max(0, v), true);
  },
});
function applyLoopPatch(patch: { interval?: number; count?: number }): void {
  const m = selMarker.value;
  if (!m) return;
  const cur = m.loop;
  const interval = patch.interval ?? cur?.interval ?? 1;
  const count = patch.count ?? cur?.count ?? 4;
  const exclude = cur?.exclude;
  updateMarkerLoop(m.id, { interval, count, exclude });
}
const loopOn = computed({
  get: () => !!selMarker.value?.loop,
  set: (v: boolean) => {
    const m = selMarker.value;
    if (!m) return;
    updateMarkerLoop(
      m.id,
      v
        ? {
            interval: m.loop?.interval ?? 1,
            count: m.loop?.count ?? 4,
            exclude: m.loop?.exclude,
          }
        : null,
    );
  },
});
const loopInterval = computed({
  get: () => selMarker.value?.loop?.interval ?? 1,
  set: (v: number) => applyLoopPatch({ interval: v }),
});
const loopCount = computed({
  get: () => selMarker.value?.loop?.count ?? 4,
  set: (v: number) =>
    applyLoopPatch({
      count: freeInput.value
        ? v
        : Math.min(MAX_LOOP_CHILDREN, Math.max(1, Math.floor(v))),
    }),
});
const LOOP_INT_MIN = 0.0625;
const LOOP_INT_MAX = 256;

const loopDraft = ref("");
const loopFocus = ref(false);

function loopDraftBegin(): void {
  loopFocus.value = true;
  loopDraft.value = String(loopInterval.value);
}

function loopDraftCommit(): void {
  loopFocus.value = false;
  const raw = loopDraft.value.trim();
  const v = Number(raw);
  if (raw === "" || !Number.isFinite(v)) {
    loopDraft.value = String(loopInterval.value);
    return;
  }
  applyLoopPatch({ interval: clampLoopInterval(v) });
  loopDraft.value = String(loopInterval.value);
}

// keep the draft input in sync with the real interval (e.g. when another marker
// becomes selected) unless the user is actively typing.
watch(
  () => [selMarker.value?.id, loopInterval.value],
  () => {
    if (!loopFocus.value) loopDraft.value = String(loopInterval.value);
  },
);

function loopDraftCancel(): void {
  loopDraft.value = String(loopInterval.value);
}

const canHalve = computed(
  () => freeInput.value || loopInterval.value > LOOP_INT_MIN,
);
const canDouble = computed(
  () => freeInput.value || loopInterval.value < LOOP_INT_MAX,
);

function clampLoopInterval(v: number): number {
  if (freeInput.value) return v;
  const c = Math.min(LOOP_INT_MAX, Math.max(LOOP_INT_MIN, v));
  return Math.round(c * 1e4) / 1e4;
}

/** +/- buttons multiply / divide the interval by `factor` (e.g. ×2 or ÷2). */
function scaleLoopInterval(factor: number): void {
  applyLoopPatch({ interval: clampLoopInterval(loopInterval.value * factor) });
  loopDraft.value = String(loopInterval.value);
}

function onLoopCountWheel(e: WheelEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const next = loopCount.value + (e.deltaY < 0 ? 1 : -1);
  if (freeInput.value) {
    loopCount.value = next;
    return;
  }
  const hi = MAX_LOOP_CHILDREN;
  if (next >= 1 && next <= hi) loopCount.value = next;
}

const bpmBeat = computed({
  get: () => selBpm.value?.beat ?? 0,
  set: (v: number) => {
    if (selBpm.value)
      updateBpmPoint(selBpm.value.id, {
        beat: freeInput.value ? v : Math.max(0, v),
      });
  },
});
const bpmValue = computed({
  get: () => selBpm.value?.value ?? 120,
  set: (v: number) => {
    if (selBpm.value) updateBpmPoint(selBpm.value.id, { value: v });
  },
});
const bpmMin = computed(() =>
  freeInput.value
    ? Number.NEGATIVE_INFINITY
    : bpmMode.value === "mult"
      ? 0.01
      : BPM_MIN,
);
const bpmMax = computed(() =>
  bpmMode.value === "mult" && !freeInput.value ? 100 : Number.POSITIVE_INFINITY,
);
const bpmDecimals = computed(() => (bpmMode.value === "mult" ? 3 : 1));

function roundValue(v: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round(v * p) / p;
}

/** Format a BPM value for the draft input (no rounding under free input). */
function formatBpmDraft(v: number): string {
  return String(freeInput.value ? v : roundValue(v, bpmDecimals.value));
}

const bpmDraft = ref("");

function bpmDraftBegin(): void {
  bpmDraft.value = formatBpmDraft(bpmValue.value);
}

function bpmDraftCommit(): void {
  const raw = bpmDraft.value.trim();
  const v = Number(raw);
  if (raw === "" || !Number.isFinite(v)) {
    bpmDraft.value = formatBpmDraft(bpmValue.value);
    return;
  }
  bpmValue.value = clampValue(v);
  bpmDraft.value = formatBpmDraft(bpmValue.value);
}

function bpmDraftCancel(): void {
  bpmDraft.value = formatBpmDraft(bpmValue.value);
}

const canHalveBpm = computed(() => bpmValue.value > bpmMin.value + 1e-9);
const canDoubleBpm = computed(() => bpmValue.value < bpmMax.value - 1e-9);

function clampValue(v: number): number {
  if (freeInput.value) return v;
  const c = Math.min(bpmMax.value, Math.max(bpmMin.value, v));
  return roundValue(c, bpmDecimals.value);
}

/** +/- buttons multiply / divide the BPM value (or multiplier) by `factor`. */
function scaleBpmValue(factor: number): void {
  bpmValue.value = clampValue(bpmValue.value * factor);
  bpmDraft.value = formatBpmDraft(bpmValue.value);
}
const effBpm = computed(() =>
  selBpm.value ? effectiveBpmFor(selBpm.value) : 0,
);
const markerColor = computed(() => {
  const m = selMarker.value;
  if (!m) return "var(--bdg-text-dim)";
  return (
    project.tracks.find((tr) => tr.id === m.trackId)?.color ??
    "var(--bdg-text-dim)"
  );
});
const bpmMode = computed<BpmMode>({
  get: () => selBpm.value?.mode ?? "abs",
  set: (m: BpmMode) => {
    if (selBpm.value) updateBpmPoint(selBpm.value.id, { mode: m });
  },
});
const selectedTrackId = computed<string>({
  get: () => selMarker.value?.trackId ?? "",
  set: (id: string) => {
    if (selMarker.value) changeMarkerTrack(selMarker.value.id, id);
  },
});
const trackOptions = computed(() =>
  project.tracks.map((tr) => ({ value: tr.id, label: tr.name })),
);
const bpmModeOptions = computed<Array<{ value: string; label: string }>>(() => [
  { value: "abs", label: t("prop.modeAbs") },
  { value: "mult", label: t("prop.modeMult") },
]);
const markerTime = computed(() =>
  selMarker.value ? storeMarkerTime(selMarker.value) : 0,
);
const bpmTime = computed(() =>
  selBpm.value ? timeOfBeat(selBpm.value.beat) : 0,
);

// ---- positioning & dragging ----

const CARD_Y_OFFSET = 10;
const CARD_MARGIN = 8;
const cardEl = ref<HTMLElement | null>(null);
const cardPos = ref({ x: 0, y: 0 });
const anchorPos = ref({ x: 0, y: 0 });

function positionCard(): void {
  const el = cardEl.value;
  const root = el?.parentElement;
  if (!el || !root) return;
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  if (vh <= 0) return;
  const avail = Math.max(0, vh - CARD_MARGIN * 2);
  el.style.maxHeight = `${avail}px`;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const a = anchorPos.value;
  const x = Math.max(CARD_MARGIN, Math.min(a.x, vw - w - CARD_MARGIN));
  let y = a.y + CARD_Y_OFFSET;
  if (y + h > vh - CARD_MARGIN) {
    const above = a.y - CARD_Y_OFFSET - h;
    y =
      above >= CARD_MARGIN
        ? above
        : Math.max(CARD_MARGIN, vh - h - CARD_MARGIN);
  }
  cardPos.value = { x, y };
}

watch(
  () => [props.anchor.x, props.anchor.y],
  ([x, y]) => {
    anchorPos.value = { x, y };
    cardPos.value = {
      x: Math.max(CARD_MARGIN, x),
      y: Math.max(CARD_MARGIN, y + CARD_Y_OFFSET),
    };
    void nextTick(positionCard);
  },
);

let cardRo: ResizeObserver | null = null;
watch(cardEl, (el) => {
  cardRo?.disconnect();
  cardRo = null;
  if (!el) return;
  cardRo = new ResizeObserver(() => positionCard());
  cardRo.observe(el);
  void nextTick(positionCard);
});

let cardDragging = false;
let cardDragOffset = { x: 0, y: 0 };

function startCardDrag(e: PointerEvent): void {
  if (e.button !== 0) return;
  const el = cardEl.value;
  const root = el?.parentElement;
  if (!el || !root) return;
  if ((e.target as HTMLElement).closest(".pc-x")) return;
  const rect = root.getBoundingClientRect();
  cardDragging = true;
  cardDragOffset = {
    x: e.clientX - rect.left - cardPos.value.x,
    y: e.clientY - rect.top - cardPos.value.y,
  };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onCardDrag(e: PointerEvent): void {
  if (!cardDragging) return;
  const el = cardEl.value;
  const root = el?.parentElement;
  if (!el || !root) return;
  const rect = root.getBoundingClientRect();
  const maxX = Math.max(
    CARD_MARGIN,
    root.clientWidth - el.offsetWidth - CARD_MARGIN,
  );
  const maxY = Math.max(
    CARD_MARGIN,
    root.clientHeight - el.offsetHeight - CARD_MARGIN,
  );
  const x = Math.min(
    Math.max(CARD_MARGIN, e.clientX - rect.left - cardDragOffset.x),
    maxX,
  );
  const y = Math.min(
    Math.max(CARD_MARGIN, e.clientY - rect.top - cardDragOffset.y),
    maxY,
  );
  cardPos.value = { x, y };
  // keep the anchor in sync so positionCard() (resize/reflow) won't snap back
  anchorPos.value = { x, y: y - CARD_Y_OFFSET };
}

function endCardDrag(e: PointerEvent): void {
  if (!cardDragging) return;
  cardDragging = false;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

function onResize(): void {
  positionCard();
}

onMounted(() => window.addEventListener("resize", onResize));
onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
  cardRo?.disconnect();
});
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
          ✕
        </button>
      </div>
      <label class="pc-field">
        <span>{{ t("prop.beatPos") }}</span>
        <UiNumberInput
          v-model="markerBeat"
          :min="freeInput ? undefined : 0"
          :step="1 / view.snapDiv"
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
          ✕
        </button>
      </div>
      <label class="pc-field">
        <span>{{ t("prop.beatPos") }}</span>
        <UiNumberInput
          v-model="bpmBeat"
          :min="freeInput ? undefined : 0"
          :step="1 / view.snapDiv"
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
  z-index: 20;
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
  border-radius: 2px;
  transform: rotate(45deg);
  flex: none;
}
.pc-dot.bpm {
  background: var(--bdg-bpm);
}
.pc-x {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-size: calc(11px * var(--bdg-font-scale, 1));
}
.pc-x:hover {
  color: var(--bdg-text);
}
.pc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
}
.pc-mode {
  display: flex;
}
.pc-sub {
  font-size: calc(11px * var(--bdg-font-scale, 1));
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
  font-size: calc(11px * var(--bdg-font-scale, 1));
  font-weight: 700;
  color: var(--bdg-text);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pc-missing-tag {
  font-size: calc(9px * var(--bdg-font-scale, 1));
  color: var(--bdg-amber);
  background: rgb(var(--bdg-amber-rgb) / 0.14);
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
}
.pc-missing {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--bdg-text-dim);
  font-size: calc(11px * var(--bdg-font-scale, 1));
}
.pc-raw {
  margin: 0;
  padding: 6px;
  background: rgb(var(--bdg-neutral) / 0.06);
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius, 6px);
  max-height: 120px;
  overflow: auto;
  font-size: calc(10px * var(--bdg-font-scale, 1));
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
  border-radius: 5px;
  border: 1px solid var(--bdg-border-strong);
  background: rgb(var(--bdg-neutral) / 0.08);
  color: var(--bdg-text);
  font-size: calc(13px * var(--bdg-font-scale, 1));
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
