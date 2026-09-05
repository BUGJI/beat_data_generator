import { reactive } from "vue";
import type { LocaText } from "../../../shared/plugin";

/**
 * UI contribution registry. Plugins push contributions here while enabled;
 * the editor chrome (top menu, floating panel host, shortcut dispatcher)
 * renders whatever is currently registered. Every registerX helper returns a
 * disposer the plugin api calls on disable/reload so nothing leaks.
 */

export interface PluginActionDef {
  label: LocaText;
  run: () => void | Promise<void>;
}

/** Registers a "file -> project" conversion (listed under File > Import). */
export interface PluginImporterDef {
  label: LocaText;
  run: () => void | Promise<void>;
}

/** Registers a "project -> file" conversion (listed under Export). */
export interface PluginExporterDef {
  label: LocaText;
  run: () => void | Promise<void>;
}

export interface PluginPanelDef {
  id: string;
  title: LocaText;
  mount: (el: HTMLElement) => void | (() => void);
}

export interface PluginShortcutDef {
  id: string;
  label: LocaText;
  /** e.g. "Ctrl+Shift+F", "F5", "Alt+P", "Cmd+Space". */
  combo: string;
  run: () => void | Promise<void>;
}

interface Entry<T> {
  pluginId: string;
  uid: number;
  def: T;
}

export interface RegisteredAction extends Entry<PluginActionDef> {}
export interface RegisteredPanel extends Entry<PluginPanelDef> {}
export interface RegisteredShortcut extends Entry<PluginShortcutDef> {}
export interface RegisteredImporter extends Entry<PluginImporterDef> {}
export interface RegisteredExporter extends Entry<PluginExporterDef> {}

export interface OpenPanelRef {
  pluginId: string;
  uid: number;
}

let uidCounter = 0;
const nextUid = (): number => ++uidCounter;

export const actions = reactive<RegisteredAction[]>([]);
export const panels = reactive<RegisteredPanel[]>([]);
export const shortcuts = reactive<RegisteredShortcut[]>([]);
export const importers = reactive<RegisteredImporter[]>([]);
export const exporters = reactive<RegisteredExporter[]>([]);
export const openPanels = reactive<OpenPanelRef[]>([]);

export function localeText(v: LocaText | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  const loc = document.documentElement.lang || "en";
  return v[loc] || v.en || Object.values(v)[0] || "";
}

export function panelKey(pluginId: string, uid: number): string {
  return `${pluginId}:${uid}`;
}

export function isPanelOpen(pluginId: string, uid: number): boolean {
  return openPanels.some((p) => p.pluginId === pluginId && p.uid === uid);
}

export function openPanel(pluginId: string, uid: number): void {
  if (!panels.some((p) => p.pluginId === pluginId && p.uid === uid)) return;
  if (!isPanelOpen(pluginId, uid)) openPanels.push({ pluginId, uid });
}

export function closePanel(pluginId: string, uid: number): void {
  const i = openPanels.findIndex(
    (p) => p.pluginId === pluginId && p.uid === uid,
  );
  if (i >= 0) openPanels.splice(i, 1);
}

export function closeAllPluginPanels(pluginId: string): void {
  for (let i = openPanels.length - 1; i >= 0; i--) {
    if (openPanels[i]?.pluginId === pluginId) openPanels.splice(i, 1);
  }
}

function registerAction(
  pluginId: string,
  def: PluginActionDef,
): () => void {
  const item: RegisteredAction = { pluginId, uid: nextUid(), def };
  actions.push(item);
  return () => {
    const i = actions.indexOf(item);
    if (i >= 0) actions.splice(i, 1);
  };
}

