import type { BeatFxId } from "@shared/beatFx";
import { useSettingsStore } from "./settings";
import { patchSettings } from "../services/settingsPersistence";

/** Persisted selection flag for one playback visual effect. */
export function beatFxSelected(id: BeatFxId): boolean {
  return useSettingsStore().settings.beatFx[id] === true;
}

/**
 * Flip one effect's selection; applies immediately, persists debounced. The
 * persisted master switch (`beatFxMaster`) decides whether the selected
 * effects actually render.
 */
export function toggleBeatFxSelected(id: BeatFxId): void {
  patchSettings({
    beatFx: {
      ...useSettingsStore().settings.beatFx,
      [id]: !beatFxSelected(id),
    },
  });
}
