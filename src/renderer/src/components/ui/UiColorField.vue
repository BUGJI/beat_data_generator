<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Palette, Pipette } from "@lucide/vue";
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from "reka-ui";
import UiButton from "./UiButton.vue";

const { t } = useI18n();

withDefaults(defineProps<{ disabled?: boolean; title?: string }>(), {
  disabled: false,
});

const model = defineModel<string>({ required: true });
const emit = defineEmits<{ commit: [value: string] }>();

/** Quick colors shown in the palette popover. */
const PALETTE = [
  "#ffffff",
  "#e6ebf2",
  "#94a3b8",
  "#475569",
  "#1e293b",
  "#0e1116",
  "#38bdf8",
  "#2563eb",
  "#6366f1",
  "#a78bfa",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#fbbf24",
  "#f59e0b",
  "#34d399",
  "#22d3ee",
  "#64748b",
];

function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return `#${h.toLowerCase()}`;
}

const draft = ref(model.value);
const focused = ref(false);
const paletteOpen = ref(false);

watch(model, (v) => {
  if (!focused.value) draft.value = v;
});

function onHexInput(): void {
  const n = normalizeHex(draft.value);
  if (n) model.value = n; // live preview while typing a valid hex
}

function onHexCommit(): void {
  const n = normalizeHex(draft.value);
  if (n) {
    model.value = n;
    draft.value = n;
    emit("commit", n);
  } else {
    draft.value = model.value;
  }
}

function onSwatchInput(e: Event): void {
  model.value = (e.target as HTMLInputElement).value;
}

function onSwatchChange(e: Event): void {
  const v = (e.target as HTMLInputElement).value;
  model.value = v;
  emit("commit", v);
}

interface EyeDropperResult {
  sRGBHex: string;
}
type EyeDropperCtor = new () => { open(): Promise<EyeDropperResult> };

const eyedropperSupported =
  typeof window !== "undefined" && "EyeDropper" in window;

async function pickScreenColor(): Promise<void> {
  const ctor = (window as unknown as { EyeDropper?: EyeDropperCtor })
    .EyeDropper;
  if (!ctor) return;
  try {
    const res = await new ctor().open();
    const n = normalizeHex(res.sRGBHex) ?? res.sRGBHex;
    model.value = n;
    emit("commit", n);
  } catch {
    /* cancelled */
  }
}

function applyPreset(hex: string): void {
  paletteOpen.value = false;
  model.value = hex;
  emit("commit", hex);
}
</script>

<template>
  <div class="inline-flex items-center gap-1.5">
    <input
      type="color"
      :value="model"
      :disabled="disabled"
      :title="title"
      class="size-7 shrink-0 cursor-pointer appearance-none rounded-ui border border-line-strong bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none disabled:cursor-default disabled:opacity-40"
      @input="onSwatchInput"
      @change="onSwatchChange"
    />
    <input
      v-model="draft"
      :disabled="disabled"
      maxlength="7"
      spellcheck="false"
      class="num h-7 w-[88px] rounded-ui border border-line bg-sunken px-2 text-xs text-fg outline-none placeholder:text-fg-faint focus:border-line-strong disabled:opacity-40"
      @focus="focused = true"
      @blur="
        focused = false;
        onHexCommit();
      "
      @input="onHexInput"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
    />
    <UiButton
      v-if="eyedropperSupported"
      size="sm"
      :disabled="disabled"
      :title="t('color.pick')"
      @click="pickScreenColor"
    >
      <Pipette class="size-3.5" />
    </UiButton>
    <PopoverRoot v-model:open="paletteOpen">
      <PopoverTrigger as-child>
        <UiButton size="sm" :disabled="disabled" :title="t('color.palette')">
          <Palette class="size-3.5" />
        </UiButton>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          side="bottom"
          align="end"
          :side-offset="6"
          class="z-[200] rounded-ui border border-line-strong bg-menu p-2 shadow-2xl"
        >
          <div class="grid grid-cols-6 gap-1.5">
            <button
              v-for="c in PALETTE"
              :key="c"
              type="button"
              class="size-5 rounded-[4px] border border-line-strong"
              :style="{ background: c }"
              :title="c"
              @click="applyPreset(c)"
            />
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
