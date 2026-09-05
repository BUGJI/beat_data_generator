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

export type CloseMode = "ask" | "minimize" | "close";

export interface SettingsData {
  closeMode: CloseMode;
  devEnabled: boolean;
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
  saveTextFile: (defaultPath: string, content: string) => Promise<SaveResult>;
  saveProjectFile: (
    defaultPath: string,
    content: string,
  ) => Promise<SaveResult>;
  getFilePath: (title: string) => Promise<string | null>;
  getSettings: () => Promise<SettingsData>;
  updateSettings: (patch: Partial<SettingsData>) => Promise<SettingsData>;
  toggleDevTools: () => Promise<void>;
  writeProjectFile: (filePath: string, content: string) => Promise<boolean>;
  readTextFile: (filePath: string) => Promise<TextFileResult>;
  computeMd5: (filePath: string) => Promise<string | null>;
  notifyAppReady: () => Promise<void>;
  recordRecent: (filePath: string) => Promise<void>;
  getRecents: () => Promise<string[]>;
  welcomeAction: (payload: WelcomeAction) => void;
  onMainAction: (cb: (payload: WelcomeAction) => void) => () => void;
}

export type WelcomeAction =
  | { type: "new" }
  | { type: "open" }
  | { type: "recent"; path: string };
