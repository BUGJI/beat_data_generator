<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { TooltipProvider } from "reka-ui";
import TopBar from "./components/TopBar.vue";
import ProjectBar from "./components/ProjectBar.vue";
import SideBar from "./components/SideBar.vue";
import Timeline from "./components/Timeline.vue";
import TransportBar from "./components/TransportBar.vue";
import SettingsModal from "./components/SettingsModal.vue";
import ExportDialog from "./components/ExportDialog.vue";
import PluginPanels from "./components/PluginPanels.vue";
import AnalysisPanel from "./components/AnalysisPanel.vue";
import UiToaster from "./components/ui/UiToaster.vue";
import { setScroll, useViewStore, zoomBy, fitZoom } from "./stores/view";
import { useSettingsStore } from "./stores/settings";
import { loadSettings, patchSettings } from "./services/settingsPersistence";
import {
  closeCard,
  markerSelectionIds,
  selectAllMarkers,
  useSelectionStore,
  selectSingleMarker,
} from "./stores/selection";
import { toggleTimeAlign, useUiStore } from "./stores/ui";
import { clickFollow, useTransportStore } from "./stores/transport";
import {
  useProjectStore,
  addMarker,
  addNote,
  addTrack,
  moveMarkers,
  moveTrack,
  removeBpmPoint,
  removeSelectedMarkers,
  updateBpmPoint,
  findMarker,
  findBpmPoint,
  findTrack,
  gridDivAtBeat,
} from "./stores/project";
import { BPM_LANE_H, MARKER_LANE_H } from "./metrics";
import { beatOfTime, timeOfBeat } from "./services/timeline";
import { seekTo, toggleLoop, togglePlay } from "./services/playback";
import {
  bindWelcomeActions,
  openProject,
  saveProject,
  saveProjectQuick,
} from "./services/projectIO";
import { openAudioDialog } from "./services/audioIO";
import { redo, undo } from "./services/history";
import { copyMarkerGroup, pasteMarkerGroup } from "./services/clipboard";
import { resetTapTempo, tapTempo } from "./services/tapTempo";
import { initPlugins } from "./plugins/host";
import { isTypingTarget, ownsActivationKey } from "./utils/dom";
import { toast } from "./ui/toast";
import { t } from "./utils/text";
import { bindingFor, eventCombo, matchesBinding } from "./utils/shortcuts";

const settings = useSettingsStore();
const selection = useSelectionStore();
const view = useViewStore();
const ui = useUiStore();
const transport = useTransportStore();
const project = useProjectStore();