export interface PanelHandle {
  dispose: () => void;
  uid: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

function registerPanel(
  pluginId: string,
  def: PluginPanelDef,
): PanelHandle {
  const item: RegisteredPanel = { pluginId, uid: nextUid(), def };
  panels.push(item);
  const remove = (): void => {
    const i = panels.indexOf(item);
    if (i >= 0) panels.splice(i, 1);
    closePanel(pluginId, item.uid);
  };
  return {
    dispose: remove,
    uid: item.uid,
    open: () => openPanel(pluginId, item.uid),
    close: () => closePanel(pluginId, item.uid),
    toggle: () =>
      isPanelOpen(pluginId, item.uid)
        ? closePanel(pluginId, item.uid)
        : openPanel(pluginId, item.uid),
    isOpen: () => isPanelOpen(pluginId, item.uid),
  };
}

function registerShortcut(
  pluginId: string,
  def: PluginShortcutDef,
): () => void {
  const item: RegisteredShortcut = { pluginId, uid: nextUid(), def };
  shortcuts.push(item);
  return () => {
    const i = shortcuts.indexOf(item);
    if (i >= 0) shortcuts.splice(i, 1);
  };
}

function registerImporter(
  pluginId: string,
  def: PluginImporterDef,
): () => void {
  const item: RegisteredImporter = { pluginId, uid: nextUid(), def };
  importers.push(item);
  return () => {
    const i = importers.indexOf(item);
    if (i >= 0) importers.splice(i, 1);
  };
}

function registerExporter(
  pluginId: string,
  def: PluginExporterDef,
): () => void {
  const item: RegisteredExporter = { pluginId, uid: nextUid(), def };
  exporters.push(item);
  return () => {
    const i = exporters.indexOf(item);
    if (i >= 0) exporters.splice(i, 1);
  };
}

// ---- shortcut matching ----

interface ComboParts {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

function parseCombo(combo: string): ComboParts | null {
  const parts = combo.split("+").map((s) => s.trim());
  if (!parts.length) return null;
  const out: ComboParts = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: "",
  };
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === "ctrl" || low === "control") out.ctrl = true;
    else if (low === "shift") out.shift = true;
    else if (low === "alt" || low === "option") out.alt = true;
    else if (low === "meta" || low === "cmd" || low === "command" || low === "win")
      out.meta = true;
    else out.key = p;
  }
  return out.key ? out : null;
}

function comboMatches(combo: ComboParts, e: KeyboardEvent): boolean {
  const wantMeta = e.ctrlKey || e.metaKey;
  if (combo.ctrl !== wantMeta) return false;
  if (combo.meta && !wantMeta) return false;
  if (combo.shift !== e.shiftKey) return false;
  if (combo.alt !== e.altKey) return false;
  const k = combo.key;
  if (k.length === 1) {
    return e.key.toLowerCase() === k.toLowerCase();
  }
  return e.code === k || e.key.toLowerCase() === k.toLowerCase();
}

export function dispatchShortcut(e: KeyboardEvent): boolean {
  for (const s of [...shortcuts]) {
    const parsed = parseCombo(s.def.combo);
    if (parsed && comboMatches(parsed, e)) {
      try {
        const r = s.def.run();
        if (r && typeof (r as Promise<void>).then === "function") {
          void r;
        }
      } catch (err) {
        console.error(
          `[plugin:${s.pluginId}] shortcut ${s.def.id} error`,
          err,
        );
      }
      return true;
    }
  }
  return false;
}

export type UiContributions = {
  registerAction: (def: PluginActionDef) => () => void;
  registerPanel: (def: PluginPanelDef) => PanelHandle;
  registerShortcut: (def: PluginShortcutDef) => () => void;
  registerImporter: (def: PluginImporterDef) => () => void;
  registerExporter: (def: PluginExporterDef) => () => void;
  openPanel: (uid: number) => void;
  closePanel: (uid: number) => void;
};

/** Builds the per-plugin ui handle so contributions are auto-cleaned on dispose. */
export function uiHandleFor(pluginId: string): UiContributions & {
  dispose: () => void;
} {
  const disposers: Array<() => void> = [];
  return {
    registerAction: (def) => {
      const d = registerAction(pluginId, def);
      disposers.push(d);
      return d;
    },
    registerPanel: (def) => {
      const d = registerPanel(pluginId, def);
      disposers.push(d.dispose);
      return d;
    },
    registerShortcut: (def) => {
      const d = registerShortcut(pluginId, def);
      disposers.push(d);
      return d;
    },
    registerImporter: (def) => {
      const d = registerImporter(pluginId, def);
      disposers.push(d);
      return d;
    },
    registerExporter: (def) => {
      const d = registerExporter(pluginId, def);
      disposers.push(d);
      return d;
    },
    openPanel: (uid: number) => openPanel(pluginId, uid),
    closePanel: (uid: number) => closePanel(pluginId, uid),
    dispose: () => {
      for (const d of [...disposers].reverse()) {
        try {
          d();
        } catch (err) {
          console.error(err);
        }
      }
      disposers.length = 0;
      closeAllPluginPanels(pluginId);
    },
  };
}

