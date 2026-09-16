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
  "update:open": [open: boolean];
}>();
provide(DROPDOWN_SELECT, (v: string) => emit("select", v));
</script>

<template>
  <DropdownMenuRoot @update:open="emit('update:open', $event)">
    <DropdownMenuTrigger as-child><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="start"
        :side-offset="6"
        class="z-[150] min-w-[190px] rounded-ui border border-line-strong bg-menu p-1 shadow-2xl"
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
