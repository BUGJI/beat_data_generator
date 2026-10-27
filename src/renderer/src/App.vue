<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { TooltipProvider } from "reka-ui";
import TopBar from "./components/TopBar.vue";
import ProjectBar from "./components/ProjectBar.vue";
import SideBar from "./components/SideBar.vue";
import Timeline from "./components/Timeline.vue";
import TransportBar from "./components/TransportBar.vue";
import SettingsModal from "./components/SettingsModal.vue";
import PluginPanels from "./components/PluginPanels.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import UiToaster from "./components/ui/UiToaster.vue";
import { setScroll, useViewStore, zoomBy, fitZoom } from "./stores/view";
import { loadSettings, useSettingsStore } from "./stores/settings";
import {
  closeCard,
  useSelectionStore,
  selectSingleMarker,
} from "./stores/selection";
import { useUiStore } from "./stores/ui";
import { useTransportStore } from "./stores/transport";
import {
  useProjectStore,
  addMarker,
  removeBpmPoint,
  removeSelectedMarkers,
  moveMarker,
  updateBpmPoint,
  findMarker,
  findBpmPoint,
  gridDivAtBeat,
} from "./stores/project";
import { beatOfTime, timeOfBeat } from "./services/timeline";
import { seekTo, togglePlay } from "./services/playback";
import { bindWelcomeActions, saveProjectQuick } from "./services/projectIO";
import { redo, undo } from "./services/history";
import { copyMarkerGroup, pasteMarkerGroup } from "./services/clipboard";
import { initPlugins } from "./plugins/host";

const settings = useSettingsStore();
const selection = useSelectionStore();
const view = useViewStore();
const ui = useUiStore();
const transport = useTransportStore();
const project = useProjectStore();

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/** Focused interactive controls own Space/Enter, so the global shortcuts must
 *  not also fire while one of them is focused. */
function ownsActivationKey(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest("button, a[href], [role='button'], [role='tab']");
}

/** Add a marker at the playhead on the selected track (or the first one). */
function placeMarkerAtPlayhead(): void {
  const sel = selection.selected;
  const selMarker =
    sel.kind === "marker" && sel.id ? findMarker(sel.id) : undefined;
  const track =
    (selMarker && project.tracks.find((tr) => tr.id === selMarker.trackId)) ??
    project.tracks[0];
  if (!track) return;
  addMarker(track.id, beatOfTime(transport.positionMs));
}

/** Select and seek to the previous / next marker in time order. */
function selectAdjacentMarker(dir: 1 | -1): void {
  const list = [...project.markers].sort(
    (a, b) => timeOfBeat(a.beat) - timeOfBeat(b.beat),
  );
  if (!list.length) return;
  const cur = transport.positionMs;
  let target: (typeof list)[number] | undefined;
  if (dir === 1) {
    target = list.find((m) => timeOfBeat(m.beat) > cur + 1e-6);
  } else {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]!;
      if (timeOfBeat(m.beat) < cur - 1e-6) {
        target = m;
        break;
      }
    }
  }
  if (!target) return;
  selectSingleMarker(target.id);
  seekTo(timeOfBeat(target.beat));
}

let unbindWelcome: (() => void) | null = null;

function onKeydown(e: KeyboardEvent): void {
  // The settings dialog is modal: suspend all global shortcuts while it is open.
  if (settings.settingsOpen) return;
  if (isTyping(e.target)) return;
  const code = e.code;
  if ((code === "Space" || code === "Enter") && ownsActivationKey(e.target))
    return;
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      void saveProjectQuick();
      return;
    }
    if (k === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (k === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (k === "c") {
      e.preventDefault();
      copyMarkerGroup();
      return;
    }
    if (k === "v") {
      e.preventDefault();
      pasteMarkerGroup();
      return;
    }
    if (k === "0") {
      e.preventDefault();
      fitZoom(view.vw);
      return;
    }
    if (k === "=" || k === "+") {
      e.preventDefault();
      zoomBy(1.3);
      return;
    }
    if (k === "-") {
      e.preventDefault();
      zoomBy(1 / 1.3);
      return;
    }
  }
  const cmd = e.ctrlKey || e.metaKey;
  if (code === "KeyM" && !e.altKey && !cmd) {
    e.preventDefault();
    placeMarkerAtPlayhead();
    return;
  }
  if (
    (code === "Comma" && !e.altKey && !cmd) ||
    (code === "ArrowLeft" && e.altKey)
  ) {
    e.preventDefault();
    selectAdjacentMarker(-1);
    return;
  }
  if (
    (code === "Period" && !e.altKey && !cmd) ||
    (code === "ArrowRight" && e.altKey)
  ) {
    e.preventDefault();
    selectAdjacentMarker(1);
    return;
  }
  if (code === "Space") {
    e.preventDefault();
    const ctrlPlay = settings.settings.ctrlSpeedPlay;
    if (ctrlPlay) {
      if (e.ctrlKey || e.metaKey) togglePlay();
      else togglePlay(1);
    } else {
      togglePlay();
    }
    return;
  }
  if (code === "Home") {
    e.preventDefault();
    seekTo(0);
    setScroll(0, 0);
    return;
  }
  if (code === "Escape") {
    // Close the top-most layer first, then fall back to the property card.
    if (ui.analysisOpen) {
      ui.analysisOpen = false;
      return;
    }
    closeCard();
    return;
  }
  const sel = selection.selected;
  if (!sel.kind || !sel.id) return;

  if (sel.kind === "marker") {
    const m = findMarker(sel.id);
    if (!m) return;
    const step = 1 / gridDivAtBeat(m.beat);
    const delta =
      code === "ArrowLeft" ? -step : code === "ArrowRight" ? step : 0;
    if (code === "Delete" || code === "Backspace") {
      e.preventDefault();
      removeSelectedMarkers();
    } else if (delta !== 0) {
      e.preventDefault();
      moveMarker(m.id, m.beat + delta, true);
    }
  } else if (sel.kind === "bpm") {
    const p = findBpmPoint(sel.id);
    if (!p) return;
    const step = 1 / gridDivAtBeat(p.beat);
    const delta =
      code === "ArrowLeft" ? -step : code === "ArrowRight" ? step : 0;
    if (code === "Delete" || code === "Backspace") {
      e.preventDefault();
      removeBpmPoint(p.id);
      closeCard();
    } else if (delta !== 0) {
      e.preventDefault();
      updateBpmPoint(p.id, { beat: Math.max(0, p.beat + delta) });
    }
  }
}

onMounted(() => {
  void loadSettings();
  unbindWelcome = bindWelcomeActions();
  void initPlugins();
  void window.api.notifyAppReady();
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  unbindWelcome?.();
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="app-root">
    <!-- Single tooltip provider for the whole app; UiTooltip overrides the
         delay per instance via TooltipRoot. -->
    <TooltipProvider :delay-duration="250">
      <div class="app-bg" aria-hidden="true" />
      <TopBar />
      <ProjectBar />
      <div class="workspace">
        <SideBar />
        <Timeline />
      </div>
      <TransportBar />
      <SettingsModal />
      <PluginPanels />
      <AnalysisPanel />
      <UiToaster />
    </TooltipProvider>
  </div>
</template>
