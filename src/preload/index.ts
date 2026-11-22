import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC, type IpcApi, type WelcomeAction } from "../shared/ipc";
import type { MarketProgress } from "../shared/market";

type RequestMethod = Exclude<
  keyof IpcApi,
  | "welcomeAction"
  | "onMainAction"
  | "onPluginsChanged"
  | "onMarketProgress"
  | "setDirty"
  | "onQuitRequest"
>;

/**
 * Request/response channels are derived from the shared `IPC` table, whose keys
 * mirror `IpcApi` method names. Only the push channels and `setDirty` are
 * excluded, plus the `writeTextFile` alias (it reuses `writeProjectFile`'s
 * handler, which has the same signature). Adding a method now only needs a
 * shared entry instead of a third hand-written table here.
 */
const EVENT_CHANNEL_KEYS = new Set<string>([
  "welcomeAction",
  "pluginChanged",
  "marketProgress",
  "quitRequest",
]);

const REQUEST_CHANNELS = (() => {
  const out: Record<string, string> = {};
  for (const [key, channel] of Object.entries(IPC)) {
    if (key === "setDirty" || EVENT_CHANNEL_KEYS.has(key)) continue;
    out[key] = channel;
  }
  out.writeTextFile = IPC.writeProjectFile;
  return out as Record<RequestMethod, string>;
})();

function onMainAction(cb: (payload: WelcomeAction) => void): () => void {
  const listener = (_e: unknown, payload: WelcomeAction): void => cb(payload);
  ipcRenderer.on(IPC.welcomeAction, listener);
  return () => ipcRenderer.removeListener(IPC.welcomeAction, listener);
}

function onMarketProgress(cb: (p: MarketProgress) => void): () => void {
  const listener = (_e: unknown, payload: MarketProgress): void => cb(payload);
  ipcRenderer.on(IPC.marketProgress, listener);
  return () => ipcRenderer.removeListener(IPC.marketProgress, listener);
}

function onPluginsChanged(cb: () => void): () => void {
  const listener = (): void => cb();
  ipcRenderer.on(IPC.pluginChanged, listener);
  return () => ipcRenderer.removeListener(IPC.pluginChanged, listener);
}

function onQuitRequest(cb: () => void): () => void {
  const listener = (): void => cb();
  ipcRenderer.on(IPC.quitRequest, listener);
  return () => ipcRenderer.removeListener(IPC.quitRequest, listener);
}

const requestApi = Object.fromEntries(
  (Object.keys(REQUEST_CHANNELS) as RequestMethod[]).map((method) => [
    method,
    (...args: unknown[]) =>
      ipcRenderer.invoke(REQUEST_CHANNELS[method], ...args),
  ]),
) as Record<string, (...args: unknown[]) => Promise<unknown>>;

const api = {
  ...requestApi,
  welcomeAction: (payload: WelcomeAction) =>
    ipcRenderer.send(IPC.welcomeAction, payload),
  onMainAction,
  onPluginsChanged,
  onMarketProgress,
  setDirty: (dirty: boolean) => ipcRenderer.send(IPC.setDirty, dirty),
  onQuitRequest,
  // Local-only helper: a dropped File is resolved to its absolute path so the
  // renderer can hand it to the normal read-audio / open-project IPC calls.
  getPathForFile: (file: unknown): string => {
    try {
      return webUtils.getPathForFile(file as never);
    } catch {
      return "";
    }
  },
} as unknown as IpcApi;

contextBridge.exposeInMainWorld("api", api);
