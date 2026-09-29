<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import TopBar from "./components/TopBar.vue";
import ProjectBar from "./components/ProjectBar.vue";
import SideBar from "./components/SideBar.vue";
import Timeline from "./components/Timeline.vue";
import TransportBar from "./components/TransportBar.vue";
import SettingsModal from "./components/SettingsModal.vue";
import PluginPanels from "./components/PluginPanels.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import UiToaster from "./components/ui/UiToaster.vue";
import { setScroll, useViewStore } from "./stores/view";
import { loadSettings, useSettingsStore } from "./stores/settings";
import { closeCard, useSelectionStore } from "./stores/selection";
import {
  removeBpmPoint,
  removeSelectedMarkers,
  moveMarker,
  updateBpmPoint,
  findMarker,
  findBpmPoint,
} from "./stores/project";
import { seekTo, togglePlay } from "./services/playback";
import { bindWelcomeActions, saveProjectQuick } from "./services/projectIO";
import { redo, undo } from "./services/history";
import { copyMarkerGroup, pasteMarkerGroup } from "./services/clipboard";
import { initPlugins } from "./plugins/host";

const settings = useSettingsStore();
const selection = useSelectionStore();
const view = useViewStore();

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
    closeCard();
    return;
  }
  const sel = selection.selected;
  if (!sel.kind || !sel.id) return;
  const step = 1 / view.snapDiv;
  const delta = code === "ArrowLeft" ? -step : code === "ArrowRight" ? step : 0;

  if (sel.kind === "marker") {
    const m = findMarker(sel.id);
    if (!m) return;
    if (code === "Delete" || code === "Backspace") {
      e.preventDefault();
      removeSelectedMarkers();
    } else if (
      (delta && code === "ArrowLeft") ||
      (delta && code === "ArrowRight")
    ) {
      e.preventDefault();
      moveMarker(m.id, m.beat + delta, true);
    }
  } else if (sel.kind === "bpm") {
    const p = findBpmPoint(sel.id);
    if (!p) return;
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
  </div>
</template>
