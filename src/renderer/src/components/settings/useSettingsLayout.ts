import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useSettingsStore } from "../../stores/settings";
import { patchSettings } from "../../services/settingsPersistence";

const DRAWER_MIN = 440;
/** Default drawer = 40% of the window; resizing is capped at 90%. */
const DRAWER_AUTO_RATIO = 0.4;
const DRAWER_MAX_RATIO = 0.9;

function maxDrawerWidth(viewport: number): number {
  return viewport * DRAWER_MAX_RATIO;
}

function autoDrawerWidth(viewport: number): number {
  return Math.max(DRAWER_MIN, Math.round(viewport * DRAWER_AUTO_RATIO));
}

/**
 * Docked-drawer ↔ full-screen layout state, including the persisted width and
 * the pointer-drag resize. Local width avoids a full settings sanitize +
 * persist on every pointermove; it is committed once on release.
 */
export function useSettingsLayout() {
  const settings = useSettingsStore();

  // Track the viewport so a width persisted on a wide monitor still fits after
  // the window is made smaller.
  const viewportWidth = ref(
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  function syncViewport(): void {
    viewportWidth.value = window.innerWidth;
  }
  onMounted(() => {
    syncViewport();
    window.addEventListener("resize", syncViewport);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("resize", syncViewport);
  });

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
    if (stored <= 0) return { width: "40%" };
    const capped = Math.max(
      DRAWER_MIN,
      Math.min(stored, maxDrawerWidth(viewportWidth.value)),
    );
    return { width: `${Math.round(capped)}px` };
  });

  const transitionName = computed(() =>
    layout.value === "drawer" ? "settings-drawer" : "settings-full",
  );

  function toggleLayout(): void {
    layout.value = layout.value === "drawer" ? "full" : "drawer";
  }

  function startResize(e: PointerEvent): void {
    if (layout.value !== "drawer" || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement | null;
    handle?.setPointerCapture?.(e.pointerId);
    const startX = e.clientX;
    const startW =
      handle?.parentElement?.offsetWidth ??
      autoDrawerWidth(viewportWidth.value);
    dragging.value = true;
    dragWidth.value = startW;
    const move = (ev: PointerEvent): void => {
      const next = startW - (ev.clientX - startX);
      dragWidth.value = Math.max(
        DRAWER_MIN,
        Math.min(next, maxDrawerWidth(viewportWidth.value)),
      );
    };
    const end = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (handle?.hasPointerCapture?.(e.pointerId))
        handle.releasePointerCapture(e.pointerId);
      dragging.value = false;
      void patchSettings({ settingsDrawerWidth: Math.round(dragWidth.value) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  return { layout, panelStyle, transitionName, toggleLayout, startResize };
}
