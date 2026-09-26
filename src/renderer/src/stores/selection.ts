import { defineStore } from "pinia";
import { ref } from "vue";
import {
  findBpmPoint,
  findMarker,
  resolveMainMarker,
  useProjectStore,
} from "./project";

export interface Selection {
  kind: "marker" | "bpm" | null;
  id: string | null;
}

/**
 * Editor selection: the active marker/bpm point, the extra multi-select list
 * and whether the floating property card is open. Session-only.
 *
 * Selection changes are exposed as Pinia actions so drag/click bursts show up
 * as a single named action in Vue DevTools.
 */
export const useSelectionStore = defineStore("selection", () => {
  const selected = ref<Selection>({ kind: null, id: null });
  const multi = ref<string[]>([]);
  const cardOpen = ref(false);

  function selectImpl(kind: "marker" | "bpm" | null, id: string | null): void {
    selected.value = { kind, id };
  }

  function selectSingleMarkerImpl(id: string): void {
    const main = resolveMainMarker(findMarker(id));
    if (!main) return;
    selected.value = { kind: "marker", id: main.id };
    multi.value = [];
  }

  function toggleMarkerSelectImpl(id: string): void {
    const main = resolveMainMarker(findMarker(id));
    if (!main) return;
    const mid = main.id;
    const list = markerSelectionIds();
    const had = list.includes(mid);
    const next = had ? list.filter((x) => x !== mid) : [...list, mid];
    if (!next.length) {
      selected.value = { kind: null, id: null };
      multi.value = [];
      return;
    }
    const active = next.includes(mid) ? mid : (next[next.length - 1] as string);
    selected.value = { kind: "marker", id: active };
    multi.value = next.filter((x) => x !== active);
  }

  function selectAllMarkersImpl(): boolean {
    const mains = useProjectStore().markers.filter((m) => !m.parentId);
    if (!mains.length) {
      closeCardImpl();
      return false;
    }
    selected.value = { kind: "marker", id: mains[0]!.id };
    multi.value = mains.slice(1).map((m) => m.id);
    cardOpen.value = false;
    return true;
  }

  function boxSelectMarkersImpl(ids: string[]): void {
    const mains = ids.filter(
      (id) => findMarker(id) && !findMarker(id)!.parentId,
    );
    if (!mains.length) {
      selected.value = { kind: null, id: null };
      multi.value = [];
      cardOpen.value = false;
      return;
    }
    selected.value = { kind: "marker", id: mains[0] as string };
    multi.value = mains.slice(1);
    cardOpen.value = false;
  }

  function closeCardImpl(): void {
    // Commit any focused edit field before the card unmounts. A click outside
    // clears the selection during pointerdown, which removes the input before
    // its blur handler can run, so the typed value would be silently lost.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body)
      active.blur();
    selected.value = { kind: null, id: null };
    multi.value = [];
    cardOpen.value = false;
  }

  return {
    selected,
    multi,
    cardOpen,
    select: selectImpl,
    selectSingleMarker: selectSingleMarkerImpl,
    toggleMarkerSelect: toggleMarkerSelectImpl,
    selectAllMarkers: selectAllMarkersImpl,
    boxSelectMarkers: boxSelectMarkersImpl,
    closeCard: closeCardImpl,
  };
});

/** Main-marker ids currently selected: the active one plus the multi list. */
export function markerSelectionIds(): string[] {
  const sel = useSelectionStore();
  const out: string[] = [];
  const seen = new Set<string>();
  if (sel.selected.kind === "marker" && sel.selected.id) {
    out.push(sel.selected.id);
    seen.add(sel.selected.id);
  }
  for (const id of sel.multi) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Drop selection entries that no longer point at a live marker/bpm point. */
export function clearSelectionIfMissing(): void {
  const sel = useSelectionStore();
  if (sel.selected.kind === "marker" && !findMarker(sel.selected.id!))
    sel.selected = { kind: null, id: null };
  else if (sel.selected.kind === "bpm" && !findBpmPoint(sel.selected.id!))
    sel.selected = { kind: null, id: null };
  if (sel.multi.length) {
    sel.multi = sel.multi.filter(
      (id) => !!findMarker(id) && !findMarker(id)!.parentId,
    );
  }
}

// ---- public function API (routes through the actions above) ----

export function select(kind: "marker" | "bpm" | null, id: string | null): void {
  useSelectionStore().select(kind, id);
}

export function selectSingleMarker(id: string): void {
  useSelectionStore().selectSingleMarker(id);
}

export function toggleMarkerSelect(id: string): void {
  useSelectionStore().toggleMarkerSelect(id);
}

export function selectAllMarkers(): boolean {
  return useSelectionStore().selectAllMarkers();
}

export function boxSelectMarkers(ids: string[]): void {
  useSelectionStore().boxSelectMarkers(ids);
}

export function closeCard(): void {
  useSelectionStore().closeCard();
}
