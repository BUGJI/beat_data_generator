import { computed, ref } from "vue";
import { patchSettings, useSettingsStore } from "../../stores/settings";

const DRAWER_MIN = 440;
/** Default drawer = 40% of the window; resizing is capped at 90%. */
const DRAWER_AUTO_RATIO = 0.4;
const DRAWER_MAX_RATIO = 0.9;

function maxDrawerWidth(): number {
  return window.innerWidth * DRAWER_MAX_RATIO;
}

function autoDrawerWidth(): number {
  return Math.max(
    DRAWER_MIN,
    Math.round(window.innerWidth * DRAWER_AUTO_RATIO),
  );
}

/**
 * Docked-drawer ↔ full-screen layout state, including the persisted width and
 * the pointer-drag resize. Local width avoids a full settings sanitize +
 * persist on every pointermove; it is committed once on release.
 */
export function useSettingsLayout() {
  const settings = useSettingsStore();

  const layout = computed<"drawer" | "full">({
    get: () => settings.settings.settingsLayout,
    set: (v) => void patchSettings({ settingsLayout: v }),
  });

  const dragging = ref(false);
  const dragWidth = ref(0);

  const panelStyle = computed<Record<string, string> | undefined>(() => {
    if (layout.value !== "drawer") return undefined;
    if (dragging.value) return { width: `${dragWidth.value}px` };
    const stored = settings.settings.settingsDrawerWidth;
    return { width: stored > 0 ? `${stored}px` : "40%" };
  });

  const transitionName = computed(() =>
    layout.value === "drawer" ? "settings-drawer" : "settings-full",
  );

  function toggleLayout(): void {
    layout.value = layout.value === "drawer" ? "full" : "drawer";
  }

  function startResize(e: PointerEvent): void {
    if (layout.value !== "drawer") return;
    e.preventDefault();
    const startX = e.clientX;
    const startW =
      (e.currentTarget as HTMLElement).parentElement?.offsetWidth ??
      autoDrawerWidth();
    dragging.value = true;
    dragWidth.value = startW;
    const move = (ev: PointerEvent): void => {
      const next = startW - (ev.clientX - startX);
      dragWidth.value = Math.max(DRAWER_MIN, Math.min(next, maxDrawerWidth()));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragging.value = false;
      void patchSettings({ settingsDrawerWidth: Math.round(dragWidth.value) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return { layout, panelStyle, transitionName, toggleLayout, startResize };
}
