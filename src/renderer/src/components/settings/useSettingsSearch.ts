import { computed, nextTick, ref, type Ref } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import type { CatKey, SearchEntry } from "./types";
import { useSettingsRowsStore } from "./useSettingsRows";

/**
 * Settings search: builds the result list from the declarative row index and
 * jumps to a hit by switching category / sub-tab and scrolling the row into
 * view. The index itself lives in `useSettingsRowsStore` so rendering and
 * search share one source of truth.
 */
export function useSettingsSearch(opts: {
  cat: Ref<CatKey>;
  contentEl: Ref<HTMLElement | null>;
  searchEl: Ref<HTMLInputElement | null>;
}) {
  const rows = useSettingsRowsStore();
  const { simpleMode, uiMotion } = storeToRefs(rows);
  const { t, te } = useI18n();

  const search = ref("");

  function catLabel(key: string): string {
    return t(`settings.cats.${key}`);
  }

  function labelKeyOf(entry: SearchEntry): string {
    return `settings.${entry.cat}.${entry.key}`;
  }

  /** Normalized query, reused by matching and highlighting. */
  const searchQuery = computed(() => search.value.trim().toLowerCase());

  const searchResults = computed<
    Array<SearchEntry & { label: string; desc: string }>
  >(() => {
    const q = searchQuery.value;
    if (!q) return [];
    const hits: Array<SearchEntry & { label: string; desc: string }> = [];
    for (const entry of rows.searchIndex) {
      if (simpleMode.value && entry.expert) continue;
      const key = labelKeyOf(entry);
      const label = t(key);
      const descKey = `${key}Desc`;
      const desc = te(descKey) ? t(descKey) : "";
      const haystack = [
        label,
        desc,
        catLabel(entry.cat),
        ...(entry.keywords ?? []),
      ]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(q)) hits.push({ ...entry, label, desc });
    }
    return hits;
  });

  /** Split `text` into segments so the matched query can be marked in the list. */
  function highlightParts(
    text: string,
    q: string,
  ): Array<{ text: string; hit: boolean }> {
    if (!q) return [{ text, hit: false }];
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return [{ text, hit: false }];
    const parts: Array<{ text: string; hit: boolean }> = [];
    if (idx > 0) parts.push({ text: text.slice(0, idx), hit: false });
    parts.push({ text: text.slice(idx, idx + q.length), hit: true });
    if (idx + q.length < text.length)
      parts.push({ text: text.slice(idx + q.length), hit: false });
    return parts;
  }

  function goToSetting(hit: SearchEntry & { label: string }): void {
    opts.cat.value = hit.cat;
    if (hit.cat === "theme") {
      if (hit.group === "appearance") rows.themeSub = "appearance";
      else if (hit.group === "preset") rows.themeSub = "preset";
      else rows.themeSub = "custom";
    } else if (hit.group) {
      rows.setSubCat(hit.cat, hit.group);
    }
    search.value = "";
    void nextTick(() => {
      // Prefer explicit `data-search` targets (preset cards, metronome chips…);
      // fall back to matching a regular field row by its visible text.
      const nodes = opts.contentEl.value?.querySelectorAll<HTMLElement>(
        "[data-search], .field-row",
      );
      if (!nodes) return;
      for (const row of nodes) {
        const label = row.getAttribute("data-search") ?? row.textContent ?? "";
        if (label.includes(hit.label)) {
          row.scrollIntoView({
            block: "center",
            behavior: uiMotion.value ? "smooth" : "auto",
          });
          row.classList.add("search-hit");
          window.setTimeout(() => row.classList.remove("search-hit"), 1600);
          break;
        }
      }
    });
  }

  function onSearchEnter(): void {
    const first = searchResults.value[0];
    if (first) goToSetting(first);
  }

  return {
    search,
    searchQuery,
    searchResults,
    highlightParts,
    goToSetting,
    onSearchEnter,
    catLabel,
  };
}
