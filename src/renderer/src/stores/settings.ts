import { defineStore } from "pinia";
import { ref } from "vue";
import { defaultSettings, type SettingsData } from "@shared/settings";

/**
 * Persisted user settings plus the settings-dialog open flag.
 *
 * This store is plain state. Runtime side effects (theme/DOM/engine) live in
 * `services/settingsEffects.ts`, and load/patch/commit/import live in
 * `services/settingsPersistence.ts`, so importing the store never pulls the DOM
 * or Electron IPC into an unrelated module.
 */
export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<SettingsData>(defaultSettings());
  const settingsOpen = ref(false);

  return { settings, settingsOpen };
});

export function setSettingsOpen(open: boolean): void {
  useSettingsStore().settingsOpen = open;
}