/** Return the panel record for a plugin+uid, or null. */
export function panelOf(pluginId: string, uid: number): RegisteredPanel | null {
  return (
    panels.find((p) => p.pluginId === pluginId && p.uid === uid) ?? null
  );
}

// ---------------------------------------------------------------------------
// Typed track types
// ---------------------------------------------------------------------------

export type FieldValue = number | string | boolean;
export type PluginFieldType = "number" | "string" | "bool" | "enum";

export interface PluginFieldOption {
  value: FieldValue;
  label: LocaText;
}

export interface PluginFieldDef {
  key: string;
  label: LocaText;
  type: PluginFieldType;
  default?: FieldValue;
  min?: number;
  max?: number;
  step?: number;
  options?: PluginFieldOption[];
}

export interface TrackTypeDef {
  /** local id, unique within the plugin. */
  id: string;
  /** display name used when creating a new track of this type. */
  trackName: LocaText;
  /** display name of the points placed on such tracks. */
  pointName: LocaText;
  color?: string;
  fields: PluginFieldDef[];
}

export interface RegisteredTrackType {
  pluginId: string;
  uid: number;
  def: TrackTypeDef;
}

export const trackTypes = reactive<RegisteredTrackType[]>([]);

export function typeKeyOf(pluginId: string, localId: string): string {
  return `${pluginId}:${localId}`;
}

export function pluginIdOfType(key: string): string {
  const i = key.indexOf(":");
  return i > 0 ? key.slice(0, i) : key;
}

export function localIdOfType(key: string): string {
  const i = key.indexOf(":");
  return i >= 0 ? key.slice(i + 1) : key;
}

export function registerTrackType(
  pluginId: string,
  def: TrackTypeDef,
): { ok: boolean; reason?: string } {
  if (!pluginId || pluginId.includes(":")) {
    return { ok: false, reason: "plugin id must not contain ':'" };
  }
  if (!def || typeof def.id !== "string" || !def.id || def.id.includes(":")) {
    return { ok: false, reason: "track type id must be a non-empty string without ':'" };
  }
  const key = typeKeyOf(pluginId, def.id);
  if (getTypedef(key)) {
    return { ok: false, reason: `track type "${key}" already registered` };
  }
  const item: RegisteredTrackType = {
    pluginId,
    uid: nextUid(),
    def: {
      ...def,
      fields: Array.isArray(def.fields)
        ? def.fields.filter((f) => f && typeof f.key === "string")
        : [],
    },
  };
  trackTypes.push(item);
  return { ok: true };
}

export function getTypedef(key: string): TrackTypeDef | null {
  const t = trackTypes.find(
    (x) => typeKeyOf(x.pluginId, x.def.id) === key,
  );
  return t ? t.def : null;
}

export function hasTypedef(key: string): boolean {
  return getTypedef(key) !== null;
}

export function defaultForField(f: PluginFieldDef): FieldValue | undefined {
  if (f.type === "number") {
    return typeof f.default === "number" && Number.isFinite(f.default)
      ? f.default
      : 0;
  }
  if (f.type === "string") {
    return typeof f.default === "string" ? f.default : "";
  }
  if (f.type === "bool") {
    return f.default === true;
  }
  if (f.type === "enum") {
    const opts = f.options ?? [];
    if (typeof f.default !== "undefined") {
      const hit = opts.find(
        (o) => o && (o.value as FieldValue) === f.default,
      );
      if (hit) return f.default;
    }
    return opts[0]?.value ?? "";
  }
  return undefined;
}

export function defaultAttrsFor(key: string): Record<string, unknown> {
  const def = getTypedef(key);
  if (!def) return {};
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (!f || !f.key) continue;
    out[f.key] = defaultForField(f);
  }
  return out;
}

/** Unregister every track type contributed by a plugin. */
export function dropPluginTrackTypes(pluginId: string): void {
  for (let i = trackTypes.length - 1; i >= 0; i--) {
    if (trackTypes[i]?.pluginId === pluginId) trackTypes.splice(i, 1);
  }
}
