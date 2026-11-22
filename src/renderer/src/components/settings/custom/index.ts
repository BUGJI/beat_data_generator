import type { Component } from "vue";
import AudioTagline from "./AudioTagline.vue";
import MetronomeBlock from "./MetronomeBlock.vue";
import DevToolsBlock from "./DevToolsBlock.vue";
import SettingsDataBlock from "./SettingsDataBlock.vue";

/** Declarative custom rows (`{ kind: "custom", id }`) → their component. */
const CUSTOM_ROW_COMPONENTS: Record<string, Component> = {
  "audio.tagline": AudioTagline,
  "audio.metronome": MetronomeBlock,
  "advanced.devTools": DevToolsBlock,
  "general.data": SettingsDataBlock,
};

export function customRowComponent(id: string): Component | null {
  return CUSTOM_ROW_COMPONENTS[id] ?? null;
}
