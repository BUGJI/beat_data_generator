<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { X } from "@lucide/vue";
import { useUiStore } from "../stores/ui";
import {
  exportStats,
  exportTimestamps,
  exportEDL,
  type ExportScope,
} from "../services/projectIO";
import UiButton from "./ui/UiButton.vue";
import UiNumberInput from "./ui/UiNumberInput.vue";
import UiRadioGroup from "./ui/UiRadioGroup.vue";

const { t } = useI18n();
const ui = useUiStore();

const scope = ref<ExportScope>("all");
const decimals = ref(3);
const fps = ref(25);
const busy = ref(false);
const exportBtn = ref<InstanceType<typeof UiButton> | null>(null);

const stats = computed(() => exportStats());
const canSelection = computed(() => stats.value.selectedExportable > 0);
const available = computed(() =>
  scope.value === "selection"
    ? stats.value.selectedExportable
    : stats.value.exportable,
);

const formatOptions = computed(() => [
  { value: "timestamps", label: t("exportDialog.timestamps") },
  { value: "edl", label: t("exportDialog.edl") },
]);

const scopeOptions = computed(() => [
  {
    value: "all",
    label: t("exportDialog.scopeAll", { n: stats.value.exportable }),
  },
  {
    value: "selection",
    label: canSelection.value
      ? t("exportDialog.scopeSelection", { n: stats.value.selectedExportable })
      : t("exportDialog.noSelection"),
  },
]);

watch(
  () => ui.exportOpen,
  async (open) => {
    if (!open) return;
    scope.value = "all";
    decimals.value = 3;
    fps.value = 25;
    await nextTick();
    (exportBtn.value?.$el as HTMLElement | undefined)?.focus();
  },
);

async function runExport(): Promise<void> {
  if (busy.value || available.value <= 0) return;
  busy.value = true;
  try {
    const ok =
      ui.exportKind === "timestamps"
        ? await exportTimestamps({
            scope: scope.value,
            decimals: decimals.value,
          })
        : await exportEDL({ scope: scope.value, fps: fps.value });
    if (ok) ui.exportOpen = false;
  } finally {
    busy.value = false;
  }
}

function close(): void {
  ui.exportOpen = false;
}

function onWindowKey(e: KeyboardEvent): void {
  if (!ui.exportOpen || e.key !== "Escape") return;
  e.preventDefault();
  close();
}

onMounted(() => window.addEventListener("keydown", onWindowKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.exportOpen" class="mask" @click.self="close">
      <div
        class="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="t('exportDialog.title')"
      >
        <header class="head">
          <span class="title">{{ t("exportDialog.title") }}</span>
          <button
            class="close-x"
            :title="t('a11y.close')"
            :aria-label="t('a11y.close')"
            @click="close"
          >
            <X class="size-3.5" />
          </button>
        </header>

        <div class="body">
          <div class="row">
            <span class="label">{{ t("exportDialog.format") }}</span>
            <UiRadioGroup v-model="ui.exportKind" :options="formatOptions" />
          </div>
          <div class="row">
            <span class="label">{{ t("exportDialog.scope") }}</span>
            <UiRadioGroup v-model="scope" :options="scopeOptions" />
          </div>

          <div class="summary">
            <div>
              {{
                t("exportDialog.summary", {
                  total: stats.total,
                  exportable: stats.exportable,
                })
              }}
            </div>
            <div v-if="stats.hidden" class="muted">
              {{ t("exportDialog.excludedHidden", { n: stats.hidden }) }}
            </div>
            <div v-if="stats.typed" class="muted">
              {{ t("exportDialog.excludedTyped", { n: stats.typed }) }}
            </div>
            <div v-if="stats.typed" class="muted">
              {{ t("exportDialog.typedHint") }}
            </div>
          </div>

          <label v-if="ui.exportKind === 'timestamps'" class="row">
            <span class="label">{{ t("exportDialog.decimals") }}</span>
            <UiNumberInput
              v-model="decimals"
              :min="0"
              :max="6"
              :step="1"
              :precision="0"
              class="w-28"
              :label="t('exportDialog.decimals')"
            />
          </label>
          <label v-else class="row">
            <span class="label">{{ t("exportDialog.fps") }}</span>
            <UiNumberInput
              v-model="fps"
              :min="1"
              :max="60"
              :step="1"
              :precision="0"
              class="w-28"
              :label="t('exportDialog.fps')"
            />
          </label>

          <div v-if="available <= 0" class="empty">
            {{ t("exportDialog.empty") }}
          </div>
        </div>

        <footer class="foot">
          <UiButton size="sm" @click="close">
            {{ t("exportDialog.cancel") }}
          </UiButton>
          <UiButton
            ref="exportBtn"
            variant="solid"
            size="sm"
            :loading="busy"
            :disabled="available <= 0"
            @click="runExport"
          >
            {{ t("exportDialog.export") }}
          </UiButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: var(--bdg-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bdg-mask);
  backdrop-filter: var(--bdg-blur);
}
.panel {
  width: min(460px, calc(100vw - 32px));
  max-height: min(680px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  background: var(--bdg-menu);
  border: 1px solid var(--bdg-border-strong);
  border-radius: calc(var(--bdg-radius, 6px) * 2);
  box-shadow: 0 18px 50px var(--bdg-shadow);
  color: var(--bdg-text);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--bdg-border);
}
.title {
  font-size: var(--bdg-fs-14);
  font-weight: 700;
}
.close-x {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--bdg-ctl-sm);
  height: var(--bdg-ctl-sm);
  border: none;
  border-radius: var(--bdg-radius, 6px);
  background: transparent;
  color: var(--bdg-text-dim);
  cursor: pointer;
}
.close-x:hover {
  background: rgb(var(--bdg-neutral) / 0.12);
  color: var(--bdg-text);
}
.body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.label {
  flex: none;
  font-size: var(--bdg-fs-12);
  color: var(--bdg-text-dim);
}
.summary {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius, 6px);
  background: rgb(var(--bdg-neutral) / 0.05);
  font-size: var(--bdg-fs-12);
}
.muted {
  color: var(--bdg-text-dim);
  font-size: var(--bdg-fs-11);
}
.empty {
  font-size: var(--bdg-fs-12);
  color: var(--bdg-amber);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--bdg-border);
}
</style>
