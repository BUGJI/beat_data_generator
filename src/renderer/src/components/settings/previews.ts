import type { Component } from "vue";
import type { CatKey } from "./types";
import SettingsVisualPreview from "./SettingsVisualPreview.vue";

/**
 * Categories that render a live, read-only demo pane next to their rows.
 * Kept separate from the row model so a preview is purely additive: a category
 * without an entry keeps the plain single-column layout.
 */
const PREVIEW_CATS: readonly CatKey[] = ["audio", "display"];

export function visualPreviewFor(cat: CatKey): Component | null {
  return PREVIEW_CATS.includes(cat) ? SettingsVisualPreview : null;
}
