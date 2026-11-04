import { computed, ref, watch, type Ref } from "vue";
import {
  MAX_LOOP_CHILDREN,
  changeMarkerTrack,
  findTrack,
  gridDivAtBeat,
  moveMarker,
  updateMarkerLoop,
  useProjectStore,
} from "../../stores/project";
import { useSettingsStore } from "../../stores/settings";
import { markerTime as storeMarkerTime } from "../../services/timeline";
import type { Marker } from "../../types";

const LOOP_INT_MIN = 0.0625;
const LOOP_INT_MAX = 256;

/** Editable model for the marker pane of the floating property card. */
export function useMarkerCardModel(selMarker: Ref<Marker | null>) {
  const project = useProjectStore();
  const settings = useSettingsStore();
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

  // keep the draft input in sync with the real interval (e.g. when another
  // marker becomes selected) unless the user is actively typing.
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
    applyLoopPatch({
      interval: clampLoopInterval(loopInterval.value * factor),
    });
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
    if (next >= 1 && next <= MAX_LOOP_CHILDREN) loopCount.value = next;
  }

  const markerColor = computed(() => {
    const m = selMarker.value;
    if (!m) return "var(--bdg-text-dim)";
    return findTrack(m.trackId)?.color ?? "var(--bdg-text-dim)";
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

  const markerTime = computed(() =>
    selMarker.value ? storeMarkerTime(selMarker.value) : 0,
  );
  const markerStep = computed(() => 1 / gridDivAtBeat(markerBeat.value));

  return {
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
  };
}
