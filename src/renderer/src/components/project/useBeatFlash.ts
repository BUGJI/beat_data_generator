import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { hexToRgb, type resolveTheme } from "../../theme";
import { useUiStore } from "../../stores/ui";

/**
 * Beat/overlap indicator animation for the quick-action bar.
 *
 * Both lights fade in 0.1s when their source pulse changes and can be
 * re-triggered mid-fade. The RAF loops are owned by this composable and are
 * stopped with the component scope, so leaving the editor cannot leave a frame
 * loop writing to a disposed store.
 */

const FLASH_MS = 100;

type ThemeSpec = ReturnType<typeof resolveTheme>;

function flashStyle(
  k: number,
  color: string,
): { background: string; borderColor: string; boxShadow: string } {
  const c = hexToRgb(color);
  const rgb = `${c.r},${c.g},${c.b}`;
  return {
    background: `rgba(${rgb},${(0.08 + 0.92 * k).toFixed(3)})`,
    borderColor: `rgba(${rgb},${(0.35 + 0.65 * k).toFixed(3)})`,
    boxShadow: k > 0 ? `0 0 14px rgba(${rgb},${(0.9 * k).toFixed(3)})` : "none",
  };
}

function makeFlash(source: () => number) {
  const intensity = ref(0);
  let start = 0;
  let raf = 0;
  watch(source, () => {
    start = performance.now();
    cancelAnimationFrame(raf);
    const step = (): void => {
      const k = Math.max(0, 1 - (performance.now() - start) / FLASH_MS);
      intensity.value = k;
      if (k > 0) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  const stop = (): void => cancelAnimationFrame(raf);
  return { intensity, stop };
}

export function useBeatFlash(themeSpec: Ref<ThemeSpec>) {
  const ui = useUiStore();
  const beat = makeFlash(() => ui.beatPulse);
  const overlap = makeFlash(() => ui.overlapPulse);

  const overlapColor = computed(() => {
    const n = ui.overlapCount;
    const s = themeSpec.value;
    if (n >= 4) return s.danger;
    if (n === 3) return s.bpm;
    return s.amber;
  });

  const beatStyle = computed(() =>
    flashStyle(beat.intensity.value, themeSpec.value.accent),
  );
  const overlapStyle = computed(() =>
    flashStyle(overlap.intensity.value, overlapColor.value),
  );

  onScopeDispose(() => {
    beat.stop();
    overlap.stop();
  });

  return { beatStyle, overlapStyle };
}
