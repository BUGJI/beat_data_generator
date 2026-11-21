<script setup lang="ts">
import UiSlider from "../ui/UiSlider.vue";

/**
 * One stacked slider row in the appearance page. Keeps the label / description
 * / live value markup in one place so every slider behaves identically.
 */
withDefaults(
  defineProps<{
    label: string;
    desc?: string;
    modelValue: number;
    min: number;
    max: number;
    step?: number;
    suffix?: string;
    /** Optional `data-search` text so settings search can find this row. */
    search?: string;
  }>(),
  { step: 1, suffix: "", search: undefined, desc: undefined },
);

defineEmits<{
  "update:modelValue": [value: number];
  preview: [value: number];
  commit: [value: number];
}>();
</script>

<template>
  <div class="field-row col" :data-search="search">
    <div class="field-info">
      <span class="field-name">{{ label }}</span>
      <span v-if="desc" class="field-desc">{{ desc }}</span>
    </div>
    <div class="pct-row">
      <UiSlider
        :model-value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :label="label"
        class="pct-slider"
        @update:model-value="
          (value: number) => {
            $emit('update:modelValue', value);
            $emit('preview', value);
          }
        "
        @commit="(value: number) => $emit('commit', value)"
      />
      <span class="num pct-value">{{ modelValue }}{{ suffix }}</span>
    </div>
  </div>
</template>
