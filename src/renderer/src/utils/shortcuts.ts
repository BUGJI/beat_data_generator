export type ShortcutAction =
  | "playPause"
  | "playAtRate"
  | "save"
  | "saveAs"
  | "openProject"
  | "openAudio"
  | "undo"
  | "redo"
  | "copy"
  | "cut"
  | "paste"
  | "selectAll"
  | "deleteSel"
  | "nudgeLeft"
  | "nudgeRight"
  | "placeMarker"
  | "tapTempo"
  | "tapTempoReset"
  | "prevMarker"
  | "nextMarker"
  | "goto"
  | "home"
  | "escape"
  | "zoomIn"
  | "zoomOut"
  | "zoomFit"
  | "toggleSnap"
  | "toggleMagnet"
  | "toggleQuickPlace"
  | "toggleTimeAlign"
  | "toggleFollow"
  | "toggleLoop"
  | "toggleGridClick"
  | "toggleAnalysis"
  | "addTrack"
  | "moveTrackUp"
  | "moveTrackDown"
  | "addNote"
  | "exportTimestamps"
  | "exportEdl";

export interface ShortcutDef {
  action: ShortcutAction;
  labelKey: string;
  defaultBinding: string;
}

export const SHORTCUT_DEFS: readonly ShortcutDef[] = [
  { action: "playPause", labelKey: "playPause", defaultBinding: "Space|Enter" },
  {
    action: "playAtRate",
    labelKey: "playAtRate",
    defaultBinding: "Ctrl+Space",
  },
  { action: "save", labelKey: "save", defaultBinding: "Ctrl+S" },
  { action: "saveAs", labelKey: "saveAs", defaultBinding: "Ctrl+Shift+S" },
  { action: "openProject", labelKey: "openProject", defaultBinding: "Ctrl+O" },
  {
    action: "openAudio",
    labelKey: "openAudio",
    defaultBinding: "Ctrl+Shift+O",
  },
  { action: "undo", labelKey: "undo", defaultBinding: "Ctrl+Z" },
  { action: "redo", labelKey: "redo", defaultBinding: "Ctrl+Y|Ctrl+Shift+Z" },
  { action: "copy", labelKey: "copy", defaultBinding: "Ctrl+C" },
  { action: "cut", labelKey: "cut", defaultBinding: "Ctrl+X" },
  { action: "paste", labelKey: "paste", defaultBinding: "Ctrl+V" },
  { action: "selectAll", labelKey: "selectAll", defaultBinding: "Ctrl+A" },
  {
    action: "deleteSel",
    labelKey: "deleteSel",
    defaultBinding: "Delete|Backspace",
  },
  { action: "nudgeLeft", labelKey: "nudgeLeft", defaultBinding: "ArrowLeft" },
  {
    action: "nudgeRight",
    labelKey: "nudgeRight",
    defaultBinding: "ArrowRight",
  },
  { action: "placeMarker", labelKey: "placeMarker", defaultBinding: "M" },
  { action: "tapTempo", labelKey: "tapTempo", defaultBinding: "T" },
  {
    action: "tapTempoReset",
    labelKey: "tapTempoReset",
    defaultBinding: "Shift+T",
  },
  {
    action: "prevMarker",
    labelKey: "prevMarker",
    defaultBinding: ",|Alt+ArrowLeft",
  },
  {
    action: "nextMarker",
    labelKey: "nextMarker",
    defaultBinding: ".|Alt+ArrowRight",
  },
  { action: "goto", labelKey: "goto", defaultBinding: "Ctrl+G" },
  { action: "home", labelKey: "home", defaultBinding: "Home" },
  { action: "escape", labelKey: "esc", defaultBinding: "Escape" },
  { action: "zoomIn", labelKey: "zoomIn", defaultBinding: "Ctrl+=" },
  { action: "zoomOut", labelKey: "zoomOut", defaultBinding: "Ctrl+-" },
  { action: "zoomFit", labelKey: "zoomFit", defaultBinding: "Ctrl+0" },
  { action: "toggleSnap", labelKey: "toggleSnap", defaultBinding: "" },
  { action: "toggleMagnet", labelKey: "toggleMagnet", defaultBinding: "" },
  {
    action: "toggleQuickPlace",
    labelKey: "toggleQuickPlace",
    defaultBinding: "",
  },
  {
    action: "toggleTimeAlign",
    labelKey: "toggleTimeAlign",
    defaultBinding: "",
  },
  { action: "toggleFollow", labelKey: "toggleFollow", defaultBinding: "" },
  { action: "toggleLoop", labelKey: "toggleLoop", defaultBinding: "" },
  {
    action: "toggleGridClick",
    labelKey: "toggleGridClick",
    defaultBinding: "",
  },
  { action: "toggleAnalysis", labelKey: "toggleAnalysis", defaultBinding: "" },
  { action: "addTrack", labelKey: "addTrack", defaultBinding: "" },
  {
    action: "moveTrackUp",
    labelKey: "moveTrackUp",
    defaultBinding: "Ctrl+Shift+ArrowUp",
  },
  {
    action: "moveTrackDown",
    labelKey: "moveTrackDown",
    defaultBinding: "Ctrl+Shift+ArrowDown",
  },
  { action: "addNote", labelKey: "addNote", defaultBinding: "" },
  {
    action: "exportTimestamps",
    labelKey: "exportTimestamps",
    defaultBinding: "",
  },
  { action: "exportEdl", labelKey: "exportEdl", defaultBinding: "" },
] as const;

