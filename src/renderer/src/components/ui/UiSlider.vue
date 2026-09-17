<script setup lang="ts">
import { computed } from "vue";
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "reka-ui";

withDefaults(defineProps<{ min?: number; max?: number; step?: number }>(), {
  min: 0,
  max: 100,
  step: 1,
});

const model = defineModel<number>({ required: true });

// reka-ui models the slider as an array (multi-thumb); adapt to a scalar.
const value = computed<number[]>({
  get: () => [model.value],
  set: (v) => {
    const n = v[0];
    if (typeof n === "number") model.value = n;
  },
});
</script>

<template>
  <SliderRoot
    v-model="value"
    :min="min"
    :max="max"
    :step="step"
    class="relative flex h-5 flex-1 cursor-pointer touch-none items-center select-none"
  >
    <SliderTrack class="relative h-1 grow rounded-full bg-fg/20">
      <SliderRange class="absolute h-full rounded-full bg-accent" />
    </SliderTrack>
    <SliderThumb
      class="block size-3.5 rounded-full bg-accent shadow outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    />
  </SliderRoot>
</template>
