import { useProjectStore } from "../stores/project";
import { useSelectionStore } from "../stores/selection";
import type { BpmPoint, Marker, MarkerTrack, ProjectNote } from "../types";

/**
 * Undo / redo via whole-document snapshots. A snapshot only covers the parts of
 * the project that edits can change (tempo, tracks, markers, bpm points, notes);
 * paths / audio metadata / name are intentionally excluded.
 */

interface Snap {
  baseBpm: number;
  offsetMs: number;
  bpmLocked: boolean;
  tracks: unknown;
  markers: unknown;
  bpmPoints: unknown;
  notes: unknown;
}

const undoStack: Snap[] = [];
const redoStack: Snap[] = [];
let editingGesture = false;
let gestureSnapshot: Snap | null = null;
let transactionSnapshot: Snap | null = null;

function snapshotNow(): Snap {
  const p = useProjectStore();
  return JSON.parse(
    JSON.stringify({
      baseBpm: p.baseBpm,
      offsetMs: p.offsetMs,
      bpmLocked: p.bpmLocked,
      tracks: p.tracks,
      markers: p.markers,
      bpmPoints: p.bpmPoints,
      notes: p.notes,
    }),
  ) as Snap;
}

function commitSnapshot(snap: Snap): void {
  undoStack.push(snap);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

function applySnap(snap: Snap): void {
  const p = useProjectStore();
  p.baseBpm = snap.baseBpm;
  p.offsetMs = snap.offsetMs;
  p.bpmLocked = snap.bpmLocked;
  p.tracks = snap.tracks as MarkerTrack[];
  p.markers = snap.markers as Marker[];
  p.bpmPoints = snap.bpmPoints as BpmPoint[];
  p.notes = snap.notes as ProjectNote[];
  const sel = useSelectionStore();
  sel.selected = { kind: null, id: null };
  sel.multi = [];
  sel.cardOpen = false;
  p.dirty = true;
}

export function pushHistory(): void {
  if (editingGesture || transactionSnapshot) return;
  commitSnapshot(snapshotNow());
}

/**
 * Record an edit that may turn out to be a no-op. The caller captures the state
 * up front and commits a single undo step only if the document actually changed
 * by the time the transaction ends — so a blocked delete or a paste that adds
 * nothing never leaves a phantom entry on the undo stack. Nesting is ignored.
 */
export function beginEditTransaction(): void {
  if (transactionSnapshot || editingGesture) return;
  transactionSnapshot = snapshotNow();
}

export function endEditTransaction(): void {
  const snap = transactionSnapshot;
  transactionSnapshot = null;
  if (!snap) return;
  if (JSON.stringify(snapshotNow()) === JSON.stringify(snap)) return;
  commitSnapshot(snap);
}

export function historyGestureBegin(): void {
  if (editingGesture || transactionSnapshot) return;
  editingGesture = true;
  gestureSnapshot = snapshotNow();
  commitSnapshot(gestureSnapshot);
}

export function historyGestureEnd(): void {
  editingGesture = false;
  // a gesture that ended without an actual edit must not leave a no-op undo entry.
  if (gestureSnapshot) {
    const cur = snapshotNow();
    if (JSON.stringify(cur) === JSON.stringify(gestureSnapshot)) {
      undoStack.pop();
    }
    gestureSnapshot = null;
  }
}

export function resetHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  editingGesture = false;
  gestureSnapshot = null;
  transactionSnapshot = null;
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}
export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(snapshotNow());
  applySnap(prev);
}

export function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshotNow());
  applySnap(next);
}
