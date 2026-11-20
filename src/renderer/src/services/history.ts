import type { ProjectState } from "../stores/project/store";

/**
 * Undo / redo via whole-document snapshots. A snapshot only covers the parts of
 * the project that edits can change (tempo, tracks, markers, bpm points, notes);
 * paths / audio metadata / name are intentionally excluded.
 *
 * The document store registers its read/write hooks here instead of this module
 * importing it, which keeps `stores/project/*` from depending on `services/history`
 * (that used to form an import cycle).
 */

interface Snap {
  /**
   * The document serialized at snapshot time. Kept as text so capturing and
   * no-op detection each cost a single stringify (no parse until the snapshot
   * is actually applied) and so history memory can be bounded by size.
   */
  text: string;
}

/**
 * Editable subset of the project document that a snapshot covers. Deriving it
 * from `ProjectState` means a newly persisted field is a compile error here
 * until it is added, instead of silently escaping undo.
 */
export type SnapState = Pick<
  ProjectState,
  | "baseBpm"
  | "offsetMs"
  | "beatsPerBar"
  | "gridDiv"
  | "bpmLocked"
  | "tracks"
  | "markers"
  | "bpmPoints"
  | "notes"
>;

type ReadState = () => SnapState;
type WriteState = (state: SnapState) => void;

let readState: ReadState | null = null;
let writeState: WriteState | null = null;
let clearSelection: () => void = () => {};

/** Called once by the project store when it is created. */
export function registerHistoryTarget(
  read: ReadState,
  write: WriteState,
): void {
  readState = read;
  writeState = write;
}

/** Called once by the selection store so applying a snapshot drops selection. */
export function registerHistorySelectionClearer(fn: () => void): void {
  clearSelection = fn;
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
  if (!readState) return "";
  return JSON.stringify(readState());
}

function snapshotNow(): Snap | null {
  if (!readState) return null;
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
  if (!writeState) return;
  const data = JSON.parse(snap.text) as SnapState;
  writeState(data);
  clearSelection();
}

export function pushHistory(): void {
  if (editingGesture || transactionSnapshot) return;
  const snap = snapshotNow();
  if (snap) commitSnapshot(snap);
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
  if (gestureSnapshot) commitSnapshot(gestureSnapshot);
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
  const now = snapshotNow();
  if (now) redoStack.push(now);
  applySnap(prev);
  pruneHistory();
}

export function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  const now = snapshotNow();
  if (now) undoStack.push(now);
  applySnap(next);
  pruneHistory();
}
