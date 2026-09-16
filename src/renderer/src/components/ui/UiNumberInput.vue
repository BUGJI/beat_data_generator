<script setup lang="ts">
import { ref, watch } from "vue";
import { ChevronDown, ChevronUp } from "@lucide/vue";

const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    step?: number;
    precision?: number;
    disabled?: boolean;
  }>(),
  { step: 1, disabled: false },
);

const model = defineModel<number>({ required: true });

function format(v: number): string {
  if (!Number.isFinite(v)) return "";
  return props.precision === undefined ? String(v) : v.toFixed(props.precision);
}

const text = ref(format(model.value));
watch(model, (v) => {
  text.value = format(v);
});

function clamp(v: number): number {
  let out = v;
  if (props.min !== undefined) out = Math.max(props.min, out);
  if (props.max !== undefined) out = Math.min(props.max, out);
  if (props.precision !== undefined) out = Number(out.toFixed(props.precision));
  return out;
}

function commit(raw: string): void {
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    text.value = format(model.value);
    return;
  }
  const next = clamp(v);
  model.value = next;
  text.value = format(next);
}

function stepBy(dir: 1 | -1): void {
  if (props.disabled) return;
  model.value = clamp(model.value + dir * (props.step ?? 1));
}
</script>

<template>
  <div
    class="inline-flex h-7 items-center overflow-hidden rounded-ui border border-line bg-sunken text-xs"
    :class="disabled && 'opacity-40'"
  >
    <input
      v-model="text"
      :disabled="disabled"
      class="num h-full w-full min-w-0 bg-transparent px-2 text-fg outline-none"
      @blur="commit(text)"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
    />
    <div class="flex h-full flex-col border-l border-line">
      <button
        type="button"
        :disabled="disabled"
        class="flex h-1/2 w-5 items-center justify-center text-fg-dim hover:bg-fg/10 hover:text-fg"
        @click="stepBy(1)"
      >
        <ChevronUp class="size-3" />
      </button>
      <button
        type="button"
        :disabled="disabled"
        class="flex h-1/2 w-5 items-center justify-center border-t border-line text-fg-dim hover:bg-fg/10 hover:text-fg"
        @click="stepBy(-1)"
      >
        <ChevronDown class="size-3" />
      </button>
    </div>
  </div>
</template>
