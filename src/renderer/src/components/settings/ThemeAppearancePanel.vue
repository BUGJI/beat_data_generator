<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "../../stores/settings";
import { backgroundImageUrl } from "../../services/settingsEffects";
import {
  patchSettings,
  previewSettings,
} from "../../services/settingsPersistence";
import type { BackgroundFit } from "@shared/settings";
import { useSettingsRowsStore } from "./useSettingsRows";
import AppearanceSliderRow from "./AppearanceSliderRow.vue";
import UiButton from "../ui/UiButton.vue";
import UiRadioGroup from "../ui/UiRadioGroup.vue";
import UiSwitch from "../ui/UiSwitch.vue";

const { t } = useI18n();
const settings = useSettingsStore();
const { simpleMode } = storeToRefs(useSettingsRowsStore());

const backgroundImage = computed({
  get: () => settings.settings.backgroundImage,
  set: (v: string) => void patchSettings({ backgroundImage: v }),
});
const backgroundName = computed(() => {
  const p = settings.settings.backgroundImage;
  if (!p) return "";
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
});
const BG_IMAGE_FILTERS = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
];
async function pickBackgroundImage(): Promise<void> {
  const path = await window.api.pickFile(
    t("settings.theme.appearance.bgPick"),
    BG_IMAGE_FILTERS,
  );
  if (path) backgroundImage.value = path;
}
function clearBackgroundImage(): void {
  backgroundImage.value = "";
}
const backgroundFit = computed<string>({
  get: () => settings.settings.backgroundFit,
  set: (v: string) => void patchSettings({ backgroundFit: v as BackgroundFit }),
});
const backgroundFitOptions = computed(() => [
  { value: "cover", label: t("settings.theme.appearance.fitCover") },
  { value: "contain", label: t("settings.theme.appearance.fitContain") },
  { value: "tile", label: t("settings.theme.appearance.fitTile") },
]);
const backgroundBlur = computed({
  get: () => settings.settings.backgroundBlur,
  set: (v: number) => void patchSettings({ backgroundBlur: v }),
});
const backgroundDim = computed({
  get: () => settings.settings.backgroundDim,
  set: (v: number) => void patchSettings({ backgroundDim: v }),
});
const surfaceOpacity = computed({
  get: () => settings.settings.surfaceOpacity,
  set: (v: number) => void patchSettings({ surfaceOpacity: v }),
});

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
const uiBlur = computed({
  get: () => settings.settings.uiBlur,
  set: (v: boolean) => void patchSettings({ uiBlur: v }),
});
const uiBlurAmount = computed({
  get: () => settings.settings.uiBlurAmount,
  set: (v: number) => void patchSettings({ uiBlurAmount: v }),
});
const uiRadius = computed({
  get: () => settings.settings.uiRadius,
  set: (v: number) => void patchSettings({ uiRadius: v }),
});
const uiShadow = computed({
  get: () => settings.settings.uiShadow,
  set: (v: number) => void patchSettings({ uiShadow: v }),
});
</script>

