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
    class="flex items-center gap-2 rounded-[var(--bdg-radius-sm)] px-2 py-1.5 text-[length:var(--bdg-fs-12-5)] text-fg outline-none select-none data-[disabled]:opacity-[var(--bdg-disabled-opacity)] data-[highlighted]:bg-accent/20 data-[highlighted]:text-accent"
    @select="handle"
  >
    <slot />
  </DropdownMenuItem>
</template>
