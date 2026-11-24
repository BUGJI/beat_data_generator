<script setup lang="ts">
import { computed } from "vue";
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
    t("settings.display.appearance.bgPick"),
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
  { value: "cover", label: t("settings.display.appearance.fitCover") },
  { value: "contain", label: t("settings.display.appearance.fitContain") },
  { value: "tile", label: t("settings.display.appearance.fitTile") },
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
    :data-search="t('settings.display.appearance.bgImage')"
  >
    <div class="field-info">
      <span class="field-name">{{
        t("settings.display.appearance.bgImage")
      }}</span>
      <span class="field-desc">{{
        t("settings.display.appearance.bgImageDesc")
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
        {{ t("settings.display.appearance.bgPick") }}
      </UiButton>
      <UiButton
        v-if="settings.settings.backgroundImage"
        size="sm"
        variant="soft"
        @click="clearBackgroundImage()"
      >
        {{ t("settings.display.appearance.bgClear") }}
      </UiButton>
    </div>
  </div>

  <div
    v-if="backgroundImageUrl"
    class="bg-preview"
    role="img"
    :aria-label="t('settings.display.appearance.bgImage')"
  />

  <template v-if="settings.settings.backgroundImage">
    <div
      class="field-row col"
      :data-search="t('settings.display.appearance.bgFit')"
    >
      <div class="field-info">
        <span class="field-name">{{
          t("settings.display.appearance.bgFit")
        }}</span>
        <span class="field-desc">{{
          t("settings.display.appearance.bgFitDesc")
        }}</span>
      </div>
      <UiRadioGroup
        :model-value="backgroundFit"
        :options="backgroundFitOptions"
        :aria-label="t('settings.display.appearance.bgFit')"
        @update:model-value="(v: string) => (backgroundFit = v)"
      />
    </div>

    <AppearanceSliderRow
      :label="t('settings.display.appearance.bgBlur')"
      :desc="t('settings.display.appearance.bgBlurDesc')"
      :model-value="backgroundBlur"
      :min="0"
      :max="40"
      suffix="px"
      :search="t('settings.display.appearance.bgBlur')"
      @preview="(v: number) => previewSettings({ backgroundBlur: v })"
      @commit="(v: number) => patchSettings({ backgroundBlur: v })"
    />

    <AppearanceSliderRow
      :label="t('settings.display.appearance.bgDim')"
      :desc="t('settings.display.appearance.bgDimDesc')"
      :model-value="backgroundDim"
      :min="0"
      :max="100"
      suffix="%"
      :search="t('settings.display.appearance.bgDim')"
      @preview="(v: number) => previewSettings({ backgroundDim: v })"
      @commit="(v: number) => patchSettings({ backgroundDim: v })"
    />
  </template>

  <AppearanceSliderRow
    :label="t('settings.display.appearance.surfaceOpacity')"
    :desc="t('settings.display.appearance.surfaceOpacityDesc')"
    :model-value="surfaceOpacity"
    :min="20"
    :max="100"
    suffix="%"
    :search="t('settings.display.appearance.surfaceOpacity')"
    @preview="(v: number) => previewSettings({ surfaceOpacity: v })"
    @commit="(v: number) => patchSettings({ surfaceOpacity: v })"
  />

  <div class="field-row">
    <div class="field-info">
      <span class="field-name">{{
        t("settings.display.appearance.uiBlur")
      }}</span>
      <span class="field-desc">{{
        t("settings.display.appearance.uiBlurDesc")
      }}</span>
    </div>
    <UiSwitch
      :model-value="uiBlur"
      :aria-label="t('settings.display.appearance.uiBlur')"
      @update:model-value="(v: boolean) => (uiBlur = v)"
    />
  </div>

  <AppearanceSliderRow
    v-if="uiBlur && !simpleMode"
    :label="t('settings.display.appearance.uiBlurAmount')"
    :desc="t('settings.display.appearance.uiBlurAmountDesc')"
    :model-value="uiBlurAmount"
    :min="0"
    :max="24"
    suffix="px"
    :search="t('settings.display.appearance.uiBlurAmount')"
    @preview="(v: number) => previewSettings({ uiBlurAmount: v })"
    @commit="(v: number) => patchSettings({ uiBlurAmount: v })"
  />

  <AppearanceSliderRow
    :label="t('settings.display.appearance.uiRadius')"
    :desc="t('settings.display.appearance.uiRadiusDesc')"
    :model-value="uiRadius"
    :min="0"
    :max="20"
    suffix="px"
    :search="t('settings.display.appearance.uiRadius')"
    @preview="(v: number) => previewSettings({ uiRadius: v })"
    @commit="(v: number) => patchSettings({ uiRadius: v })"
  />

  <AppearanceSliderRow
    :label="t('settings.display.appearance.uiShadow')"
    :desc="t('settings.display.appearance.uiShadowDesc')"
    :model-value="uiShadow"
    :min="0"
    :max="100"
    suffix="%"
    :search="t('settings.display.appearance.uiShadow')"
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
