<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { render as mdRender, escapeHtml } from "slimdown-js";
import {
  useProjectStore,
  removeNote,
  setNoteLocked,
  setNoteText,
  updateNote,
} from "../../stores/project";
import { timeToScreenX, useViewStore } from "../../stores/view";
import { RULER_H } from "../../metrics";
import { historyGestureBegin, historyGestureEnd } from "../../services/history";
import type { ProjectNote } from "../../types";

const { t } = useI18n();
const project = useProjectStore();
const view = useViewStore();

const layerEl = ref<HTMLElement | null>(null);

const editingNoteId = ref<string | null>(null);
const editingDraft = ref("");
let dragNoteId: string | null = null;
let dragGrab: { dx: number; dy: number } | null = null;
let dragTarget: { timeMs: number; y: number } | null = null;
let dragRaf = 0;

const noteOf = (id: string): ProjectNote | undefined =>
  project.notes.find((n) => n.id === id);

const noteTextOf = (id: string): string => noteOf(id)?.text ?? "";

const noteLayouts = computed(() =>
  project.notes.map((n) => ({
    id: n.id,
    left: timeToScreenX(n.timeMs),
    top: RULER_H + n.y - view.y,
    locked: n.locked === true,
  })),
);

function noteHtml(text: string): string {
  return text ? mdRender(escapeHtml(text)) : "";
}

function onNoteDown(e: PointerEvent, note: ProjectNote | undefined): void {
  if (!note || note.locked) return;
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest("textarea") || target.closest(".note-edit")) return;
  if (target.closest(".note-tools")) return;
  dragNoteId = note.id;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragGrab = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  historyGestureBegin();
  window.addEventListener("pointermove", onNoteDragMove);
  window.addEventListener("pointerup", onNoteDragEnd);
  e.preventDefault();
}

function onNoteDragMove(e: PointerEvent): void {
  const root = layerEl.value?.parentElement;
  if (!dragNoteId || !dragGrab || !root) return;
  const rect = root.getBoundingClientRect();
  const cx = e.clientX - rect.left - dragGrab.dx;
  const cy = e.clientY - rect.top - dragGrab.dy;
  const timeMs = ((cx + view.x) / view.pxPerSec) * 1000;
  const y = cy - RULER_H + view.y;
  dragTarget = { timeMs, y };
  if (!dragRaf) {
    dragRaf = requestAnimationFrame(applyNoteDrag);
  }
  e.preventDefault();
}

function applyNoteDrag(): void {
  dragRaf = 0;
  if (!dragNoteId || !dragTarget) return;
  const target = dragTarget;
  dragTarget = null;
  updateNote(dragNoteId, target);
}

function onNoteDragEnd(): void {
  window.removeEventListener("pointermove", onNoteDragMove);
  window.removeEventListener("pointerup", onNoteDragEnd);
  // cancel any in-flight frame and flush the final position so the drag
  // always releases cleanly instead of staying stuck to the cursor.
  if (dragRaf) {
    cancelAnimationFrame(dragRaf);
    dragRaf = 0;
  }
  applyNoteDrag();
  historyGestureEnd();
  dragNoteId = null;
  dragGrab = null;
  dragTarget = null;
}

function startNoteEdit(note: ProjectNote | undefined): void {
  if (!note || note.locked) return;
  editingNoteId.value = note.id;
  editingDraft.value = note.text;
}

function commitNoteEdit(): void {
  if (!editingNoteId.value) return;
  setNoteText(editingNoteId.value, editingDraft.value);
  editingNoteId.value = null;
}

function cancelNoteEdit(): void {
  editingNoteId.value = null;
}
</script>

