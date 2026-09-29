<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useProjectStore, updateMarkerAttrs } from "../../stores/project";
import { useSettingsStore } from "../../stores/settings";
import {
  defaultForField,
  getTypedef,
  localeText,
  pluginIdOfType,
  type PluginFieldDef,
  type TrackTypeDef,
} from "../../plugins/registry";
import type { Marker } from "../../types";
import UiInput from "../ui/UiInput.vue";
import UiNumberInput from "../ui/UiNumberInput.vue";
import UiSelect from "../ui/UiSelect.vue";
import UiSwitch from "../ui/UiSwitch.vue";

const props = defineProps<{ marker: Marker }>();

const { t } = useI18n();
const project = useProjectStore();
const settings = useSettingsStore();

const freeInput = computed(() => settings.settings.devFreeInput);

const typedMarkerInfo = computed<{
  def: TrackTypeDef | null;
  missing: boolean;
  plugin: string;
  pointLabel: string;
} | null>(() => {
  const m = props.marker;
  const tr = project.tracks.find((x) => x.id === m.trackId);
  const typeKey = tr?.type;
  if (!typeKey || typeKey === "beat") return null;
  const def = getTypedef(typeKey);
  return {
    def,
    missing: !def,
    plugin: pluginIdOfType(typeKey),
    pointLabel: def ? localeText(def.pointName) : typeKey,
  };
});

const typedFields = computed<PluginFieldDef[]>(
  () => typedMarkerInfo.value?.def?.fields ?? [],
);

const markerAttrsJson = computed(() => {
  const m = props.marker;
  if (!m.attrs) return "";
  return JSON.stringify(m.attrs, null, 2);
});

function markerFieldValue(f: PluginFieldDef): unknown {
  const v = props.marker.attrs?.[f.key];
  return v === undefined ? defaultForField(f) : v;
}

function setMarkerField(f: PluginFieldDef, v: unknown): void {
  updateMarkerAttrs(props.marker.id, { [f.key]: v });
}

function fieldLabel(f: PluginFieldDef): string {
  return localeText(f.label) || f.key;
}

function enumOptionLabel(o: {
  value: string | number | boolean;
  label: string | Record<string, string>;
}): string {
  return localeText(o.label);
}

/** Plugin enum options adapted to UiSelect's string-valued model. */
function enumSelectOptions(f: PluginFieldDef): Array<{
  value: string;
  label: string;
}> {
  return (f.options ?? []).map((o) => ({
    value: String(o.value),
    label: enumOptionLabel(o),
  }));
}

function onEnumSelect(f: PluginFieldDef, v: string): void {
  const opt = (f.options ?? []).find((o) => String(o.value) === v);
  if (opt) setMarkerField(f, opt.value);
}

function onNumberField(f: PluginFieldDef, v: number | undefined): void {
  setMarkerField(f, v ?? 0);
}
function onTextField(f: PluginFieldDef, v: string): void {
  setMarkerField(f, v);
}
function onBoolField(f: PluginFieldDef, v: boolean): void {
  setMarkerField(f, v === true);
}
</script>

<template>
  <div v-if="typedMarkerInfo" class="pc-attrs">
    <div class="pc-attrs-title">
      {{ typedMarkerInfo.pointLabel }}
      <span v-if="typedMarkerInfo.missing" class="pc-missing-tag">
        {{ t("prop.attrsMissingTag") }}
      </span>
    </div>

    <div v-if="typedMarkerInfo.missing" class="pc-missing">
      <span>
        {{ t("prop.attrsMissing", { plugin: typedMarkerInfo.plugin }) }}
      </span>
      <pre class="pc-raw num">{{ markerAttrsJson }}</pre>
    </div>

    <template v-else>
      <label v-for="f in typedFields" :key="f.key" class="pc-field">
        <span>{{ fieldLabel(f) }}</span>

        <UiNumberInput
          v-if="f.type === 'number'"
          :model-value="Number(markerFieldValue(f) ?? 0)"
          :min="freeInput ? undefined : f.min"
          :max="freeInput ? undefined : f.max"
          :step="f.step ?? 1"
          class="w-full"
          @update:model-value="(v: number) => onNumberField(f, v)"
        />
        <UiInput
          v-else-if="f.type === 'string'"
          :model-value="String(markerFieldValue(f) ?? '')"
          @blur="
            (e: FocusEvent) =>
              onTextField(f, (e.target as HTMLInputElement).value)
          "
          @keyup.enter="
            onTextField(f, ($event.target as HTMLInputElement).value)
          "
        />
        <UiSwitch
          v-else-if="f.type === 'bool'"
          :model-value="markerFieldValue(f) === true"
          @update:model-value="(v: boolean) => onBoolField(f, v)"
        />
        <UiSelect
          v-else-if="f.type === 'enum'"
          :model-value="String(markerFieldValue(f))"
          size="sm"
          class="pc-enum"
          :options="enumSelectOptions(f)"
          @update:model-value="(v: string) => onEnumSelect(f, v)"
        />
      </label>
    </template>
  </div>
</template>
