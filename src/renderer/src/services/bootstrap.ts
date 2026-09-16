import { engine } from "../engine";
import { useTransportStore } from "../stores/transport";
import { ensureDefaultTrack } from "../stores/project";
import { initPluginEvents } from "../plugins/events";
import { tickBeatFlash } from "./flash";
import { autoSaveTick } from "./projectIO";

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
}