<template>
  <div
    class="field-row col"
    :data-search="t('settings.theme.appearance.bgImage')"
  >
    <div class="field-info">
      <span class="field-name">{{
        t("settings.theme.appearance.bgImage")
      }}</span>
      <span class="field-desc">{{
        t("settings.theme.appearance.bgImageDesc")
      }}</span>
    </div>
    <div class="bg-pick">
      <span
        v-if="backgroundName"
        class="muted bg-name"
        :title="settings.settings.backgroundImage"
        >{{ backgroundName }}</span
      >
      <UiButton size="sm" @click="pickBackgroundImage()">
        {{ t("settings.theme.appearance.bgPick") }}
      </UiButton>
      <UiButton
        v-if="settings.settings.backgroundImage"
        size="sm"
        variant="soft"
        @click="clearBackgroundImage()"
      >
        {{ t("settings.theme.appearance.bgClear") }}
      </UiButton>
    </div>
  </div>

  <div
    v-if="backgroundImageUrl"
    class="bg-preview"
    role="img"
    :aria-label="t('settings.theme.appearance.bgImage')"
  />

  <template v-if="settings.settings.backgroundImage">
    <div
      class="field-row col"
      :data-search="t('settings.theme.appearance.bgFit')"
    >
      <div class="field-info">
        <span class="field-name">{{
          t("settings.theme.appearance.bgFit")
        }}</span>
        <span class="field-desc">{{
          t("settings.theme.appearance.bgFitDesc")
        }}</span>
      </div>
      <UiRadioGroup
        :model-value="backgroundFit"
        :options="backgroundFitOptions"
        :aria-label="t('settings.theme.appearance.bgFit')"
        @update:model-value="(v: string) => (backgroundFit = v)"
      />
    </div>

    <AppearanceSliderRow
      :label="t('settings.theme.appearance.bgBlur')"
      :desc="t('settings.theme.appearance.bgBlurDesc')"
      :model-value="backgroundBlur"
      :min="0"
      :max="40"
      suffix="px"
      :search="t('settings.theme.appearance.bgBlur')"
      @preview="(v: number) => previewSettings({ backgroundBlur: v })"
      @commit="(v: number) => patchSettings({ backgroundBlur: v })"
    />

    <AppearanceSliderRow
      :label="t('settings.theme.appearance.bgDim')"
      :desc="t('settings.theme.appearance.bgDimDesc')"
      :model-value="backgroundDim"
      :min="0"
      :max="100"
      suffix="%"
      :search="t('settings.theme.appearance.bgDim')"
      @preview="(v: number) => previewSettings({ backgroundDim: v })"
      @commit="(v: number) => patchSettings({ backgroundDim: v })"
    />
  </template>

  <AppearanceSliderRow
    :label="t('settings.theme.appearance.surfaceOpacity')"
    :desc="t('settings.theme.appearance.surfaceOpacityDesc')"
    :model-value="surfaceOpacity"
    :min="20"
    :max="100"
    suffix="%"
    :search="t('settings.theme.appearance.surfaceOpacity')"
    @preview="(v: number) => previewSettings({ surfaceOpacity: v })"
    @commit="(v: number) => patchSettings({ surfaceOpacity: v })"
  />

  <AppearanceSliderRow
    :label="t('settings.theme.appearance.uiZoom')"
    :desc="t('settings.theme.appearance.uiZoomDesc')"
    :model-value="uiZoomDraft"
    :min="75"
    :max="150"
    :step="5"
    suffix="%"
    :search="t('settings.theme.appearance.uiZoom')"
    @update:model-value="(v: number) => (uiZoomDraft = v)"
    @commit="commitUiZoom"
  />

  <AppearanceSliderRow
    :label="t('settings.theme.appearance.uiFontScale')"
    :desc="t('settings.theme.appearance.uiFontScaleDesc')"
    :model-value="uiFontScale"
    :min="85"
    :max="150"
    :step="5"
    suffix="%"
    :search="t('settings.theme.appearance.uiFontScale')"
    @preview="previewFontScale"
    @commit="(v: number) => patchSettings({ uiFontScale: v })"
  />

  <div class="field-row">
    <div class="field-info">
      <span class="field-name">{{
        t("settings.theme.appearance.uiBlur")
      }}</span>
      <span class="field-desc">{{
        t("settings.theme.appearance.uiBlurDesc")
      }}</span>
    </div>
    <UiSwitch
      :model-value="uiBlur"
      :aria-label="t('settings.theme.appearance.uiBlur')"
      @update:model-value="(v: boolean) => (uiBlur = v)"
    />
  </div>

  <AppearanceSliderRow
    v-if="uiBlur && !simpleMode"
    :label="t('settings.theme.appearance.uiBlurAmount')"
    :desc="t('settings.theme.appearance.uiBlurAmountDesc')"
    :model-value="uiBlurAmount"
    :min="0"
    :max="24"
    suffix="px"
    :search="t('settings.theme.appearance.uiBlurAmount')"
    @preview="(v: number) => previewSettings({ uiBlurAmount: v })"
    @commit="(v: number) => patchSettings({ uiBlurAmount: v })"
  />

  <AppearanceSliderRow
    :label="t('settings.theme.appearance.uiRadius')"
    :desc="t('settings.theme.appearance.uiRadiusDesc')"
    :model-value="uiRadius"
    :min="0"
    :max="20"
    suffix="px"
    :search="t('settings.theme.appearance.uiRadius')"
    @preview="(v: number) => previewSettings({ uiRadius: v })"
    @commit="(v: number) => patchSettings({ uiRadius: v })"
  />

  <AppearanceSliderRow
    :label="t('settings.theme.appearance.uiShadow')"
    :desc="t('settings.theme.appearance.uiShadowDesc')"
    :model-value="uiShadow"
    :min="0"
    :max="100"
    suffix="%"
    :search="t('settings.theme.appearance.uiShadow')"
    @preview="(v: number) => previewSettings({ uiShadow: v })"
    @commit="(v: number) => patchSettings({ uiShadow: v })"
  />
</template>

<style scoped>
.bg-pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* Keep the buttons at their natural size; only the file name may shrink. */
.bg-pick button {
  flex: none;
}
.bg-pick .bg-name {
  flex: 1 1 120px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--bdg-fs-12);
}
/* Mirrors the real `.app-bg` layer so the thumbnail follows the fill mode
   (and any future background treatment) without duplicating logic. */
.bg-preview {
  height: 160px;
  margin: -4px 0 12px;
  border-radius: var(--bdg-radius, 6px);
  border: 1px solid var(--bdg-border);
  background-color: var(--bdg-bg);
  background-image: var(--bdg-bg-image, none);
  background-position: center;
  background-size: var(--bdg-bg-size, cover);
  background-repeat: var(--bdg-bg-repeat, no-repeat);
}
</style>
