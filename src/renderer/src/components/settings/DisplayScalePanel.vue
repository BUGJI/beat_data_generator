<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "../../stores/settings";
import {
  patchSettings,
  previewSettings,
} from "../../services/settingsPersistence";
import AppearanceSliderRow from "./AppearanceSliderRow.vue";

const { t } = useI18n();
const settings = useSettingsStore();

// Page zoom reflows the whole UI (including this panel), so applying it on
// every tick would make the slider jump under the pointer. Hold the value
// locally while dragging and commit once on release.
const uiZoomDraft = ref(settings.settings.uiZoom);
watch(
  () => settings.settings.uiZoom,
  (v) => {
    uiZoomDraft.value = v;
  },
);
function commitUiZoom(v: number): void {
  if (v !== settings.settings.uiZoom) void patchSettings({ uiZoom: v });
}

const uiFontScale = computed({
  get: () => settings.settings.uiFontScale,
  set: (v: number) => void patchSettings({ uiFontScale: v }),
});

// Text scale drives every `--bdg-fs-*` token, so repainting on every
// pointermove reflows the whole UI. Coalesce previews to one per frame while
// keeping the slider live; the final value is committed on release.
let fontPreviewRaf = 0;
let pendingFontScale: number | null = null;
function previewFontScale(v: number): void {
  pendingFontScale = v;
  if (fontPreviewRaf) return;
  fontPreviewRaf = window.requestAnimationFrame(() => {
    fontPreviewRaf = 0;
    if (pendingFontScale === null) return;
    previewSettings({ uiFontScale: pendingFontScale });
    pendingFontScale = null;
  });
}
onBeforeUnmount(() => {
  if (fontPreviewRaf) window.cancelAnimationFrame(fontPreviewRaf);
  fontPreviewRaf = 0;
  pendingFontScale = null;
});
</script>

<template>
  <AppearanceSliderRow
    :label="t('settings.display.scale.uiZoom')"
    :desc="t('settings.display.scale.uiZoomDesc')"
    :model-value="uiZoomDraft"
    :min="75"
    :max="150"
    :step="5"
    suffix="%"
    :search="t('settings.display.scale.uiZoom')"
    @update:model-value="(v: number) => (uiZoomDraft = v)"
    @commit="commitUiZoom"
  />

  <AppearanceSliderRow
    :label="t('settings.display.scale.uiFontScale')"
    :desc="t('settings.display.scale.uiFontScaleDesc')"
    :model-value="uiFontScale"
    :min="85"
    :max="150"
    :step="5"
    suffix="%"
    :search="t('settings.display.scale.uiFontScale')"
    @preview="previewFontScale"
    @commit="(v: number) => patchSettings({ uiFontScale: v })"
  />
</template>
