<script setup lang="ts">
import { LoaderCircle } from "@lucide/vue";

withDefaults(
  defineProps<{
    variant?: "ghost" | "soft" | "solid" | "danger";
    size?: "sm" | "md";
    disabled?: boolean;
    loading?: boolean;
  }>(),
  { variant: "ghost", size: "md", disabled: false, loading: false },
);
</script>

<template>
  <button
    type="button"
    :disabled="disabled || loading"
    class="inline-flex items-center justify-center gap-1.5 rounded-ui font-medium text-fg transition-colors disabled:cursor-default disabled:opacity-35"
    :class="[
      size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-[13px]',
      variant === 'solid' && 'bg-accent text-surface hover:brightness-110',
      variant === 'soft' && 'bg-accent/15 text-accent hover:bg-accent/25',
      variant === 'danger' && 'bg-danger/15 text-danger hover:bg-danger/25',
      variant === 'ghost' && 'hover:bg-fg/10',
    ]"
  >
    <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
    <slot />
  </button>
</template>
