import { useProjectStore } from "../stores/project";
import { useSelectionStore } from "../stores/selection";
import type { BpmPoint, Marker, MarkerTrack, ProjectNote } from "../types";

/**
 * Undo / redo via whole-document snapshots. A snapshot only covers the parts of
 * the project that edits can change (tempo, tracks, markers, bpm points, notes);
 * paths / audio metadata / name are intentionally excluded.
 */

interface Snap {
  /**
   * The document serialized at snapshot time. Kept as text so capturing and
   * no-op detection each cost a single stringify (no parse until the snapshot
   * is actually applied) and so history memory can be bounded by size.
   */
  text: string;
}

interface SnapState {
  baseBpm: number;
  offsetMs: number;
  bpmLocked: boolean;
  tracks: MarkerTrack[];
  markers: Marker[];
  bpmPoints: BpmPoint[];
  notes: ProjectNote[];
}

/** Cap history by step count and, for large projects, by total serialized size. */
const MAX_HISTORY_STEPS = 100;
const MAX_HISTORY_CHARS = 8_000_000;

const undoStack: Snap[] = [];
const redoStack: Snap[] = [];
let editingGesture = false;
let gestureSnapshot: Snap | null = null;
let transactionSnapshot: Snap | null = null;

function captureState(): string {
  const p = useProjectStore();
  return JSON.stringify({
    baseBpm: p.baseBpm,
    offsetMs: p.offsetMs,
    bpmLocked: p.bpmLocked,
    tracks: p.tracks,
    markers: p.markers,
    bpmPoints: p.bpmPoints,
    notes: p.notes,
  });
}

function snapshotNow(): Snap {
  return { text: captureState() };
}

/** Drop the oldest entries once either the step or the size budget is exceeded. */
function pruneHistory(): void {
  while (undoStack.length > MAX_HISTORY_STEPS) undoStack.shift();
  let total = 0;
  for (const s of undoStack) total += s.text.length;
  for (const s of redoStack) total += s.text.length;
  while (total > MAX_HISTORY_CHARS && undoStack.length > 1) {
    total -= undoStack.shift()!.text.length;
  }
  while (total > MAX_HISTORY_CHARS && redoStack.length) {
    total -= redoStack.shift()!.text.length;
  }
}

function commitSnapshot(snap: Snap): void {
  undoStack.push(snap);
  redoStack.length = 0;
  pruneHistory();
}

function applySnap(snap: Snap): void {
  const p = useProjectStore();
  const data = JSON.parse(snap.text) as SnapState;
  p.baseBpm = data.baseBpm;
  p.offsetMs = data.offsetMs;
  p.bpmLocked = data.bpmLocked;
  p.tracks = data.tracks;
  p.markers = data.markers;
  p.bpmPoints = data.bpmPoints;
  p.notes = data.notes;
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
  if (captureState() === snap.text) return;
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
    if (captureState() === gestureSnapshot.text) undoStack.pop();
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
  pruneHistory();
}

export function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshotNow());
  applySnap(next);
  pruneHistory();
}
