<script setup lang="ts">
import { provide } from "vue";
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";
import { DROPDOWN_SELECT } from "./dropdown-context";

const emit = defineEmits<{
  select: [value: string];
}>();

/** Optional two-way open state for programmatic triggers (e.g. context menu). */
const open = defineModel<boolean>("open", { default: false });

provide(DROPDOWN_SELECT, (v: string) => emit("select", v));
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="start"
        :side-offset="6"
        class="z-[var(--bdg-z-popover)] min-w-[190px] rounded-ui border border-line-strong bg-menu p-1 shadow-2xl"
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
