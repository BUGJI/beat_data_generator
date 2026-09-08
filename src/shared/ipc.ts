import type { PluginEntry } from "./plugin";

export interface AudioFileResult {
  filePath: string;
  name: string;
  size: number;
  data: Uint8Array;
}

export interface TextFileResult {
  canceled: boolean;
  filePath?: string;
  content?: string;
}

export interface SaveResult {
  canceled: boolean;
  filePath?: string;
}

export interface IpcFileFilter {
  name: string;
  extensions: string[];
}

export interface IpcOpenWindowOptions {
  url: string;
  title?: string;
  width?: number;
  height?: number;
}

export type CloseMode = "ask" | "minimize" | "close";

export interface RecentProject {
  path: string;
  title: string;
}

export interface SettingsData {
  closeMode: CloseMode;
  devEnabled: boolean;
  devFreeInput: boolean;
  animEnabled: boolean;
  /** auto-hide dense beat grid lines when zoomed out to avoid slow rendering. */
  gridAutoHide: boolean;
  /** silently check for updates on startup and notify when one is available. */
  checkUpdates: boolean;
  followScroll: boolean;
  followPercent: number;
  followPreset: boolean;
  rememberWindow: boolean;
  autoSave: boolean;
  autoSaveMinutes: number;
}

export interface IpcApi {
  openAudio: () => Promise<AudioFileResult | null>;
  readAudioFile: (filePath: string) => Promise<AudioFileResult | null>;
  openTextFile: () => Promise<TextFileResult>;
  saveTextFile: (defaultPath: string) => Promise<SaveResult>;
  saveProjectFile: (
    defaultPath: string,
    content: string,
  ) => Promise<SaveResult>;
  saveEDLFile: (defaultPath: string, content: string) => Promise<SaveResult>;
  getFilePath: (title: string) => Promise<string | null>;
  getSettings: () => Promise<SettingsData>;
  updateSettings: (patch: Partial<SettingsData>) => Promise<SettingsData>;
  toggleDevTools: () => Promise<void>;
  writeProjectFile: (filePath: string, content: string) => Promise<boolean>;
  readTextFile: (filePath: string) => Promise<TextFileResult>;
  computeMd5: (filePath: string) => Promise<string | null>;
  notifyAppReady: () => Promise<void>;
  recordRecent: (filePath: string, title?: string) => Promise<void>;
  getRecents: () => Promise<RecentProject[]>;
  welcomeAction: (payload: WelcomeAction) => void;
  onMainAction: (cb: (payload: WelcomeAction) => void) => () => void;
  /** List all discovered plugins with their enabled state. */
  listPlugins: () => Promise<PluginEntry[]>;
  /** Enable/disable a plugin; resolves with the updated full list. */
  setPluginEnabled: (id: string, enabled: boolean) => Promise<PluginEntry[]>;
  /** Re-scan plugin roots and (re)load enabled plugins; resolves with the list. */
  reloadPlugins: () => Promise<PluginEntry[]>;
  /** Raw source of an enabled plugin's renderer entry, or null. */
  readPluginRenderer: (id: string) => Promise<string | null>;
  /** Reveal the user plugins folder in the system file manager. */
  openPluginsFolder: () => Promise<void>;
  /** Route a free-form call to a plugin's main-process handler. */
  invokePlugin: (
    id: string,
    method: string,
    ...args: unknown[]
  ) => Promise<unknown>;
  /** Fired by the main process whenever the plugin set or its state changes. */
  onPluginsChanged: (cb: () => void) => () => void;
  /** Generic native open picker for arbitrary extensions (plugin service). */
  pickFile: (
    title: string,
    filters: IpcFileFilter[],
  ) => Promise<string | null>;
  /** Generic native save dialog; returns the chosen path, caller writes. */
  saveFileDialog: (
    title: string,
    defaultPath: string,
    filters: IpcFileFilter[],
  ) => Promise<SaveResult>;
  /** Write UTF-8 text to an absolute path (plugin service). */
  writeTextFile: (filePath: string, content: string) => Promise<boolean>;
  /** Open an extra window loading an arbitrary page (plugin service). */
  openWindow: (opts: IpcOpenWindowOptions) => Promise<void>;
}

export type WelcomeAction =
  | { type: "new"; path?: string | null }
  | { type: "open"; path?: string | null }
  | { type: "recent"; path: string };
