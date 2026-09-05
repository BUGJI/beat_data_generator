import { contextBridge, ipcRenderer } from "electron";
import type { IpcApi, WelcomeAction } from "../shared/ipc";

function onMainAction(cb: (payload: WelcomeAction) => void): () => void {
  const listener = (_e: unknown, payload: WelcomeAction): void => cb(payload);
  ipcRenderer.on("welcome:action", listener);
  return () => ipcRenderer.removeListener("welcome:action", listener);
}

const api: IpcApi = {
  openAudio: () => ipcRenderer.invoke("audio:open"),
  readAudioFile: (filePath: string) =>
    ipcRenderer.invoke("audio:read", filePath),
  openTextFile: () => ipcRenderer.invoke("text:open"),
  saveTextFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("text:save", defaultPath, content),
  saveProjectFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("text:saveAsTxt", defaultPath, content),
  getFilePath: (title: string) => ipcRenderer.invoke("file:path", title),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  toggleDevTools: () => ipcRenderer.invoke("dev:tools"),
  writeProjectFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("text:write", filePath, content),
  computeMd5: (filePath: string) => ipcRenderer.invoke("audio:md5", filePath),
  notifyAppReady: () => ipcRenderer.invoke("app:ready"),
  readTextFile: (filePath: string) => ipcRenderer.invoke("text:read", filePath),
  recordRecent: (filePath: string) =>
    ipcRenderer.invoke("recents:add", filePath),
  getRecents: () => ipcRenderer.invoke("recents:get"),
  welcomeAction: (payload: WelcomeAction) =>
    ipcRenderer.send("welcome:action", payload),
  onMainAction,
};

contextBridge.exposeInMainWorld("api", api);
