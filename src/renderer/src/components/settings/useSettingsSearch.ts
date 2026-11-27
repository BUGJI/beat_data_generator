import { computed, nextTick, ref, watch, type Ref } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { CAT_ORDER, type CatKey, type SearchEntry } from "./types";
import { useSettingsRowsStore } from "./useSettingsRows";
import { animationsEnabled } from "../../services/motion";

type Hit = SearchEntry & {
  label: string;
  desc: string;
  /** False when a showIf gate currently hides the row. */
  available: boolean;
};

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
  const activeIndex = ref(0);

  function catLabel(key: string): string {
    return t(`settings.cats.${key}`);
  }

  function labelKeyOf(entry: SearchEntry): string {
    return `settings.${entry.cat}.${entry.key}`;
  }

  /** Normalized query, reused by matching and highlighting. */
  const searchQuery = computed(() => search.value.trim().toLowerCase());

  const searchResults = computed<Hit[]>(() => {
    const q = searchQuery.value;
    if (!q) return [];
    const hits: Hit[] = [];
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
      if (haystack.includes(q))
        hits.push({
          ...entry,
          label,
          desc,
          available: !entry.visible || entry.visible(),
        });
    }
    return hits;
  });

  /** Results ordered by the navigation grouping, then grouped for display. */
  const orderedResults = computed<Hit[]>(() => {
    const rank = new Map(CAT_ORDER.map((cat, index) => [cat, index]));
    return [...searchResults.value].sort(
      (a, b) => (rank.get(a.cat) ?? 0) - (rank.get(b.cat) ?? 0),
    );
  });

  const searchGroups = computed<
    Array<{
      cat: CatKey;
      label: string;
      hits: Array<{ hit: Hit; index: number }>;
    }>
  >(() => {
    const groups: Array<{
      cat: CatKey;
      label: string;
      hits: Array<{ hit: Hit; index: number }>;
    }> = [];
    let index = 0;
    for (const hit of orderedResults.value) {
      let group = groups[groups.length - 1];
      if (!group || group.cat !== hit.cat) {
        group = { cat: hit.cat, label: catLabel(hit.cat), hits: [] };
        groups.push(group);
      }
      group.hits.push({ hit, index });
      index += 1;
    }
    return groups;
  });

  watch(searchQuery, () => {
    activeIndex.value = 0;
  });
  watch(
    () => searchResults.value.length,
    (length) => {
      if (activeIndex.value >= length)
        activeIndex.value = Math.max(0, length - 1);
    },
  );

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

  function scrollResultIntoView(index: number): void {
    void nextTick(() => {
      document
        .getElementById(`settings-hit-${index}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function setActive(index: number): void {
    const last = orderedResults.value.length - 1;
    if (last < 0) {
      activeIndex.value = 0;
      return;
    }
    activeIndex.value = Math.min(Math.max(index, 0), last);
    scrollResultIntoView(activeIndex.value);
  }

  function moveActive(delta: number): void {
    const count = orderedResults.value.length;
    if (!count) return;
    setActive((activeIndex.value + delta + count) % count);
  }

  function revealRow(row: HTMLElement): void {
    row.scrollIntoView({
      block: "center",
      behavior: uiMotion.value && animationsEnabled() ? "smooth" : "auto",
    });
    row.classList.add("search-hit");
    window.setTimeout(() => row.classList.remove("search-hit"), 1600);
  }

  function goToSetting(hit: SearchEntry & { label: string }): void {
    const available = !hit.visible || hit.visible();
    opts.cat.value = hit.cat;
    if (hit.cat === "theme") {
      rows.themeSub = hit.group === "preset" ? "preset" : "custom";
    } else if (hit.group) {
      rows.setSubCat(hit.cat, hit.group);
    }
    search.value = "";
    opts.searchEl.value?.focus();
    if (hit.page) return;
    void nextTick(() => {
      const content = opts.contentEl.value;
      if (!content) return;
      if (!available) {
        // The row is gated by another setting (showIf). Land on the first row
        // of its group so the switch that enables it is in view, instead of
        // scrolling to a row that is not rendered.
        const first = content.querySelector<HTMLElement>(".field-row");
        if (first) revealRow(first);
        return;
      }
      // Prefer explicit `data-search` targets (preset cards, metronome chips…);
      // fall back to matching a regular field row by its visible text.
      const nodes = content.querySelectorAll<HTMLElement>(
        "[data-search], .field-row",
      );
      if (!nodes) return;
      for (const row of nodes) {
        const label = row.getAttribute("data-search") ?? row.textContent ?? "";
        if (label.includes(hit.label)) {
          revealRow(row);
          break;
        }
      }
    });
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    // Do not hijack keys while an IME composition is active (notably CJK).
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = orderedResults.value[activeIndex.value];
      if (hit) goToSetting(hit);
    }
  }

  return {
    search,
    searchQuery,
    searchResults,
    orderedResults,
    searchGroups,
    activeIndex,
    highlightParts,
    goToSetting,
    onSearchKeydown,
    catLabel,
  };
}