export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUT_DEFS.map((def) => [def.action, def.defaultBinding]),
) as Record<ShortcutAction, string>;

/** Display groups for the shortcuts page (kept beside the definitions so a new
 *  action must pick a group when this record is type-checked). */
export type ShortcutGroup =
  | "playback"
  | "file"
  | "edit"
  | "navigation"
  | "view"
  | "tracks";

export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = [
  "playback",
  "file",
  "edit",
  "navigation",
  "view",
  "tracks",
];

export const SHORTCUT_GROUP: Record<ShortcutAction, ShortcutGroup> = {
  playPause: "playback",
  playAtRate: "playback",
  tapTempo: "playback",
  tapTempoReset: "playback",
  save: "file",
  saveAs: "file",
  openProject: "file",
  openAudio: "file",
  exportTimestamps: "file",
  exportEdl: "file",
  undo: "edit",
  redo: "edit",
  copy: "edit",
  cut: "edit",
  paste: "edit",
  selectAll: "edit",
  deleteSel: "edit",
  nudgeLeft: "edit",
  nudgeRight: "edit",
  placeMarker: "edit",
  prevMarker: "navigation",
  nextMarker: "navigation",
  goto: "navigation",
  home: "navigation",
  escape: "navigation",
  zoomIn: "view",
  zoomOut: "view",
  zoomFit: "view",
  toggleSnap: "view",
  toggleMagnet: "view",
  toggleQuickPlace: "view",
  toggleTimeAlign: "view",
  toggleFollow: "view",
  toggleLoop: "view",
  toggleGridClick: "view",
  toggleAnalysis: "view",
  addTrack: "tracks",
  moveTrackUp: "tracks",
  moveTrackDown: "tracks",
  addNote: "tracks",
};

export function bindingFor(
  action: ShortcutAction,
  overrides: Record<string, string> | undefined,
): string {
  const custom = overrides?.[action];
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  return DEFAULT_SHORTCUTS[action] ?? "";
}

export function matchesBinding(combo: string, binding: string): boolean {
  if (!binding) return false;
  return binding.split("|").some((part) => part.trim() === combo);
}

function normalizeKey(key: string): string | null {
  if (key === "Control" || key === "Meta" || key === "Alt" || key === "Shift")
    return null;
  if (key === " ") return "Space";
  if (key === "+") return "=";
  if (key === "_") return "-";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function eventCombo(e: KeyboardEvent): string | null {
  const key = normalizeKey(e.key);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && key !== "=" && key !== "-") parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

export function comboParts(binding: string): string[][] {
  return binding
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split("+"));
}
