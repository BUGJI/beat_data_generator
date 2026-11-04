import { computed, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  gridDivAtBeat,
  setBpmGridDiv,
  updateBpmPoint,
} from "../../stores/project";
import { useSettingsStore } from "../../stores/settings";
import { parseGridDenominator } from "../../grid";
import { DEFAULT_DIV, SNAP_DIVISIONS } from "../../metrics";
import { effectiveBpmFor, timeOfBeat } from "../../services/timeline";
import { BPM_MIN } from "../../tempo";
import type { BpmMode, BpmPoint } from "../../types";

/** Editable model for the BPM-point pane of the floating property card. */
export function useBpmCardModel(selBpm: Ref<BpmPoint | null>) {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const freeInput = computed(() => settings.settings.devFreeInput);

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
    bpmMode.value === "mult" && !freeInput.value
      ? 100
      : Number.POSITIVE_INFINITY,
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

  const bpmMode = computed<BpmMode>({
    get: () => selBpm.value?.mode ?? "abs",
    set: (m: BpmMode) => {
      if (selBpm.value) updateBpmPoint(selBpm.value.id, { mode: m });
    },
  });

  const bpmModeOptions = computed<Array<{ value: string; label: string }>>(
    () => [
      { value: "abs", label: t("prop.modeAbs") },
      { value: "mult", label: t("prop.modeMult") },
    ],
  );

  const bpmTime = computed(() =>
    selBpm.value ? timeOfBeat(selBpm.value.beat) : 0,
  );
  const bpmStep = computed(() => 1 / gridDivAtBeat(bpmBeat.value));

  // ---- beat-grid override on the selected BPM point ----

  const effectiveGridDiv = computed(() =>
    selBpm.value ? gridDivAtBeat(selBpm.value.beat) : DEFAULT_DIV,
  );
  const gridOverride = computed({
    get: () => selBpm.value?.gridDiv != null,
    set: (on: boolean) => {
      const p = selBpm.value;
      if (!p) return;
      setBpmGridDiv(p.id, on ? effectiveGridDiv.value : null);
    },
  });
  const gridOptions = computed<Array<{ value: string; label: string }>>(() => {
    const cur = selBpm.value?.gridDiv ?? effectiveGridDiv.value;
    const list = SNAP_DIVISIONS.map((d) => ({
      value: String(d),
      label: `1/${d}`,
    }));
    if (!list.some((o) => o.value === String(cur))) {
      list.push({ value: String(cur), label: `1/${cur}` });
      list.sort((a, b) => Number(a.value) - Number(b.value));
    }
    return list;
  });
  const gridDivModel = computed({
    get: () => String(selBpm.value?.gridDiv ?? effectiveGridDiv.value),
    set: (v: string) => {
      const p = selBpm.value;
      if (!p) return;
      const d = parseGridDenominator(v);
      if (d !== null) setBpmGridDiv(p.id, d);
    },
  });

  return {
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
  };
}
