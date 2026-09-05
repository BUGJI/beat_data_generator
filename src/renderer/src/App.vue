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
  removeBpmPoint,
  moveMarker,
  updateBpmPoint,
  findMarker,
  findBpmPoint,
  select,
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
  if (code === "Escape") {
    select(null, null);
    return;
  }
  const sel = store.ui.selected;
  if (!sel.kind || !sel.id) return;
  const step = 1 / store.ui.snapDiv;
  const delta = code === "ArrowLeft" ? -step : code === "ArrowRight" ? step : 0;

  if (sel.kind === "marker") {
    const m = findMarker(sel.id);
    if (!m) return;
    if (code === "Delete" || code === "Backspace") {
      e.preventDefault();
      removeMarker(m.id);
      select(null, null);
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
      select(null, null);
    } else if (delta !== 0) {
      e.preventDefault();
      updateBpmPoint(p.id, { beat: Math.max(0, p.beat + delta) });
    }
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
