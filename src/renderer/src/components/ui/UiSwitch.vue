<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from "reka-ui";

const model = defineModel<boolean>({ required: true });
</script>

<template>
  <SwitchRoot
    v-model="model"
    class="relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full bg-fg/20 transition-colors data-[state=checked]:bg-accent"
  >
    <SwitchThumb
      class="block size-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]"
    />
  </SwitchRoot>
</template>
