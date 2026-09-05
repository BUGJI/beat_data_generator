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

export interface OpenPanelRef {
  pluginId: string;
  uid: number;
}

let uidCounter = 0;
const nextUid = (): number => ++uidCounter;

export const actions = reactive<RegisteredAction[]>([]);
export const panels = reactive<RegisteredPanel[]>([]);
export const shortcuts = reactive<RegisteredShortcut[]>([]);
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
