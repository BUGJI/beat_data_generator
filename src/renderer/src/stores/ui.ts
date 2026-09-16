import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Session-only editor UI flags and transient pulse counters.
 * Nothing here is persisted or part of the project document.
 */
export const useUiStore = defineStore("ui", () => {
  /** session-only: audio analysis panel open state. */
  const analysisOpen = ref(false);
  const beatPulse = ref(0);
  const overlapPulse = ref(0);
  const overlapCount = ref(0);
  /** master switch for per-track lane/header glow on marker pass. */
  const glowEnabled = ref(false);
  /** per-track pulse sequence used to re-trigger 0.1s glow effects. */
  const glowSeqs = ref<Record<string, number>>({});
  /** quick draw/erase mode: press-drag places/deletes markers under the cursor. */
  const quickPlace = ref(false);
  /** session-only: pin markers to absolute time so BPM/offset edits don't move them. */
  const timeAlign = ref(false);

  return {
    analysisOpen,
    beatPulse,
    overlapPulse,
    overlapCount,
    glowEnabled,
    glowSeqs,
    quickPlace,
    timeAlign,
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
