import { useSettingsStore } from "../../stores/settings";
import { setScroll, screenToTime, useViewStore } from "../../stores/view";
import { MAX_PX_PER_SEC, MIN_PX_PER_SEC } from "../../metrics";

const ANIM_MS = 100;

/** Zoom / scroll wheel handling with an interruptible ease-out animation. */
export function useTimelineWheel() {
  const settings = useSettingsStore();
  const view = useViewStore();

  let wheelAnimRaf = 0;

  function cancelWheelAnim(): void {
    cancelAnimationFrame(wheelAnimRaf);
    wheelAnimRaf = 0;
  }

  /** interruptible ease-out animator over `durMs`; apply receives 0→1 eased progress */
  function animWheel(durMs: number, apply: (k: number) => void): void {
    cancelWheelAnim();
    const t0 = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / durMs);
      apply(1 - (1 - k) ** 3);
      if (k < 1) wheelAnimRaf = requestAnimationFrame(step);
      else wheelAnimRaf = 0;
    };
    wheelAnimRaf = requestAnimationFrame(step);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const anim = settings.settings.animEnabled;
    if (e.ctrlKey || e.metaKey) {
      // zoom anchored on the currently visible centre of the timeline
      const cx = view.vw / 2;
      const from = view.pxPerSec;
      const target = Math.min(
        MAX_PX_PER_SEC,
        Math.max(
          MIN_PX_PER_SEC,
          view.pxPerSec * (e.deltaY < 0 ? 1.25 : 1 / 1.25),
        ),
      );
      const tc = screenToTime(cx); // time currently at the viewport centre
      const applyZoom = (k: number): void => {
        const p = from + (target - from) * k;
        view.pxPerSec = p;
        setScroll(Math.max(0, (tc / 1000) * p - cx), view.y);
      };
      if (anim) animWheel(ANIM_MS, applyZoom);
      else {
        view.pxPerSec = target;
        setScroll(Math.max(0, (tc / 1000) * target - cx), view.y);
      }
      return;
    }
    const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    const dy = e.deltaX !== 0 || e.shiftKey ? 0 : e.deltaY;
    if (anim) {
      const x0 = view.x;
      const y0 = view.y;
      const x1 = x0 + (dx || 0);
      const y1 = y0 + dy;
      animWheel(ANIM_MS, (k) => {
        setScroll(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
      });
    } else {
      setScroll(view.x + (dx || 0), view.y + dy);
    }
  }

  return { onWheel };
}
