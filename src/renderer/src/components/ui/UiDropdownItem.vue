<script setup lang="ts">
import { inject } from "vue";
import { DropdownMenuItem } from "reka-ui";
import { DROPDOWN_SELECT } from "./dropdown-context";

const props = withDefaults(
  defineProps<{ value?: string; disabled?: boolean }>(),
  { disabled: false },
);

const onSelect = inject(DROPDOWN_SELECT, null);

function handle(): void {
  if (props.disabled || props.value === undefined) return;
  onSelect?.(props.value);
}
</script>

<template>
  <DropdownMenuItem
    :disabled="disabled"
    class="flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12.5px] text-fg outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent/20 data-[highlighted]:text-accent"
    @select="handle"
  >
    <slot />
  </DropdownMenuItem>
</template>
