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
    class="w-full rounded-ui border border-line bg-sunken px-2 text-fg outline-none placeholder:text-fg-faint focus:border-line-strong disabled:opacity-[var(--bdg-disabled-opacity)]"
    :class="
      size === 'sm'
        ? 'h-[var(--bdg-ctl-md)] text-xs'
        : 'h-[var(--bdg-ctl-lg)] text-[length:calc(13px*var(--bdg-font-scale,1))]'
    "
  />
</template>
