import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useProjectStore } from "../stores/project";
import { useSelectionStore } from "../stores/selection";
import {
  beginEditTransaction,
  canRedo,
  canUndo,
  endEditTransaction,
  historyGestureBegin,
  historyGestureEnd,
  pushHistory,
  redo,
  resetHistory,
  undo,
} from "./history";

beforeEach(() => {
  setActivePinia(createPinia());
  resetHistory();
});

describe("history", () => {
  it("undoes and redoes a recorded change", () => {
    const p = useProjectStore();
    p.baseBpm = 120;
    pushHistory();
    p.baseBpm = 140;

    expect(canUndo()).toBe(true);
    undo();
    expect(p.baseBpm).toBe(120);
    expect(canRedo()).toBe(true);
    redo();
    expect(p.baseBpm).toBe(140);
  });

  it("clears the redo stack after a new edit", () => {
    const p = useProjectStore();
    p.baseBpm = 120;
    pushHistory();
    p.baseBpm = 130;
    undo();
    expect(canRedo()).toBe(true);

    p.baseBpm = 150;
    pushHistory();
    expect(canRedo()).toBe(false);
  });

  it("groups a gesture into a single undo step", () => {
    const p = useProjectStore();
    p.baseBpm = 120;
    historyGestureBegin();
    pushHistory(); // ignored while the gesture is open
    p.baseBpm = 130;
    p.baseBpm = 140;
    historyGestureEnd();

    undo();
    expect(p.baseBpm).toBe(120);
  });

  it("does not record a gesture that changed nothing", () => {
    useProjectStore().baseBpm = 120;
    historyGestureBegin();
    historyGestureEnd();
    expect(canUndo()).toBe(false);
  });

  it("clears the selection when a snapshot is applied", () => {
    const p = useProjectStore();
    const sel = useSelectionStore();
    p.baseBpm = 120;
    pushHistory();
    p.baseBpm = 130;

    sel.selected = { kind: "marker", id: "x" };
    sel.multi = ["y"];
    sel.cardOpen = true;

    undo();
    expect(sel.selected).toEqual({ kind: null, id: null });
    expect(sel.multi).toEqual([]);
    expect(sel.cardOpen).toBe(false);
  });

  it("restores the bpm-lock flag on undo and redo", () => {
    const p = useProjectStore();
    p.bpmLocked = false;
    pushHistory();
    p.bpmLocked = true;

    undo();
    expect(p.bpmLocked).toBe(false);
    redo();
    expect(p.bpmLocked).toBe(true);
  });

  it("commits a transaction that changed the document", () => {
    const p = useProjectStore();
    p.baseBpm = 120;
    beginEditTransaction();
    p.baseBpm = 135;
    endEditTransaction();

    expect(canUndo()).toBe(true);
    undo();
    expect(p.baseBpm).toBe(120);
  });

  it("does not record a transaction that changed nothing", () => {
    useProjectStore().baseBpm = 120;
    beginEditTransaction();
    endEditTransaction();
    expect(canUndo()).toBe(false);
  });

  it("caps the undo stack at 100 steps", () => {
    const p = useProjectStore();
    for (let i = 0; i < 150; i++) {
      p.baseBpm = 100 + i;
      pushHistory();
    }
    let steps = 0;
    while (canUndo() && steps < 500) {
      undo();
      steps++;
    }
    expect(steps).toBe(100);
  });
});
