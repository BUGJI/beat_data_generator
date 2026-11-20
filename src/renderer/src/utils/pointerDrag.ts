import { getCurrentScope, onScopeDispose } from "vue";

export interface PointerDragHandlers {
  /** Called for every window-level pointermove while the drag is active. */
  onMove: (e: PointerEvent) => void;
  /** Called once when the pointer is released. */
  onEnd?: (e: PointerEvent) => void;
  /** Called when the drag is aborted (pointercancel, window blur, unmount). */
  onCancel?: () => void;
}

/**
 * Track a window-level pointer drag.
 *
 * Pointer capture is not used because many of the drags start on a child node
 * that is re-rendered while moving; listening on `window` keeps the drag alive.
 * The three terminal events (`pointerup`, `pointercancel`, `blur`) and effect
 * scope disposal all funnel through one idempotent teardown, so a component can
 * never leave listeners attached after it unmounts mid-drag.
 *
 * Returns an idempotent disposer. Calling it cancels the drag without firing
 * `onEnd`.
 */
export function startPointerDrag(handlers: PointerDragHandlers): () => void {
  let active = true;

  const stop = (): void => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onCancel);
  };

  const onMove = (e: PointerEvent): void => {
    if (!active) return;
    handlers.onMove(e);
  };
  const onUp = (e: PointerEvent): void => {
    if (!active) return;
    stop();
    handlers.onEnd?.(e);
  };
  const onCancel = (): void => {
    if (!active) return;
    stop();
    handlers.onCancel?.();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", onCancel);

  if (getCurrentScope()) onScopeDispose(stop, true);

  return stop;
}