<template>
  <div ref="layerEl" class="notes-layer">
    <div
      v-for="nl in noteLayouts"
      :key="nl.id"
      class="note"
      :class="{ locked: nl.locked }"
      :style="{ left: nl.left + 'px', top: nl.top + 'px' }"
      @pointerdown.stop="onNoteDown($event, noteOf(nl.id))"
      @wheel.stop
      @contextmenu.stop
    >
      <div class="note-head">
        <span class="note-grip">⠿</span>
        <span class="note-title">{{ t("note.title") }}</span>
        <span class="note-tools">
          <button
            class="note-tool"
            :title="t('note.lock')"
            :aria-label="t('a11y.lockNote')"
            :aria-pressed="nl.locked"
            @click.stop="setNoteLocked(nl.id, !nl.locked)"
          >
            {{ nl.locked ? "🔒" : "🔓" }}
          </button>
          <button
            class="note-tool"
            :title="t('note.delete')"
            :aria-label="t('a11y.deleteNote')"
            @click.stop="removeNote(nl.id)"
          >
            ✕
          </button>
        </span>
      </div>
      <div v-if="editingNoteId === nl.id" class="note-edit">
        <textarea
          v-model="editingDraft"
          spellcheck="false"
          @blur="commitNoteEdit"
          @keydown.esc.stop.prevent="cancelNoteEdit"
          @keydown.ctrl.enter.stop.prevent="commitNoteEdit"
          @pointerdown.stop
        />
      </div>
      <div
        v-else
        class="note-body md"
        :title="t('note.editHint')"
        @dblclick.stop="startNoteEdit(noteOf(nl.id))"
        v-html="noteHtml(noteTextOf(nl.id))"
      />
    </div>
  </div>
</template>

<style scoped>
.notes-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}
.note {
  position: absolute;
  pointer-events: auto;
  width: 180px;
  min-height: 70px;
  background: var(--bdg-bg-raised);
  border: 1px solid rgb(var(--bdg-neutral) / 0.35);
  border-left: 3px solid var(--bdg-accent);
  border-radius: var(--bdg-radius, 6px);
  box-shadow: 0 4px 16px var(--bdg-shadow);
  overflow: hidden;
  user-select: none;
}
.note.locked {
  border-left-color: var(--bdg-amber);
}
.note.locked .note-body {
  opacity: 0.6;
}
.note-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: rgb(var(--bdg-neutral) / 0.12);
  cursor: grab;
}
.note.locked .note-head {
  cursor: default;
}
.note-grip {
  color: var(--bdg-text-dim);
  font-size: var(--bdg-fs-12);
  line-height: 1;
}
.note-title {
  flex: 1;
  min-width: 0;
  font-size: var(--bdg-fs-11);
  font-weight: 700;
  color: var(--bdg-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-tools {
  display: inline-flex;
  gap: 2px;
}
.note-tool {
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  border-radius: var(--bdg-radius-md);
  font-size: var(--bdg-fs-11);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.note-tool:hover {
  background: rgb(var(--bdg-neutral) / 0.18);
  color: var(--bdg-text);
}
.note-body {
  padding: 6px 8px 7px;
  font-size: var(--bdg-fs-12);
  cursor: default;
  position: relative;
}
.note-body::after {
  content: "dbl-click:edit";
  position: absolute;
  right: 6px;
  bottom: -2px;
  font-size: var(--bdg-fs-9);
  color: rgb(var(--bdg-neutral) / 0.35);
  line-height: 1;
}
.note-body.md h1 {
  font-size: var(--bdg-fs-14);
  margin: 0 0 4px;
}
.note-body.md h2,
.note-body.md h3 {
  font-size: var(--bdg-fs-12-5);
  margin: 0 0 3px;
}
.note-body.md p {
  margin: 0 0 4px;
  white-space: pre-wrap;
}
.note-body.md ul,
.note-body.md ol {
  padding-left: 16px;
  margin: 0 0 4px;
}
.note-body.md li {
  margin-bottom: 1px;
}
.note-body.md code {
  background: rgb(var(--bdg-neutral) / 0.15);
  padding: 0 3px;
  border-radius: var(--bdg-radius-xs);
  font-size: var(--bdg-fs-11);
}
.note-body.md a {
  color: var(--bdg-accent);
}
.note-edit {
  padding: 6px;
}
.note-edit textarea {
  width: 100%;
  min-height: 76px;
  background: var(--bdg-bg-sunken);
  border: 1px solid var(--bdg-border-strong);
  border-radius: var(--bdg-radius, 6px);
  color: var(--bdg-text);
  font: inherit;
  font-size: var(--bdg-fs-12);
  line-height: 1.45;
  resize: vertical;
  padding: 4px 6px;
  outline: none;
  user-select: text;
}
</style>
