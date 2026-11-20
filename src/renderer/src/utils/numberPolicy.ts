import { numberPolicy, type NumberPolicy } from "@shared/limits";
import { useSettingsStore } from "../stores/settings";

/**
 * The renderer's current numeric admission policy, read from the settings
 * store. Pure math takes a `NumberPolicy` parameter so it stays framework-free;
 * call sites use this adapter to supply the user's choice.
 */
export function currentNumberPolicy(): NumberPolicy {
  return numberPolicy(useSettingsStore().settings.devFreeInput === true);
}
