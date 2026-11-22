import { getCurrentScope, onScopeDispose } from "vue";
import { useSettingsStore } from "../../stores/settings";
import { setScroll, screenToTime, useViewStore } from "../../stores/view";
import { useTransportStore } from "../../stores/transport";
import { seekTo } from "../../services/playback";
import { contentEndMs } from "../../services/timeline";
import { engine } from "../../engine";
import { MAX_PX_PER_SEC, MIN_PX_PER_SEC } from "../../metrics";
import { holdFollow } from "../../services/follow";
import { motionMs } from "../../services/motion";

const ANIM_MS = 100;
/** 每个滚轮刻度（deltaY≈100）推动播放头的毫秒数。 */
const WHEEL_SEEK_MS = 50;

/** Zoom / scroll wheel handling with an interruptible ease-out animation. */
export function useTimelineWheel() {
  const settings = useSettingsStore();
  const view = useViewStore();

  let wheelAnimRaf = 0;

  function cancelWheelAnim(): void {
    cancelAnimationFrame(wheelAnimRaf);
    wheelAnimRaf = 0;
  }

  // Stop the loop when the owning component unmounts; otherwise it would keep
  // writing to a disposed view store on the next frame.
  if (getCurrentScope()) onScopeDispose(cancelWheelAnim, true);

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
    holdFollow();
    const duration = motionMs(ANIM_MS);
    const anim = settings.settings.animEnabled && duration > 0;
    if (e.ctrlKey || e.metaKey) {
      // zoom anchored on the pointer so the time under the cursor stays put
      const root = e.currentTarget as HTMLElement | null;
      const rect = root?.getBoundingClientRect();
      const cx = rect
        ? Math.min(view.vw, Math.max(0, e.clientX - rect.left))
        : view.vw / 2;
      const from = view.pxPerSec;
      const zoomStep = settings.settings.wheelZoomStep;
      const target = Math.min(
        MAX_PX_PER_SEC,
        Math.max(
          MIN_PX_PER_SEC,
          view.pxPerSec * (e.deltaY < 0 ? zoomStep : 1 / zoomStep),
        ),
      );
      const tc = screenToTime(cx); // time currently at the viewport centre
      const applyZoom = (k: number): void => {
        const p = from + (target - from) * k;
        view.pxPerSec = p;
        setScroll(Math.max(0, (tc / 1000) * p - cx), view.y);
      };
      if (anim) animWheel(duration, applyZoom);
      else {
        view.pxPerSec = target;
        setScroll(Math.max(0, (tc / 1000) * target - cx), view.y);
      }
      return;
    }
    const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    const dy = e.deltaX !== 0 || e.shiftKey ? 0 : e.deltaY;
    // 普通滚轮（无 Shift、非横向）：像 FL Studio 一样推动播放头，
    // 改变当前轨道进度。Ctrl/⌘ 缩放、Shift/横向平移仍走下面的分支。
    if (dx === 0 && dy !== 0) {
      const t = useTransportStore();
      const limit = Math.max(engine.durationMs(), contentEndMs());
      const next = Math.min(
        limit,
        Math.max(0, t.positionMs + (dy / 100) * WHEEL_SEEK_MS),
      );
      seekTo(next);
      return;
    }
    if (anim) {
      const x0 = view.x;
      const y0 = view.y;
      const x1 = x0 + (dx || 0);
      const y1 = y0 + dy;
      animWheel(duration, (k) => {
        setScroll(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
      });
    } else {
      setScroll(view.x + (dx || 0), view.y + dy);
    }
  }

  return { onWheel };
}
