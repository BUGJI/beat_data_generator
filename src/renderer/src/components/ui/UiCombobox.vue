<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
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
    /** Accessible name for the inner combobox input. */
    label?: string;
  }>(),
  { creatable: false, disabled: false, size: "md" },
);

const model = defineModel<string>({ required: true });

defineOptions({ inheritAttrs: false });

const open = ref(false);
const text = ref("");
/** Highlighted option index for keyboard navigation (arrow keys). */
const active = ref(-1);
/** True only once the user has navigated with the arrow keys. */
const nav = ref(false);
const listId = `cb-${useId()}`;
const optionId = (i: number): string => `${listId}-opt-${i}`;

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

// Keep the highlight on a sane option as the query narrows.
watch(filtered, (list) => {
  const idx = list.findIndex((o) => o.value === model.value);
  active.value = idx >= 0 ? idx : list.length ? 0 : -1;
});

function moveActive(delta: number): void {
  if (!filtered.value.length) return;
  open.value = true;
  nav.value = true;
  const n = filtered.value.length;
  const cur = active.value < 0 ? (delta > 0 ? -1 : 0) : active.value;
  active.value = (cur + delta + n) % n;
}

function choose(opt: ComboboxOption): void {
  model.value = opt.value;
  text.value = opt.label;
  open.value = false;
  nav.value = false;
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
  if (nav.value && active.value >= 0) {
    const picked = filtered.value[active.value];
    if (picked) {
      choose(picked);
      return;
    }
  }
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
  nav.value = false;
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverAnchor as-child>
      <div v-bind="$attrs" class="relative">
        <input
          v-model="text"
          role="combobox"
          :aria-expanded="open"
          aria-autocomplete="list"
          :aria-controls="listId"
          :aria-activedescendant="
            nav && active >= 0 ? optionId(active) : undefined
          "
          :aria-label="label"
          :placeholder="placeholder"
          :disabled="disabled"
          class="w-full rounded-ui border border-line bg-sunken pr-7 pl-2 text-fg outline-none placeholder:text-fg-faint focus:border-line-strong disabled:opacity-[var(--bdg-disabled-opacity)]"
          :class="
            size === 'sm'
              ? 'h-[var(--bdg-ctl-md)] text-xs'
              : 'h-[var(--bdg-ctl-lg)] text-[length:calc(13px*var(--bdg-font-scale,1))]'
          "
          @input="nav = false"
          @focus="open = true"
          @keydown.enter.prevent="onEnter"
          @keydown.down.prevent="moveActive(1)"
          @keydown.up.prevent="moveActive(-1)"
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
        :id="listId"
        role="listbox"
        align="start"
        :side-offset="4"
        class="z-[150] max-h-64 min-w-[120px] overflow-y-auto rounded-ui border border-line-strong bg-menu p-1 shadow-2xl"
        @open-auto-focus.prevent
      >
        <button
          v-for="(o, i) in filtered"
          :id="optionId(i)"
          :key="o.value"
          type="button"
          role="option"
          :aria-selected="o.value === model"
          class="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[length:calc(12.5px*var(--bdg-font-scale,1))] text-fg hover:bg-accent/20 hover:text-accent"
          :class="nav && i === active ? 'bg-accent/20 text-accent' : ''"
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
          class="px-2 py-1.5 text-[length:calc(12px*var(--bdg-font-scale,1))] text-fg-faint"
        >
          {{ placeholder }}
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
