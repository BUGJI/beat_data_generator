<script setup lang="ts">
import { setNumber, setRadio, setSwitch, type FieldControl } from "./types";
import UiNumberInput from "../ui/UiNumberInput.vue";
import UiRadioGroup from "../ui/UiRadioGroup.vue";
import UiSlider from "../ui/UiSlider.vue";
import UiSwitch from "../ui/UiSwitch.vue";

defineProps<{
  label: string;
  desc?: string;
  /** Translated unit label rendered next to a `number` control with `unitKey`. */
  unit?: string;
  col?: boolean;
  showIf?: () => boolean;
  control: FieldControl;
}>();
</script>

<template>
  <div v-if="!showIf || showIf()" class="field-row" :class="{ col: col }">
    <div class="field-info">
      <span class="field-name">{{ label }}</span>
      <span v-if="desc" class="field-desc">{{ desc }}</span>
    </div>

    <UiSwitch
      v-if="control.type === 'switch'"
      :model-value="control.get()"
      :disabled="control.disabled?.() ?? false"
      :aria-label="label"
      @update:model-value="(v: boolean) => setSwitch(control, v)"
    />
    <UiRadioGroup
      v-else-if="control.type === 'radio'"
      :model-value="control.get()"
      :options="control.options()"
      :aria-label="label"
      @update:model-value="(v: string) => setRadio(control, v)"
    />
    <UiNumberInput
      v-else-if="control.type === 'number' && !control.unitKey"
      :model-value="control.get()"
      :min="control.min?.()"
      :max="control.max?.()"
      :step="control.step"
      :label="label"
      class="decimals-input"
      @update:model-value="(v: number) => setNumber(control, v)"
    />
    <div v-else-if="control.type === 'number'" class="pct-row">
      <UiNumberInput
        :model-value="control.get()"
        :min="control.min?.()"
        :max="control.max?.()"
        :step="control.step"
        :label="label"
        @update:model-value="(v: number) => setNumber(control, v)"
      />
      <span class="muted">{{ unit }}</span>
    </div>
    <div v-else-if="control.type === 'slider'" class="pct-row">
      <UiSlider
        :model-value="control.get()"
        :min="control.min"
        :max="control.max"
        :step="control.step"
        :label="label"
        class="pct-slider"
        @update:model-value="(v: number) => setNumber(control, v)"
      />
      <span class="num pct-value">{{ control.get() }}{{ control.suffix }}</span>
    </div>
  </div>
</template>
