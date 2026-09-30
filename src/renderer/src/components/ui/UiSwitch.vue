<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from "reka-ui";

withDefaults(
  defineProps<{
    /** Accessible name for the switch (required for screen readers). */
    label?: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const model = defineModel<boolean>({ required: true });
</script>

<template>
  <SwitchRoot
    v-model="model"
    :aria-label="label"
    :disabled="disabled"
    class="relative inline-flex h-[var(--bdg-ctl-2xs)] w-8 shrink-0 cursor-pointer items-center rounded-full bg-fg/20 transition-colors disabled:cursor-default disabled:opacity-[var(--bdg-disabled-opacity)] data-[state=checked]:bg-accent"
  >
    <SwitchThumb
      class="block size-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]"
    />
  </SwitchRoot>
</template>
