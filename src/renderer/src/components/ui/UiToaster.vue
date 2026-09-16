<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "@lucide/vue";
import { dismissToast, toasts, type ToastType } from "../../ui/toast";

const ICONS = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
  warning: TriangleAlert,
} as const;

const COLOR: Record<ToastType, string> = {
  success: "text-accent-2",
  error: "text-danger",
  info: "text-accent",
  warning: "text-amber",
};
</script>

<template>
  <div
    class="pointer-events-none fixed top-3 left-1/2 z-[300] flex -translate-x-1/2 flex-col items-center gap-2"
  >
    <TransitionGroup name="toast">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="pointer-events-auto flex items-center gap-2 rounded-ui border border-line-strong bg-menu px-3 py-2 text-[12.5px] text-fg shadow-2xl"
      >
        <component
          :is="ICONS[item.type]"
          class="size-3.5"
          :class="COLOR[item.type]"
        />
        <span>{{ item.message }}</span>
        <button
          class="ml-1 text-fg-dim hover:text-fg"
          @click="dismissToast(item.id)"
        >
          <X class="size-3" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
