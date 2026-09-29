import { isFreeInput } from "../../../../shared/limits";
import { pushHistory } from "../../services/history";
import { bpmAtBeat, effectiveBpmFor } from "../../services/timeline";
import { clampBpm, makeId } from "../../tempo";
import type { BpmMode, BpmPoint } from "../../types";
import { clearSelectionIfMissing, select } from "../selection";
import { clampBeat, round, snapped } from "./helpers";
import { findBpmPoint } from "./queries";
import { useProjectStore } from "./store";
import { withTimeAlign } from "./timeAlign";

// ---------- bpm points ----------

export const isBpmLocked = (): boolean => useProjectStore().bpmLocked === true;

export function setBpmLocked(v: boolean): void {
  const p = useProjectStore();
  if (p.bpmLocked === v) return;
  pushHistory();
  p.bpmLocked = v;
  p.dirty = true;
}

function pointHasBeat(beat: number, exceptId?: string): boolean {
  const b = clampBeat(beat);
  return useProjectStore().bpmPoints.some(
    (p) => p.id !== exceptId && Math.abs(p.beat - b) < 1e-6,
  );
}

export function addBpmPoint(
  rawBeat: number,
  mode: BpmMode = "abs",
  value?: number,
): BpmPoint | null {
  const p = useProjectStore();
  const beat = clampBeat(snapped(rawBeat));
  // A tempo change at beat 0 is just the base BPM: the tempo map and the saved
  // schema both ignore non-positive beats, so never create one (it would be
  // silently dropped on reload). Free-input mode stays unrestricted.
  if (!isFreeInput() && beat <= 0) return null;
  const existing = p.bpmPoints.find((pt) => Math.abs(pt.beat - beat) < 1e-6);
  if (isBpmLocked()) {
    if (existing) {
      select("bpm", existing.id);
      return existing;
    }
    return null;
  }
  if (existing) {
    select("bpm", existing.id);
    return existing;
  }
  const inheritBpm = bpmAtBeat(beat);
  pushHistory();
  const point: BpmPoint = {
    id: makeId(),
    beat,
    mode,
    value: value ?? clampBpm(inheritBpm),
  };
  withTimeAlign(() => {
    p.bpmPoints.push(point);
  });
  p.dirty = true;
  select("bpm", point.id);
  return point;
}

export function updateBpmPointImpl(
  id: string,
  patch: Partial<Pick<BpmPoint, "beat" | "mode" | "value">>,
): void {
  const p = useProjectStore();
  const pt = findBpmPoint(id);
  if (!pt || isBpmLocked()) return;
  const beat =
    patch.beat !== undefined ? clampBeat(snapped(patch.beat)) : undefined;
  if (beat !== undefined && !isFreeInput() && beat <= 0) return;
  if (beat !== undefined && pointHasBeat(beat, id)) return;
  const beatChanges = beat !== undefined && beat !== pt.beat;
  const modeChanges = patch.mode !== undefined && patch.mode !== pt.mode;
  const valueChanges = patch.value !== undefined;
  if (!beatChanges && !modeChanges && !valueChanges) return;
  pushHistory();
  withTimeAlign(() => {
    if (beat !== undefined) pt.beat = beat;
    if (patch.mode !== undefined && patch.mode !== pt.mode) {
      const eff = effectiveBpmFor(pt);
      if (patch.mode === "mult") {
        const prev = bpmAtBeat(Math.max(0, pt.beat - 1e-4));
        pt.mode = "mult";
        pt.value = prev > 0 ? round(eff / prev) : 1;
      } else {
        pt.mode = "abs";
        pt.value = clampBpm(eff);
      }
    }
    if (patch.value !== undefined) {
      const v = Number(patch.value) || 0;
      pt.value = isFreeInput()
        ? v
        : pt.mode === "mult"
          ? Math.min(100, Math.max(0.01, v))
          : clampBpm(v);
    }
  });
  p.dirty = true;
}

export function setBpmMode(id: string, mode: BpmMode): void {
  const pt = findBpmPoint(id);
  if (!pt || pt.mode === mode) return;
  updateBpmPoint(id, { mode });
}

export function removeBpmPoint(id: string): void {
  if (isBpmLocked()) return;
  const p = useProjectStore();
  const i = p.bpmPoints.findIndex((pt) => pt.id === id);
  if (i >= 0) {
    pushHistory();
    withTimeAlign(() => {
      p.bpmPoints.splice(i, 1);
    });
    p.dirty = true;
    clearSelectionIfMissing();
  }
}

// ---------- base bpm / offset recorded edits ----------

export function setBaseBpmImpl(v: number): void {
  const p = useProjectStore();
  const next = clampBpm(v);
  if (next === p.baseBpm) return;
  pushHistory();
  withTimeAlign(() => {
    p.baseBpm = next;
  });
  p.dirty = true;
}

export function setOffsetImpl(v: number): void {
  const p = useProjectStore();
  const next = isFreeInput() ? v : Math.round(v);
  if (next === p.offsetMs) return;
  pushHistory();
  withTimeAlign(() => {
    p.offsetMs = next;
  });
  p.dirty = true;
}

// ---- public function API (route through the Pinia actions) ---------------

export function updateBpmPoint(
  id: string,
  patch: Partial<Pick<BpmPoint, "beat" | "mode" | "value">>,
): void {
  useProjectStore().updateBpmPoint(id, patch);
}

export function setBaseBpm(v: number): void {
  useProjectStore().setBaseBpm(v);
}

export function setOffset(v: number): void {
  useProjectStore().setOffset(v);
}
