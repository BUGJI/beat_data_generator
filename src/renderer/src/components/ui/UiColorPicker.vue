<script setup lang="ts">
withDefaults(
  defineProps<{ disabled?: boolean; title?: string }>(),
  { disabled: false },
);

const model = defineModel<string>({ required: true });

function onInput(e: Event): void {
  model.value = (e.target as HTMLInputElement).value;
}
</script>

<template>
  <input
    type="color"
    :value="model"
    :disabled="disabled"
    :title="title"
    class="size-5 shrink-0 cursor-pointer appearance-none rounded-full border-none bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none disabled:cursor-default disabled:opacity-40"
    @input="onInput"
  />
</template>
