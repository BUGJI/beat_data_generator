import { contextBridge, ipcRenderer } from "electron";
import type { IpcApi, WelcomeAction } from "../shared/ipc";

function onMainAction(cb: (payload: WelcomeAction) => void): () => void {
  const listener = (_e: unknown, payload: WelcomeAction): void => cb(payload);
  ipcRenderer.on("welcome:action", listener);
  return () => ipcRenderer.removeListener("welcome:action", listener);
}

function onPluginsChanged(cb: () => void): () => void {
  const listener = (): void => cb();
  ipcRenderer.on("plugin:changed", listener);
  return () => ipcRenderer.removeListener("plugin:changed", listener);
}

const api: IpcApi = {
  openAudio: () => ipcRenderer.invoke("audio:open"),
  readAudioFile: (filePath: string) =>
    ipcRenderer.invoke("audio:read", filePath),
  openTextFile: () => ipcRenderer.invoke("text:open"),
  saveTextFile: (defaultPath: string) =>
    ipcRenderer.invoke("text:save", defaultPath),
  saveProjectFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("text:saveAsTxt", defaultPath, content),
  saveEDLFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("text:saveEdl", defaultPath, content),
  getFilePath: (title: string) => ipcRenderer.invoke("file:path", title),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  toggleDevTools: () => ipcRenderer.invoke("dev:tools"),
  writeProjectFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("text:write", filePath, content),
  computeMd5: (filePath: string) => ipcRenderer.invoke("audio:md5", filePath),
  notifyAppReady: () => ipcRenderer.invoke("app:ready"),
  readTextFile: (filePath: string) => ipcRenderer.invoke("text:read", filePath),
  recordRecent: (filePath: string, title?: string) =>
    ipcRenderer.invoke("recents:add", filePath, title),
  getRecents: () => ipcRenderer.invoke("recents:get"),
  welcomeAction: (payload: WelcomeAction) =>
    ipcRenderer.send("welcome:action", payload),
  onMainAction,
  listPlugins: () => ipcRenderer.invoke("plugins:list"),
  setPluginEnabled: (id, enabled) =>
    ipcRenderer.invoke("plugins:set-enabled", id, enabled),
  reloadPlugins: () => ipcRenderer.invoke("plugins:reload"),
  readPluginRenderer: (id: string) =>
    ipcRenderer.invoke("plugins:renderer-source", id),
  openPluginsFolder: () => ipcRenderer.invoke("plugins:open-folder"),
  invokePlugin: (id, method, ...args) =>
    ipcRenderer.invoke("plugins:invoke", id, method, args),
  onPluginsChanged,
};

contextBridge.exposeInMainWorld("api", api);
