import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { i18n } from "../../i18n";
import { patchSettings, useSettingsStore } from "../../stores/settings";
import { toast } from "../../ui/toast";
import {
  MARKET_CATEGORIES,
  type MarketPluginView,
  type MarketProgress,
} from "../../../../shared/market";
import type { MarketCacheTtl } from "../../../../shared/settings";

/**
 * Plugin-marketplace state, kept in a store rather than in the panel so an
 * in-flight install keeps reporting progress even when the user switches away
 * from the Plugins category (which unmounts the panel).
 */

const t = i18n.global.t.bind(i18n.global);

export type MarketAction = "install" | "update" | "installed" | "incompatible";

export const useMarketplaceStore = defineStore("marketplace", () => {
  const settings = useSettingsStore();

  const tab = ref<"installed" | "market">("installed");
  const items = ref<MarketPluginView[]>([]);
  const loading = ref(false);
  const error = ref("");
  const query = ref("");
  const category = ref("");
  const busy = ref<string | null>(null);
  const trustFor = ref<string | null>(null);
  const progress = ref<Record<string, MarketProgress>>({});

  const cacheTtl = computed<string>({
    get: () => settings.settings.marketCacheTtl,
    set: (v) => void patchSettings({ marketCacheTtl: v as MarketCacheTtl }),
  });
  const ttlOptions = computed(() =>
    (["1d", "3d", "7d", "30d"] as const).map((v) => ({
      value: v,
      label: t(`settings.plugins.ttl.${v}`),
    })),
  );

  function name(v: MarketPluginView): string {
    return v.names[i18n.global.locale.value] || v.displayName || v.id;
  }

  function desc(v: MarketPluginView): string {
    return v.descriptions[i18n.global.locale.value] || v.description || v.id;
  }

  const categories = computed<string[]>(() => {
    const set = new Set<string>();
    for (const p of items.value) for (const c of p.categories) set.add(c);
    // Known slugs first, in curated order; unknown slugs after, alphabetically.
    const known = MARKET_CATEGORIES.filter((c) => set.has(c));
    const unknown = [...set]
      .filter((c) => !(MARKET_CATEGORIES as readonly string[]).includes(c))
      .sort();
    return [...known, ...unknown];
  });

  const categoryCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const p of items.value)
      for (const c of p.categories) counts[c] = (counts[c] ?? 0) + 1;
    return counts;
  });

  // A category can disappear after a refresh; never leave the filter stranded.
  watch(categories, (cats) => {
    if (category.value && !cats.includes(category.value)) category.value = "";
  });

  const filtered = computed<MarketPluginView[]>(() => {
    const q = query.value.trim().toLowerCase();
    const cat = category.value;
    return items.value.filter((p) => {
      if (cat && !p.categories.includes(cat)) return false;
      if (!q) return true;
      const hay = [
        name(p),
        desc(p),
        p.id,
        p.author ?? "",
        ...p.tags,
        ...p.categories,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  });

  function categoryLabel(c: string): string {
    const key = `settings.plugins.cats.${c}`;
    if (i18n.global.te(key)) return t(key);
    // Unknown slug: prettify instead of leaking the raw id.
    return c
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function action(v: MarketPluginView): MarketAction {
    if (!v.compatible) return "incompatible";
    if (v.installedVersion && v.updateAvailable) return "update";
    if (v.installedVersion) return "installed";
    return "install";
  }

  function phaseText(p: MarketProgress | undefined): string {
    switch (p?.phase) {
      case "queued":
        return t("settings.plugins.phaseQueued");
      case "download":
        return t("settings.plugins.phaseDownload");
      case "verify":
        return t("settings.plugins.phaseVerify");
      case "extract":
        return t("settings.plugins.phaseExtract");
      default:
        return t("settings.plugins.installing");
    }
  }

  function percent(p: MarketProgress | undefined): number | null {
    if (!p) return null;
    if (p.phase !== "download") return null;
    if (!p.total || p.total <= 0) return null;
    return Math.min(100, Math.round(((p.received ?? 0) / p.total) * 100));
  }

  async function load(force: boolean): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      items.value = force
        ? await window.api.marketRefresh()
        : await window.api.marketList();
    } catch (err) {
      error.value = String(err instanceof Error ? err.message : err);
    } finally {
      loading.value = false;
    }
  }

  async function install(v: MarketPluginView): Promise<void> {
    trustFor.value = null;
    busy.value = v.id;
    progress.value = {
      ...progress.value,
      [v.id]: { id: v.id, version: v.latest, phase: "queued" },
    };
    try {
      const res = await window.api.marketInstall(v.id, v.latest);
      if (res.ok) {
        toast.success(t("settings.plugins.installOk", { name: name(v) }));
      } else {
        toast.error(
          t("settings.plugins.installFail", { error: res.error ?? "" }),
        );
      }
    } catch (err) {
      toast.error(t("settings.plugins.installFail", { error: String(err) }));
    } finally {
      busy.value = null;
      await load(false);
    }
  }

  async function installZip(): Promise<void> {
    try {
      const res = await window.api.installPluginZip();
      if (!res) return; // canceled
      if (res.ok) toast.success(t("settings.plugins.zipOk", { name: res.id }));
      else
        toast.error(
          t("settings.plugins.installFail", { error: res.error ?? "" }),
        );
    } catch (err) {
      toast.error(t("settings.plugins.installFail", { error: String(err) }));
    } finally {
      await load(false);
    }
  }

  async function uninstall(v: MarketPluginView): Promise<void> {
    busy.value = v.id;
    try {
      const ok = await window.api.marketUninstall(v.id);
      if (ok)
        toast.success(t("settings.plugins.uninstallOk", { name: name(v) }));
      else toast.error(t("settings.plugins.uninstallFail"));
    } catch {
      toast.error(t("settings.plugins.uninstallFail"));
    } finally {
      busy.value = null;
      await load(false);
    }
  }

  // Registered once for the app lifetime so progress survives panel unmounts.
  window.api.onMarketProgress((p) => {
    progress.value = { ...progress.value, [p.id]: p };
    if (p.phase === "error" && p.error) {
      error.value = t("settings.plugins.installFail", { error: p.error });
    }
  });

  return {
    tab,
    items,
    loading,
    error,
    query,
    category,
    busy,
    trustFor,
    progress,
    cacheTtl,
    ttlOptions,
    categories,
    categoryCounts,
    filtered,
    name,
    desc,
    categoryLabel,
    action,
    phaseText,
    percent,
    load,
    install,
    installZip,
    uninstall,
  };
});
