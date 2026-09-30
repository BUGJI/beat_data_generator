<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const shortcutRows = computed(() => [
  { label: t("settings.shortcuts.save"), keys: ["Ctrl", "S"] },
  { label: t("settings.shortcuts.copy"), keys: ["Ctrl", "C"] },
  { label: t("settings.shortcuts.paste"), keys: ["Ctrl", "V"] },
  { label: t("settings.shortcuts.undo"), keys: ["Ctrl", "Z"] },
  {
    label: t("settings.shortcuts.redo"),
    keys: ["Ctrl", "Y", "/", "Ctrl+Shift+Z"],
  },
  { label: t("settings.shortcuts.playPause"), keys: ["Space"] },
  { label: t("settings.shortcuts.deleteSel"), keys: ["Delete", "Backspace"] },
  { label: t("settings.shortcuts.nudge"), keys: ["←", "→"] },
  { label: t("settings.shortcuts.esc"), keys: ["Esc"] },
  { label: t("settings.shortcuts.home"), keys: ["Home"] },
  {
    label: t("settings.shortcuts.zoom"),
    keys: ["Ctrl", t("settings.shortcuts.wheel")],
  },
  {
    label: t("settings.shortcuts.pan"),
    keys: [t("settings.shortcuts.wheelShift")],
  },
]);
</script>

<template>
  <section>
    <h3>{{ t("settings.cats.shortcuts") }}</h3>
    <p class="muted">{{ t("settings.shortcuts.note") }}</p>
    <table class="keys-table">
      <tbody>
        <tr v-for="(row, i) in shortcutRows" :key="i">
          <td class="act">{{ row.label }}</td>
          <td class="keys">
            <span v-for="(k, j) in row.keys" :key="j" class="kbd">{{ k }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.keys-table {
  width: 100%;
  border-collapse: collapse;
}
.keys-table td {
  padding: 7px 4px;
  border-bottom: 1px solid var(--bdg-border);
  font-size: var(--bdg-fs-13);
}
.act {
  color: var(--bdg-text-dim);
}
.keys {
  text-align: right;
}
.kbd {
  display: inline-block;
  background: rgb(var(--bdg-neutral) / 0.12);
  border: 1px solid var(--bdg-border-strong);
  border-bottom-width: 2px;
  border-radius: var(--bdg-radius-md);
  padding: 1px 8px;
  margin-left: 6px;
  font-family: var(--bdg-font-mono);
  font-size: var(--bdg-fs-11);
}
</style>
