<script setup lang="ts">
import { Check, ChevronDown } from "@lucide/vue";
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";

export interface SelectOption {
  value: string;
  label: string;
}

withDefaults(
  defineProps<{
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    size?: "sm" | "md";
  }>(),
  { size: "md", disabled: false },
);

const model = defineModel<string>({ required: true });
</script>

<template>
  <SelectRoot v-model="model" :disabled="disabled">
    <SelectTrigger
      class="inline-flex items-center justify-between gap-2 rounded-ui border border-line bg-sunken px-2 text-fg outline-none hover:border-line-strong disabled:opacity-40"
      :class="
        size === 'sm'
          ? 'h-7 min-w-[96px] text-xs'
          : 'h-8 min-w-[120px] text-[13px]'
      "
    >
      <SelectValue :placeholder="placeholder" />
      <SelectIcon><ChevronDown class="size-3.5 text-fg-dim" /></SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        class="z-[150] max-h-72 overflow-hidden rounded-ui border border-line-strong bg-menu shadow-2xl"
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="o in options"
            :key="o.value"
            :value="o.value"
            class="relative flex cursor-pointer items-center gap-2 rounded-[4px] py-1.5 pr-2 pl-6 text-[12.5px] text-fg outline-none select-none data-[highlighted]:bg-accent/20 data-[highlighted]:text-accent"
          >
            <SelectItemIndicator class="absolute left-1.5">
              <Check class="size-3.5" />
            </SelectItemIndicator>
            <SelectItemText>{{ o.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
