<script setup lang="ts">
import { RadioGroupItem, RadioGroupRoot } from "reka-ui";

export interface RadioOption {
  value: string;
  label: string;
}

defineProps<{ options: RadioOption[]; disabled?: boolean }>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <RadioGroupRoot
    v-model="model"
    :disabled="disabled"
    class="inline-flex rounded-ui border border-line bg-sunken p-0.5"
  >
    <RadioGroupItem
      v-for="o in options"
      :key="o.value"
      :value="o.value"
      class="relative cursor-pointer rounded-[4px] px-2.5 py-1 text-xs text-fg-dim transition-colors outline-none select-none data-[state=checked]:bg-accent data-[state=checked]:text-surface"
    >
      <span class="relative z-10">{{ o.label }}</span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
