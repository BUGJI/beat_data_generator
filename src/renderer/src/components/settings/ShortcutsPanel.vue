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
  SHORTCUT_GROUP,
  SHORTCUT_GROUP_ORDER,
  type ShortcutAction,
} from "../../utils/shortcuts";
import SettingsPage from "./SettingsPage.vue";
import UiInput from "../ui/UiInput.vue";

const { t } = useI18n();
const settings = useSettingsStore();

const recording = ref<ShortcutAction | null>(null);
const conflict = ref<string | null>(null);
const filter = ref("");

const rows = computed(() =>
  SHORTCUT_DEFS.map((def) => ({
    action: def.action,
    group: SHORTCUT_GROUP[def.action],
    label: t(`settings.shortcuts.${def.labelKey}`),
    binding: bindingFor(def.action, settings.settings.shortcuts),
    custom: !!settings.settings.shortcuts[def.action],
  })),
);

const filteredRows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((row) =>
    [row.label, row.binding].join(" ").toLowerCase().includes(q),
  );
});

const groups = computed(() =>
  SHORTCUT_GROUP_ORDER.map((key) => ({
    key,
    label: t(`settings.shortcuts.groups.${key}`),
    rows: filteredRows.value.filter((row) => row.group === key),
  })).filter((group) => group.rows.length > 0),
);

const filterActive = computed(() => filter.value.trim().length > 0);
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
  <SettingsPage :title="t('settings.cats.shortcuts')">
    <template #actions>
      <button v-if="hasCustom" class="reset-all" @click="resetAll">
        {{ t("settings.shortcuts.resetAll") }}
      </button>
    </template>

    <p class="muted shortcut-note">{{ t("settings.shortcuts.note") }}</p>

    <div class="shortcut-toolbar">
      <UiInput
        v-model="filter"
        size="sm"
        class="shortcut-filter"
        :placeholder="t('settings.shortcuts.filter')"
      />
      <span v-if="filterActive" class="muted shortcut-count">
        {{
          t("settings.shortcuts.filterCount", {
            count: filteredRows.length,
            total: rows.length,
          })
        }}
      </span>
    </div>

    <div v-if="groups.length === 0" class="shortcut-empty muted">
      {{ t("settings.shortcuts.filterEmpty") }}
    </div>

    <section
      v-for="group in groups"
      :key="group.key"
      class="shortcut-group"
      :aria-labelledby="`shortcut-group-${group.key}`"
    >
      <div :id="`shortcut-group-${group.key}`" class="shortcut-group-title">
        {{ group.label }}
      </div>
      <table class="keys-table">
        <tbody>
          <tr
            v-for="row in group.rows"
            :key="row.action"
            :class="{ recording: recording === row.action }"
          >
            <th scope="row" class="act">{{ row.label }}</th>
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
    </section>

    <div v-if="conflict" class="conflict">{{ conflict }}</div>
  </SettingsPage>
</template>

<style scoped>
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
.shortcut-note {
  margin: 0 0 12px;
}
.shortcut-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.shortcut-filter {
  max-width: 260px;
  min-width: 160px;
}
.shortcut-count {
  flex: none;
  font-size: var(--bdg-fs-11);
}
.shortcut-empty {
  padding: 16px 0;
  font-size: var(--bdg-fs-12);
}
.shortcut-group {
  margin-top: 8px;
}
.shortcut-group-title {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 4px;
  background: var(--bdg-bg-panel);
  border-bottom: 1px solid var(--bdg-border);
  font-size: var(--bdg-fs-11);
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--bdg-text-dim);
}
.keys-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.keys-table .act,
.keys-table td {
  padding: 6px 4px;
  border-bottom: 1px solid var(--bdg-border);
  font-size: var(--bdg-fs-13);
  vertical-align: middle;
  font-weight: 400;
  text-align: left;
}
.keys-table tr.recording {
  background: rgb(var(--bdg-accent-rgb) / 0.08);
}
.keys-table .act {
  color: var(--bdg-text-dim);
  overflow-wrap: anywhere;
}
.keys {
  text-align: right;
  white-space: nowrap;
}
/* Wrap whole combos as units; never split a combo's keycaps across lines. */
.combo {
  display: inline-block;
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
/* Wide enough for the two action buttons (Rebind + Reset) so the last column's
   content cannot spill past the page edge. Narrow panels switch to auto below. */
.ops {
  width: 128px;
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

@container (max-width: 560px) {
  .keys {
    white-space: normal;
  }
  .keys-table .act,
  .keys-table td {
    padding: 6px 2px;
  }
  .ops {
    width: auto;
  }
}
</style>