/** Add a marker at the playhead on the selected track (or the first one). */
function placeMarkerAtPlayhead(): void {
  const sel = selection.selected;
  const selMarker =
    sel.kind === "marker" && sel.id ? findMarker(sel.id) : undefined;
  const track =
    (ui.activeTrackId && findTrack(ui.activeTrackId)) ??
    (selMarker && findTrack(selMarker.trackId)) ??
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

function nudgeSelectedMarkers(delta: number): void {
  const markers = markerSelectionIds()
    .map((id) => findMarker(id))
    .filter((marker): marker is NonNullable<typeof marker> => !!marker);
  if (!markers.length) return;
  const minBeat = Math.min(...markers.map((marker) => marker.beat));
  const d = Math.max(delta, -minBeat);
  moveMarkers(
    markers.map((marker) => ({ id: marker.id, beat: marker.beat + d })),
  );
}

let unbindWelcome: (() => void) | null = null;

function onKeydown(e: KeyboardEvent): void {
  // Modal dialogs suspend all global shortcuts.
  if (settings.settingsOpen || ui.exportOpen) return;
  if (isTypingTarget(e.target)) return;
  const combo = eventCombo(e);
  if (!combo) return;
  const hit = (action: Parameters<typeof bindingFor>[0]): boolean =>
    matchesBinding(combo, bindingFor(action, settings.settings.shortcuts));

  if (hit("playAtRate")) {
    e.preventDefault();
    togglePlay();
    return;
  }
  if (hit("playPause")) {
    if (ownsActivationKey(e.target)) return;
    e.preventDefault();
    if (settings.settings.ctrlSpeedPlay && !(e.ctrlKey || e.metaKey)) {
      togglePlay(1);
    } else {
      togglePlay();
    }
    return;
  }
  if (hit("save")) {
    e.preventDefault();
    void saveProjectQuick();
    return;
  }
  if (hit("saveAs")) {
    e.preventDefault();
    void saveProject(true);
    return;
  }
  if (hit("openProject")) {
    e.preventDefault();
    void openProject();
    return;
  }
  if (hit("openAudio")) {
    e.preventDefault();
    void openAudioDialog();
    return;
  }
  if (hit("goto")) {
    e.preventDefault();
    ui.requestPositionFocus();
    return;
  }
  if (hit("undo")) {
    e.preventDefault();
    undo();
    return;
  }
  if (hit("redo")) {
    e.preventDefault();
    redo();
    return;
  }
  if (hit("copy")) {
    e.preventDefault();
    copyMarkerGroup();
    return;
  }
  if (hit("cut")) {
    e.preventDefault();
    if (!copyMarkerGroup()) return;
    const before = project.markers.length;
    if (removeSelectedMarkers()) {
      toast.undo(
        t("dialogs.deletedMarkers", {
          n: before - project.markers.length,
        }),
        undo,
      );
    }
    return;
  }
  if (hit("paste")) {
    e.preventDefault();
    pasteMarkerGroup();
    return;
  }
  if (hit("selectAll")) {
    e.preventDefault();
    selectAllMarkers();
    return;
  }
  if (hit("zoomFit")) {
    e.preventDefault();
    fitZoom(view.vw);
    return;
  }
  if (hit("zoomIn")) {
    e.preventDefault();
    zoomBy(1.3);
    return;
  }
  if (hit("zoomOut")) {
    e.preventDefault();
    zoomBy(1 / 1.3);
    return;
  }
  if (hit("placeMarker")) {
    e.preventDefault();
    placeMarkerAtPlayhead();
    return;
  }
  if (hit("tapTempoReset")) {
    e.preventDefault();
    resetTapTempo();
    return;
  }
  if (hit("tapTempo")) {
    e.preventDefault();
    tapTempo();
    return;
  }
  if (hit("prevMarker")) {
    e.preventDefault();
    selectAdjacentMarker(-1);
    return;
  }
  if (hit("nextMarker")) {
    e.preventDefault();
    selectAdjacentMarker(1);
    return;
  }
  if (hit("home")) {
    e.preventDefault();
    seekTo(0);
    setScroll(0, 0);
    return;
  }
  if (hit("escape")) {
    e.preventDefault();
    if (ui.analysisOpen) {
      ui.analysisOpen = false;
      return;
    }
    closeCard();
    return;
  }
  if (hit("toggleSnap")) {
    e.preventDefault();
    view.snapEnabled = !view.snapEnabled;
    return;
  }
  if (hit("toggleMagnet")) {
    e.preventDefault();
    view.magnetEnabled = !view.magnetEnabled;
    return;
  }
  if (hit("toggleQuickPlace")) {
    e.preventDefault();
    ui.quickPlace = !ui.quickPlace;
    return;
  }
  if (hit("toggleTimeAlign")) {
    e.preventDefault();
    toggleTimeAlign();
    return;
  }
  if (hit("toggleFollow")) {
    e.preventDefault();
    clickFollow();
    return;
  }
  if (hit("toggleLoop")) {
    e.preventDefault();
    toggleLoop();
    return;
  }
  if (hit("toggleGridClick")) {
    e.preventDefault();
    void patchSettings({
      gridMetronome: !settings.settings.gridMetronome,
    });
    return;
  }
  if (hit("toggleAnalysis")) {
    e.preventDefault();
    ui.analysisOpen = !ui.analysisOpen;
    return;
  }
  if (hit("addTrack")) {
    e.preventDefault();
    const track = addTrack();
    ui.activeTrackId = track.id;
    return;
  }
  if (hit("moveTrackUp") || hit("moveTrackDown")) {
    e.preventDefault();
    const id = ui.activeTrackId ?? project.tracks[0]?.id;
    if (id) moveTrack(id, hit("moveTrackUp") ? -1 : 1);
    return;
  }
  if (hit("addNote")) {
    e.preventDefault();
    addNote({
      timeMs: transport.positionMs,
      y: BPM_LANE_H + MARKER_LANE_H / 2,
    });
    return;
  }
  if (hit("exportTimestamps")) {
    e.preventDefault();
    ui.openExport("timestamps");
    return;
  }
  if (hit("exportEdl")) {
    e.preventDefault();
    ui.openExport("edl");
    return;
  }

  const sel = selection.selected;
  if (!sel.kind || !sel.id) return;

  if (sel.kind === "marker") {
    const m = findMarker(sel.id);
    if (!m) return;
    const step = 1 / gridDivAtBeat(m.beat);
    if (hit("deleteSel")) {
      e.preventDefault();
      const before = project.markers.length;
      if (removeSelectedMarkers()) {
        const removed = before - project.markers.length;
        toast.undo(t("dialogs.deletedMarkers", { n: removed }), undo);
      }
    } else if (hit("nudgeLeft")) {
      e.preventDefault();
      nudgeSelectedMarkers(-step);
    } else if (hit("nudgeRight")) {
      e.preventDefault();
      nudgeSelectedMarkers(step);
    }
  } else if (sel.kind === "bpm") {
    const p = findBpmPoint(sel.id);
    if (!p) return;
    const step = 1 / gridDivAtBeat(p.beat);
    if (hit("deleteSel")) {
      e.preventDefault();
      if (removeBpmPoint(p.id)) {
        toast.undo(t("dialogs.deletedBpm"), undo);
      }
      closeCard();
    } else if (hit("nudgeLeft")) {
      e.preventDefault();
      updateBpmPoint(p.id, { beat: Math.max(0, p.beat - step) });
    } else if (hit("nudgeRight")) {
      e.preventDefault();
      updateBpmPoint(p.id, { beat: Math.max(0, p.beat + step) });
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
      <ExportDialog />
      <PluginPanels />
      <AnalysisPanel />
      <UiToaster />
    </TooltipProvider>
  </div>
</template>
