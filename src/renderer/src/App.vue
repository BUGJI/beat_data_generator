<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import TopBar from "./components/TopBar.vue";
import ProjectBar from "./components/ProjectBar.vue";
import SideBar from "./components/SideBar.vue";
import Timeline from "./components/Timeline.vue";
import TransportBar from "./components/TransportBar.vue";
import {
  store,
  togglePlay,
  removeMarker,
  moveMarker,
  snapTime,
  beatMs,
} from "./store";

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

function onKeydown(e: KeyboardEvent): void {
  if (isTyping(e.target)) return;
  const code = e.code;
  if (code === "Space") {
    e.preventDefault();
    togglePlay();
    return;
  }
  const sel = store.ui.selectedId;
  if (!sel) return;
  const marker = store.project.markers.find((m) => m.id === sel);
  if (!marker) return;
  const step = beatMs(store.project.bpm) / store.ui.snapDiv;
  if (code === "Delete" || code === "Backspace") {
    e.preventDefault();
    removeMarker(sel);
  } else if (code === "ArrowLeft" || code === "ArrowRight") {
    e.preventDefault();
    const delta = code === "ArrowLeft" ? -step : step;
    moveMarker(sel, snapTime(marker.timeMs + delta));
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="app-root">
    <TopBar />
    <ProjectBar />
    <div class="workspace">
      <SideBar />
      <Timeline />
    </div>
    <TransportBar />
  </div>
</template>
