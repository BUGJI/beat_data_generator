import { normalizeGridDiv } from "../../grid";
import { pushHistory } from "../../services/history";
import { useProjectStore } from "./store";

// ---------- global beat-grid subdivision ----------

export function setGridDivImpl(v: number): void {
  const p = useProjectStore();
  const next = normalizeGridDiv(v, Number.NaN);
  if (!Number.isFinite(next) || next === p.gridDiv) return;
  pushHistory();
  p.gridDiv = next;
  p.dirty = true;
}

// ---------- per-BPM-point grid override ----------

/** Set (or clear with null) a BPM point's grid subdivision override. */
export function setBpmGridDivImpl(id: string, div: number | null): void {
  const p = useProjectStore();
  if (p.bpmLocked) return;
  const pt = p.bpmPoints.find((x) => x.id === id);
  if (!pt) return;
  if (div === null) {
    if (pt.gridDiv === undefined) return;
    pushHistory();
    delete pt.gridDiv;
    p.dirty = true;
    return;
  }
  const next = normalizeGridDiv(div, Number.NaN);
  if (!Number.isFinite(next) || pt.gridDiv === next) return;
  pushHistory();
  pt.gridDiv = next;
  p.dirty = true;
}

// ---- public function API (route through the Pinia actions) ---------------

export function setGridDiv(v: number): void {
  useProjectStore().setGridDiv(v);
}

export function setBpmGridDiv(id: string, div: number | null): void {
  useProjectStore().setBpmGridDiv(id, div);
}
