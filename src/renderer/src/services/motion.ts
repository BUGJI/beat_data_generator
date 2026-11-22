import { useSettingsStore } from "../stores/settings";
import type { MotionSpeed, ReduceMotion } from "@shared/settings";

/**
 * Global animation timing. The speed tier scales every duration (CSS variables
 * and JS timers); reduce-motion collapses them to zero and also sets the
 * `reduce-motion` class so utility transitions are disabled.
 */

/** Duration multipliers per tier (slow = longer, fast = shorter). */
export const MOTION_SPEED_SCALE: Record<MotionSpeed, number> = {
  slow: 1.5,
  normal: 1,
  fast: 0.7,
};

export function resolveReduceMotion(
  preference: ReduceMotion | string | undefined,
  osPrefersReduced: boolean,
): boolean {
  if (preference === "on") return true;
  if (preference === "off") return false;
  return osPrefersReduced;
}

export function resolveMotionScale(
  speed: MotionSpeed | string | undefined,
  reduced: boolean,
): number {
  if (reduced) return 0;
  return MOTION_SPEED_SCALE[speed as MotionSpeed] ?? 1;
}

// Creating a MediaQueryList is not free, and `motionMs` runs on hot paths
// (every follow frame, every wheel event, every playback effect). The list is
// live — `.matches` reflects later changes — so create it once and reuse it.
const reduceMotionQuery: MediaQueryList | null =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

function osPrefersReduced(): boolean {
  return reduceMotionQuery?.matches ?? false;
}

/** Whether animations are allowed under the current reduce-motion setting. */
export function reduceMotionActive(): boolean {
  const preference = useSettingsStore().settings.reduceMotion;
  // Skip the media query entirely when the user forced a mode; the old code
  // evaluated it eagerly on every call for `on`/`off` too.
  if (preference === "on") return true;
  if (preference === "off") return false;
  return osPrefersReduced();
}

/** Convenience predicate for code that only cares whether motion is allowed. */
export function animationsEnabled(): boolean {
  return !reduceMotionActive();
}

/** Scale one duration in milliseconds by the current speed / reduce setting. */
export function motionMs(baseMs: number): number {
  const scale = resolveMotionScale(
    useSettingsStore().settings.motionSpeed,
    reduceMotionActive(),
  );
  return Math.max(0, Math.round(baseMs * scale));
}

/** Push the current motion preferences into CSS custom properties. */
export function applyMotionPreferences(): void {
  if (typeof document === "undefined") return;
  const s = useSettingsStore().settings;
  const reduced = resolveReduceMotion(s.reduceMotion, osPrefersReduced());
  const scale = resolveMotionScale(s.motionSpeed, reduced);
  const root = document.documentElement;
  root.style.setProperty("--bdg-motion-scale", String(scale));
  root.style.setProperty(
    "--bdg-panel-motion-scale",
    String(s.uiMotion ? scale : 0),
  );
  root.style.setProperty(
    "--bdg-menu-motion-scale",
    String(s.menuMotion ? scale : 0),
  );
  root.style.setProperty(
    "--bdg-theme-motion-scale",
    String(s.themeCrossfade ? scale : 0),
  );
  root.classList.toggle("reduce-motion", reduced);
}

// Re-apply when the OS preference changes (unless the user forced a mode, the
// stored setting still decides).
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  if (reduceMotionQuery)
    reduceMotionQuery.addEventListener("change", () => {
      try {
        applyMotionPreferences();
      } catch {
        // The app is not ready yet (no active Pinia); the next settings apply
        // call will pick up the new OS preference.
      }
    });
}
