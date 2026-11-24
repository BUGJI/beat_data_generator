import { defineStore } from "pinia";
import { ref } from "vue";
import type { BeatFxId, BeatFxPulse } from "@shared/beatFx";

/**
 * Session-only editor UI flags and transient pulse counters.
 * Nothing here is persisted or part of the project document.
 */
export const useUiStore = defineStore("ui", () => {
  /** session-only: audio analysis panel open state. */
  const analysisOpen = ref(false);
  /** session-only: last dragged position of the analysis panel (null = default). */
  const analysisPos = ref<{ x: number; y: number } | null>(null);
  const beatPulse = ref(0);
  const overlapPulse = ref(0);
  const overlapCount = ref(0);
  /**
   * Per-effect pulses. Each effect owns a namespace keyed by the entity it
   * animates (track id for lane glow, marker id for marker flash). `at` is the
   * wall-clock instant playback crossed the marker, so a renderer can tell how
   * much of the effect is left even if the entity was off-screen when it fired.
   * The selected effects live in persisted settings (`beatFx`), not here.
   */
  const fxPulses = ref<Record<BeatFxId, Record<string, BeatFxPulse>>>({
    laneGlow: {},
    markerFlash: {},
  });
  /** Latest pulse deadline per effect; keeps the frame loop check O(1). */
  const fxUntil = ref<Record<BeatFxId, number>>({
    laneGlow: 0,
    markerFlash: 0,
  });
  /** quick draw/erase mode: press-drag places/deletes markers under the cursor. */
  const quickPlace = ref(false);
  /** session-only: pin markers to absolute time so BPM/offset edits don't move them. */
  const timeAlign = ref(false);
  /** session-only: track that keyboard placement and new notes target. */
  const activeTrackId = ref<string | null>(null);
  /** session-only: collapse the track sidebar to a narrow colour strip. */
  const sidebarCollapsed = ref(false);
  const exportOpen = ref(false);
  const exportKind = ref<"timestamps" | "edl">("timestamps");
  const positionFocus = ref(0);

  function openExportImpl(kind: "timestamps" | "edl"): void {
    exportKind.value = kind;
    exportOpen.value = true;
  }

  function requestPositionFocus(): void {
    positionFocus.value++;
  }

  return {
    analysisOpen,
    analysisPos,
    beatPulse,
    overlapPulse,
    overlapCount,
    fxPulses,
    fxUntil,
    quickPlace,
    timeAlign,
    activeTrackId,
    sidebarCollapsed,
    exportOpen,
    exportKind,
    openExport: openExportImpl,
    positionFocus,
    requestPositionFocus,
  };
});

export function timeAlignOn(): boolean {
  return useUiStore().timeAlign;
}

export function toggleTimeAlign(): boolean {
  const ui = useUiStore();
  ui.timeAlign = !ui.timeAlign;
  return ui.timeAlign;
}
