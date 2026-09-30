import { watch } from "vue";
import { engine } from "../engine";
import { useTransportStore } from "../stores/transport";
import { ensureDefaultTrack, useProjectStore } from "../stores/project";
import { initPluginEvents } from "../plugins/events";
import { tickBeatFlash } from "./flash";
import { autoSaveTick, saveProjectQuick } from "./projectIO";

/**
 * One-time runtime wiring that used to run as a module-level side effect of the
 * old monolithic store: the engine tick handler, the default track and the
 * autosave timer. Call once after Pinia is installed.
 */
export function initEditorRuntime(): void {
  const t = useTransportStore();
  engine.onTick = () => {
    t.positionMs = engine.positionMs();
    const dur = engine.durationMs();
    if (dur > 0 && t.positionMs >= dur - 1 && !t.buffering) {
      t.playing = false;
    }
    tickBeatFlash();
  };
  engine.setVolume(t.volume);
  initPluginEvents();
  ensureDefaultTrack();
  window.setInterval(() => {
    void autoSaveTick();
  }, 1000);

  // Keep the main process informed about unsaved edits so it can guard quit,
  // and fulfill a save-before-quit request through the normal save path.
  const project = useProjectStore();
  window.api.setDirty(project.dirty);
  watch(
    () => project.dirty,
    (dirty) => window.api.setDirty(dirty),
  );
  window.api.onQuitRequest(() => {
    void (async () => {
      await saveProjectQuick();
      if (!useProjectStore().dirty) await window.api.confirmQuit();
    })();
  });
}
