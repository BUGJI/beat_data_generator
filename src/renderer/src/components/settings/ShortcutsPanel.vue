<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "../../stores/settings";
import { patchSettings } from "../../services/settingsPersistence";
import {
  bindingFor,
  comboParts,
  eventCombo,
  matchesBinding,
  SHORTCUT_DEFS,
  type ShortcutAction,
} from "../../utils/shortcuts";

const { t } = useI18n();
const settings = useSettingsStore();

const recording = ref<ShortcutAction | null>(null);
const conflict = ref<string | null>(null);

const rows = computed(() =>
  SHORTCUT_DEFS.map((def) => ({
    action: def.action,
    label: t(`settings.shortcuts.${def.labelKey}`),
    binding: bindingFor(def.action, settings.settings.shortcuts),
    custom: !!settings.settings.shortcuts[def.action],
  })),
);
const hasCustom = computed(
  () => Object.keys(settings.settings.shortcuts).length > 0,
);

function stopRecord(): void {
  recording.value = null;
  conflict.value = null;
  window.removeEventListener("keydown", onRecordKey, true);
}

function beginRecord(action: ShortcutAction): void {
  stopRecord();
  recording.value = action;
  window.addEventListener("keydown", onRecordKey, true);
}

function onRecordKey(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const action = recording.value;
  if (!action) return;
  if (e.key === "Escape") {
    stopRecord();
    return;
  }
  const combo = eventCombo(e);
  if (!combo) return;
  const other = SHORTCUT_DEFS.find(
    (def) =>
      def.action !== action &&
      matchesBinding(
        combo,
        bindingFor(def.action, settings.settings.shortcuts),
      ),
  );
  if (other) {
    conflict.value = t("settings.shortcuts.conflict", {
      label: t(`settings.shortcuts.${other.labelKey}`),
    });
    return;
  }
  void patchSettings({
    shortcuts: {
      ...settings.settings.shortcuts,
      [action]: combo,
    },
  });
  stopRecord();
}

function resetAction(action: ShortcutAction): void {
  const next = { ...settings.settings.shortcuts };
  delete next[action];
  void patchSettings({ shortcuts: next });
}

function resetAll(): void {
  void patchSettings({ shortcuts: {} });
}

onBeforeUnmount(stopRecord);
</script>

<template>
  <section>
    <div class="head-row">
      <h3>{{ t("settings.cats.shortcuts") }}</h3>
      <button v-if="hasCustom" class="reset-all" @click="resetAll">
        {{ t("settings.shortcuts.resetAll") }}
      </button>
    </div>
    <p class="muted">{{ t("settings.shortcuts.note") }}</p>
    <table class="keys-table">
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.action"
          :class="{ recording: recording === row.action }"
        >
          <td class="act">{{ row.label }}</td>
          <td class="keys">
            <span v-if="recording === row.action" class="recording">
              {{ t("settings.shortcuts.recording") }}
            </span>
            <template v-else-if="row.binding">
              <span
                v-for="(combo, ci) in comboParts(row.binding)"
                :key="ci"
                class="combo"
              >
                <span v-for="(k, ki) in combo" :key="ki" class="kbd">{{
                  k
                }}</span>
              </span>
            </template>
            <span v-else class="unbound">{{
              t("settings.shortcuts.unbound")
            }}</span>
          </td>
          <td class="ops">
            <button
              class="op"
              :class="{ on: recording === row.action }"
              @click="
                recording === row.action
                  ? stopRecord()
                  : beginRecord(row.action)
              "
            >
              {{ t("settings.shortcuts.rebind") }}
            </button>
            <button
              v-if="row.custom"
              class="op"
              @click="resetAction(row.action)"
            >
              {{ t("settings.shortcuts.reset") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="conflict" class="conflict">{{ conflict }}</div>
  </section>
</template>

<style scoped>
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.reset-all {
  border: 1px solid var(--bdg-border-strong);
  background: transparent;
  color: var(--bdg-text-dim);
  border-radius: var(--bdg-radius-sm);
  padding: 2px 8px;
  font-size: var(--bdg-fs-11);
  cursor: pointer;
}
.reset-all:hover {
  color: var(--bdg-text);
  background: rgb(var(--bdg-neutral) / 0.1);
}
.keys-table {
  width: 100%;
  border-collapse: collapse;
}
.keys-table td {
  padding: 6px 4px;
  border-bottom: 1px solid var(--bdg-border);
  font-size: var(--bdg-fs-13);
  vertical-align: middle;
}
.keys-table tr.recording {
  background: rgb(var(--bdg-accent-rgb) / 0.08);
}
.act {
  color: var(--bdg-text-dim);
}
.keys {
  text-align: right;
  white-space: nowrap;
}
.combo + .combo::before {
  content: " / ";
  color: var(--bdg-text-faint);
}
.kbd {
  display: inline-block;
  background: rgb(var(--bdg-neutral) / 0.12);
  border: 1px solid var(--bdg-border-strong);
  border-bottom-width: 2px;
  border-radius: var(--bdg-radius-md);
  padding: 1px 7px;
  margin-left: 4px;
  font-family: var(--bdg-font-mono);
  font-size: var(--bdg-fs-11);
}
.recording {
  color: var(--bdg-accent);
  font-size: var(--bdg-fs-11);
}
.unbound {
  color: var(--bdg-text-faint);
  font-size: var(--bdg-fs-11);
}
.ops {
  width: 1%;
  text-align: right;
  white-space: nowrap;
}
.op {
  border: none;
  background: transparent;
  color: var(--bdg-text-dim);
  border-radius: var(--bdg-radius-sm);
  padding: 2px 6px;
  font-size: var(--bdg-fs-11);
  cursor: pointer;
}
.op:hover,
.op.on {
  color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.12);
}
.conflict {
  margin-top: 8px;
  color: var(--bdg-danger);
  font-size: var(--bdg-fs-12);
}
</style>
