<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  PopoverAnchor,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
} from "reka-ui";
import { Check, ChevronDown } from "@lucide/vue";

export interface ComboboxOption {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    options: ComboboxOption[];
    placeholder?: string;
    /** allow committing free text that is not in `options`. */
    creatable?: boolean;
    disabled?: boolean;
    size?: "sm" | "md";
  }>(),
  { creatable: false, disabled: false, size: "md" },
);

const model = defineModel<string>({ required: true });

defineOptions({ inheritAttrs: false });

const open = ref(false);
const text = ref("");

function labelFor(value: string): string {
  return props.options.find((o) => o.value === value)?.label ?? value;
}

watch(
  model,
  (v) => {
    if (!open.value) text.value = labelFor(v);
  },
  { immediate: true },
);

const filtered = computed(() => {
  const q = text.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => o.label.toLowerCase().includes(q));
});

function choose(opt: ComboboxOption): void {
  model.value = opt.value;
  text.value = opt.label;
  open.value = false;
}

/** Commit typed text; a rejected (non-creatable/invalid) value reverts. */
function commit(): void {
  const raw = text.value.trim();
  if (raw) {
    const exact = props.options.find((o) => o.label === raw || o.value === raw);
    if (exact) {
      choose(exact);
      return;
    }
    if (props.creatable) model.value = raw;
  }
  text.value = labelFor(model.value);
  open.value = false;
}

function onEnter(): void {
  const raw = text.value.trim();
  const exact = props.options.find((o) => o.label === raw || o.value === raw);
  if (exact) {
    choose(exact);
    return;
  }
  const first = filtered.value[0];
  if (first && !raw) {
    choose(first);
    return;
  }
  commit();
}

function onEscape(): void {
  text.value = labelFor(model.value);
  open.value = false;
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverAnchor as-child>
      <div v-bind="$attrs" class="relative">
        <input
          v-model="text"
          :placeholder="placeholder"
          :disabled="disabled"
          class="w-full rounded-ui border border-line bg-sunken pr-7 pl-2 text-fg outline-none placeholder:text-fg-faint focus:border-line-strong disabled:opacity-40"
          :class="size === 'sm' ? 'h-7 text-xs' : 'h-8 text-[13px]'"
          @focus="open = true"
          @keydown.enter.prevent="onEnter"
          @keydown.esc.prevent="onEscape"
          @blur="commit"
        />
        <ChevronDown
          class="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-fg-dim"
        />
      </div>
    </PopoverAnchor>
    <PopoverPortal>
      <PopoverContent
        align="start"
        :side-offset="4"
        class="z-[150] max-h-64 min-w-[120px] overflow-y-auto rounded-ui border border-line-strong bg-menu p-1 shadow-2xl"
        @open-auto-focus.prevent
      >
        <button
          v-for="o in filtered"
          :key="o.value"
          type="button"
          class="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12.5px] text-fg hover:bg-accent/20 hover:text-accent"
          @mousedown.prevent="choose(o)"
        >
          <Check
            :class="[
              'size-3.5 shrink-0',
              o.value === model ? 'text-accent' : 'invisible',
            ]"
          />
          <span>{{ o.label }}</span>
        </button>
        <div
          v-if="!filtered.length"
          class="px-2 py-1.5 text-[12px] text-fg-faint"
        >
          {{ placeholder }}
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
