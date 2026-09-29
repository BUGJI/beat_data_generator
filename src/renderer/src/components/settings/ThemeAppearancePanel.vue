<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import {
  backgroundImageUrl,
  patchSettings,
  useSettingsStore,
} from "../../stores/settings";
import type { BackgroundFit } from "../../../../shared/settings";
import { useSettingsRowsStore } from "./useSettingsRows";
import UiButton from "../ui/UiButton.vue";
import UiRadioGroup from "../ui/UiRadioGroup.vue";
import UiSlider from "../ui/UiSlider.vue";
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
  <div class="field-row">
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
    <div class="field-row col">
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

    <div class="field-row col">
      <div class="field-info">
        <span class="field-name">{{
          t("settings.theme.appearance.bgBlur")
        }}</span>
        <span class="field-desc">{{
          t("settings.theme.appearance.bgBlurDesc")
        }}</span>
      </div>
      <div class="pct-row">
        <UiSlider
          :model-value="backgroundBlur"
          :min="0"
          :max="40"
          :label="t('settings.theme.appearance.bgBlur')"
          class="pct-slider"
          @update:model-value="(v: number) => (backgroundBlur = v)"
        />
        <span class="num pct-value">{{ backgroundBlur }}px</span>
      </div>
    </div>

    <div class="field-row col">
      <div class="field-info">
        <span class="field-name">{{
          t("settings.theme.appearance.bgDim")
        }}</span>
        <span class="field-desc">{{
          t("settings.theme.appearance.bgDimDesc")
        }}</span>
      </div>
      <div class="pct-row">
        <UiSlider
          :model-value="backgroundDim"
          :min="0"
          :max="100"
          :label="t('settings.theme.appearance.bgDim')"
          class="pct-slider"
          @update:model-value="(v: number) => (backgroundDim = v)"
        />
        <span class="num pct-value">{{ backgroundDim }}%</span>
      </div>
    </div>
  </template>

  <div class="field-row col">
    <div class="field-info">
      <span class="field-name">{{
        t("settings.theme.appearance.surfaceOpacity")
      }}</span>
      <span class="field-desc">{{
        t("settings.theme.appearance.surfaceOpacityDesc")
      }}</span>
    </div>
    <div class="pct-row">
      <UiSlider
        :model-value="surfaceOpacity"
        :min="20"
        :max="100"
        :label="t('settings.theme.appearance.surfaceOpacity')"
        class="pct-slider"
        @update:model-value="(v: number) => (surfaceOpacity = v)"
      />
      <span class="num pct-value">{{ surfaceOpacity }}%</span>
    </div>
  </div>

  <div class="field-row col">
    <div class="field-info">
      <span class="field-name">{{
        t("settings.theme.appearance.uiZoom")
      }}</span>
      <span class="field-desc">{{
        t("settings.theme.appearance.uiZoomDesc")
      }}</span>
    </div>
    <div class="pct-row">
      <UiSlider
        :model-value="uiZoomDraft"
        :min="75"
        :max="150"
        :step="5"
        :label="t('settings.theme.appearance.uiZoom')"
        class="pct-slider"
        @update:model-value="(v: number) => (uiZoomDraft = v)"
        @commit="commitUiZoom"
      />
      <span class="num pct-value">{{ uiZoomDraft }}%</span>
    </div>
  </div>

  <div class="field-row col">
    <div class="field-info">
      <span class="field-name">{{
        t("settings.theme.appearance.uiFontScale")
      }}</span>
      <span class="field-desc">{{
        t("settings.theme.appearance.uiFontScaleDesc")
      }}</span>
    </div>
    <div class="pct-row">
      <UiSlider
        :model-value="uiFontScale"
        :min="85"
        :max="150"
        :step="5"
        :label="t('settings.theme.appearance.uiFontScale')"
        class="pct-slider"
        @update:model-value="(v: number) => (uiFontScale = v)"
      />
      <span class="num pct-value">{{ uiFontScale }}%</span>
    </div>
  </div>

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

  <div v-if="uiBlur && !simpleMode" class="field-row col">
    <div class="field-info">
      <span class="field-name">{{
        t("settings.theme.appearance.uiBlurAmount")
      }}</span>
      <span class="field-desc">{{
        t("settings.theme.appearance.uiBlurAmountDesc")
      }}</span>
    </div>
    <div class="pct-row">
      <UiSlider
        :model-value="uiBlurAmount"
        :min="0"
        :max="24"
        :label="t('settings.theme.appearance.uiBlurAmount')"
        class="pct-slider"
        @update:model-value="(v: number) => (uiBlurAmount = v)"
      />
      <span class="num pct-value">{{ uiBlurAmount }}px</span>
    </div>
  </div>

  <div class="field-row col">
    <div class="field-info">
      <span class="field-name">{{
        t("settings.theme.appearance.uiRadius")
      }}</span>
      <span class="field-desc">{{
        t("settings.theme.appearance.uiRadiusDesc")
      }}</span>
    </div>
    <div class="pct-row">
      <UiSlider
        :model-value="uiRadius"
        :min="0"
        :max="20"
        :label="t('settings.theme.appearance.uiRadius')"
        class="pct-slider"
        @update:model-value="(v: number) => (uiRadius = v)"
      />
      <span class="num pct-value">{{ uiRadius }}px</span>
    </div>
  </div>

  <div class="field-row col">
    <div class="field-info">
      <span class="field-name">{{
        t("settings.theme.appearance.uiShadow")
      }}</span>
      <span class="field-desc">{{
        t("settings.theme.appearance.uiShadowDesc")
      }}</span>
    </div>
    <div class="pct-row">
      <UiSlider
        :model-value="uiShadow"
        :min="0"
        :max="100"
        :label="t('settings.theme.appearance.uiShadow')"
        class="pct-slider"
        @update:model-value="(v: number) => (uiShadow = v)"
      />
      <span class="num pct-value">{{ uiShadow }}%</span>
    </div>
  </div>
</template>

<style scoped>
.bg-pick {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.bg-pick .bg-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(12px * var(--bdg-font-scale, 1));
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
