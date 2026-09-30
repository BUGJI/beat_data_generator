import { describe, expect, it } from "vitest";
import { IPC } from "./ipc";

/**
 * Guards the shared IPC channel table against accidental drift: adding or
 * removing a channel (or renaming one) must be a deliberate, reviewed change.
 */

const EXPECTED_KEYS = [
  "openAudio",
  "readAudioFile",
  "openTextFile",
  "saveTextFile",
  "saveProjectFile",
  "saveEDLFile",
  "readTextFile",
  "writeProjectFile",
  "writeTextFile",
  "getFilePath",
  "getSettings",
  "updateSettings",
  "checkForUpdates",
  "toggleDevTools",
  "setZoom",
  "computeMd5",
  "listMetronomes",
  "openMetronomeFolder",
  "readMetronome",
  "notifyAppReady",
  "readImageAsDataUrl",
  "recordRecent",
  "getRecents",
  "listPlugins",
  "setPluginEnabled",
  "reloadPlugins",
  "readPluginRenderer",
  "openPluginsFolder",
  "invokePlugin",
  "marketList",
  "marketRefresh",
  "marketInstall",
  "marketUninstall",
  "installPluginZip",
  "pingHost",
  "pickFile",
  "saveFileDialog",
  "openWindow",
  "writeClipboard",
  "setDirty",
  "confirmQuit",
  "welcomeAction",
  "pluginChanged",
  "marketProgress",
  "quitRequest",
];

describe("IPC channel table", () => {
  it("exposes exactly the known channels", () => {
    expect(Object.keys(IPC).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("uses non-empty string channel names", () => {
    for (const [key, channel] of Object.entries(IPC)) {
      expect(typeof channel, key).toBe("string");
      expect(channel.length, key).toBeGreaterThan(0);
    }
  });

  it("keeps channel values unique, except the documented write alias", () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length - 1);
    expect(IPC.writeTextFile).toBe(IPC.writeProjectFile);
  });

  it("pins the channel strings the two processes agree on", () => {
    expect(IPC.getSettings).toBe("settings:get");
    expect(IPC.updateSettings).toBe("settings:update");
    expect(IPC.marketInstall).toBe("plugins:market:install");
    expect(IPC.invokePlugin).toBe("plugins:invoke");
    expect(IPC.welcomeAction).toBe("welcome:action");
    expect(IPC.marketProgress).toBe("plugin:market:progress");
  });
});
