<script setup lang="ts">
withDefaults(
  defineProps<{
    placeholder?: string;
    disabled?: boolean;
    size?: "sm" | "md";
  }>(),
  { size: "md", disabled: false },
);

const model = defineModel<string>({ required: true });
</script>

<template>
  <input
    v-model="model"
    :placeholder="placeholder"
    :disabled="disabled"
    class="w-full rounded-ui border border-line bg-sunken px-2 text-fg outline-none placeholder:text-fg-faint focus:border-line-strong disabled:opacity-40"
    :class="size === 'sm' ? 'h-7 text-xs' : 'h-8 text-[13px]'"
  />
</template>
