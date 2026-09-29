import { pushHistory } from "../../services/history";
import { makeId } from "../../tempo";
import type { ProjectNote } from "../../types";
import { t } from "../../utils/text";
import { useProjectStore } from "./store";

// ---------- sticky notes ----------

export function addNote(opts: {
  timeMs: number;
  y: number;
  text?: string;
}): ProjectNote {
  const note: ProjectNote = {
    id: makeId(),
    timeMs: Math.max(0, opts.timeMs),
    y: Math.max(0, opts.y),
    text: opts.text ?? t("note.defaultText"),
    locked: false,
  };
  pushHistory();
  const p = useProjectStore();
  p.notes.push(note);
  p.dirty = true;
  return note;
}

export function updateNoteImpl(
  id: string,
  patch: { timeMs?: number; y?: number },
): boolean {
  const p = useProjectStore();
  const n = p.notes.find((x) => x.id === id);
  if (!n) return false;
  if (patch.timeMs !== undefined) n.timeMs = Math.max(0, patch.timeMs);
  // Notes float freely; no alignment to tracks/lanes. A generous soft bound
  // keeps them usable without ever clamping onto a lane edge (which made the
  // note look "stuck" to the cursor at a boundary).
  if (patch.y !== undefined) n.y = Math.max(0, Math.min(20000, patch.y));
  p.dirty = true;
  return true;
}

export function removeNote(id: string): void {
  const p = useProjectStore();
  const i = p.notes.findIndex((x) => x.id === id);
  if (i < 0) return;
  pushHistory();
  p.notes.splice(i, 1);
  p.dirty = true;
}

export function setNoteLocked(id: string, locked: boolean): void {
  const p = useProjectStore();
  const n = p.notes.find((x) => x.id === id);
  if (!n || n.locked === locked) return;
  pushHistory();
  n.locked = locked;
  p.dirty = true;
}

export function setNoteText(id: string, text: string): void {
  const p = useProjectStore();
  const n = p.notes.find((x) => x.id === id);
  if (!n || n.locked) return;
  if (n.text === text) return;
  pushHistory();
  n.text = text;
  p.dirty = true;
}

export function updateNote(
  id: string,
  patch: { timeMs?: number; y?: number },
): boolean {
  return useProjectStore().updateNote(id, patch);
}
