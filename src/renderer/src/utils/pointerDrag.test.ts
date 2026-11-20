import { describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { startPointerDrag } from "./pointerDrag";

function pointerMove(): void {
  window.dispatchEvent(new Event("pointermove"));
}

function pointerUp(): void {
  window.dispatchEvent(new Event("pointerup"));
}

describe("startPointerDrag", () => {
  it("forwards window pointermove events while active", () => {
    const onMove = vi.fn();
    startPointerDrag({ onMove });

    pointerMove();
    pointerMove();

    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it("stops listening after pointerup and fires onEnd once", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    startPointerDrag({ onMove, onEnd });

    pointerUp();
    pointerUp();
    pointerMove();

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("fires onCancel on pointercancel without onEnd", () => {
    const onEnd = vi.fn();
    const onCancel = vi.fn();
    startPointerDrag({ onMove: vi.fn(), onEnd, onCancel });

    window.dispatchEvent(new Event("pointercancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("disposer cancels the drag without firing onEnd", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const stop = startPointerDrag({ onMove, onEnd });

    stop();
    pointerMove();
    pointerUp();

    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("releases listeners when the owning effect scope is disposed", () => {
    const onMove = vi.fn();
    const scope = effectScope();
    scope.run(() => startPointerDrag({ onMove }));

    pointerMove();
    expect(onMove).toHaveBeenCalledTimes(1);

    scope.stop();
    pointerMove();
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
