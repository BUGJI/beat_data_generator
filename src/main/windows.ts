import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import type { WelcomeAction } from "../shared/ipc";
import { PROJECT_FILTERS } from "./files";
import { mt } from "./i18n";
import { lastDirDefault, rememberDir } from "./lastDirs";
import log from "./logger";
import { appTitle, getSettings } from "./settings";
import { loadWindowState, saveWindowState } from "./windowState";

/**
 * Owns the main and welcome windows, the dialogs they open, and the
 * welcome-action handoff. Feature code asks for the current window through
 * {@link win} instead of touching BrowserWindow state directly.
 */

let mainWindow: BrowserWindow | null = null;
let welcomeWindow: BrowserWindow | null = null;
let mainReady = false;
let allowQuit = false;
let welcomeCreated = false;
let welcomeDialogOpen = false;
let welcomeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWelcome: WelcomeAction[] = [];

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function isQuitAllowed(): boolean {
  return allowQuit;
}

/**
 * The window dialogs should attach to: the main window when it is alive, else
 * the focused window, else any window. Preferring `mainWindow` avoids attaching
 * a dialog to the welcome / a plugin window when those happen to be enumerated
 * first.
 */
export function win(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return (
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  );
}

export function closeDevToolsAll(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.closeDevTools();
}

export function refreshWindowTitles(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(appTitle());
  if (welcomeWindow && !welcomeWindow.isDestroyed())
    welcomeWindow.setTitle(appTitle());
}

function deliverWelcomeAction(action: WelcomeAction): void {
  if (mainReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("welcome:action", action);
  } else {
    pendingWelcome.push(action);
  }
}

export function markMainReady(): void {
  mainReady = true;
  if (pendingWelcome.length) {
    const pending = pendingWelcome.splice(0, pendingWelcome.length);
    for (const payload of pending) deliverWelcomeAction(payload);
  }
}

/** Route a welcome-window action to the editor, closing the welcome first. */
export function handleWelcomeAction(payload: WelcomeAction): void {
  if (!(payload && typeof payload === "object" && "type" in payload)) {
    welcomeWindow?.close();
    welcomeWindow = null;
    mainWindow?.focus();
    return;
  }
  // close & focus first so any native dialog never stacks under the welcome
  welcomeWindow?.close();
  welcomeWindow = null;
  mainWindow?.focus();
  if (welcomeDialogOpen) return;
  if (payload.type === "new") {
    // keep the save dialog in main: guaranteed to appear, defaults to the last
    // used project folder and remembers the new one on success.
    welcomeDialogOpen = true;
    void showNewProjectDialog()
      .then((path) => {
        if (path) deliverWelcomeAction({ type: "new", path });
      })
      .finally(() => {
        welcomeDialogOpen = false;
      });
    return;
  }
  if (payload.type === "open") {
    // the open picker is also main-side so it always shows, even if the
    // renderer has not mounted / bound its welcome listener yet.
    welcomeDialogOpen = true;
    void showOpenProjectDialog()
      .then((path) => {
        if (path) deliverWelcomeAction({ type: "open", path });
      })
      .finally(() => {
        welcomeDialogOpen = false;
      });
    return;
  }
  // recent -> the renderer reads that file itself
  deliverWelcomeAction(payload);
}

/** Native "Save new project" dialog. Returns chosen path or null when cancelled. */
export async function showNewProjectDialog(): Promise<string | null> {
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : win();
  if (!w || w.isDestroyed()) return null;
  const base = "untitled.bdg";
  const dir = lastDirDefault("project");
  const r = await dialog.showSaveDialog(w, {
    title: mt("saveNewProject"),
    defaultPath: dir ? join(dir, base) : base,
    filters: PROJECT_FILTERS,
  });
  if (r.canceled || !r.filePath) return null;
  rememberDir("project", r.filePath);
  return r.filePath;
}

/** Native "Open project" dialog. Returns chosen path or null when cancelled. */
export async function showOpenProjectDialog(): Promise<string | null> {
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : win();
  if (!w || w.isDestroyed()) return null;
  const r = await dialog.showOpenDialog(w, {
    title: mt("openProject"),
    defaultPath: lastDirDefault("project"),
    filters: PROJECT_FILTERS,
    properties: ["openFile"],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  rememberDir("project", r.filePaths[0]);
  return r.filePaths[0];
}

export function requestQuit(w: BrowserWindow): void {
  const mode = getSettings().closeMode;
  if (mode === "close") {
    allowQuit = true;
    app.quit();
    return;
  }
  if (mode === "minimize") {
    if (!w.isMinimized()) w.minimize();
    return;
  }
  // ask
  void dialog
    .showMessageBox(w, {
      type: "question",
      title: appTitle(),
      message: mt("quitMessage", { name: appTitle() }),
      detail: "",
      buttons: [mt("quitButton"), mt("cancelButton")],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 0) {
        allowQuit = true;
        app.quit();
      }
    });
}

function scheduleWelcomeWindow(): void {
  if (welcomeCreated || !getSettings().showWelcome) return;
  const poll = setInterval(() => {
    if (mainReady) {
      clearInterval(poll);
      if (welcomeFallbackTimer) {
        clearTimeout(welcomeFallbackTimer);
        welcomeFallbackTimer = null;
      }
      createWelcomeWindow();
    }
  }, 200);
  welcomeFallbackTimer = setTimeout(() => {
    clearInterval(poll);
    welcomeFallbackTimer = null;
    createWelcomeWindow();
  }, 5000);
}

function createWelcomeWindow(): void {
  if (welcomeCreated || welcomeWindow) return;
  welcomeCreated = true;
  welcomeWindow = new BrowserWindow({
    width: 660,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#101318",
    title: appTitle(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
    },
  });
  welcomeWindow.on("closed", () => {
    welcomeWindow = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    welcomeWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/welcome.html`);
  } else {
    welcomeWindow.loadFile(join(__dirname, "../renderer/welcome.html"));
  }
}

export function createWindow(): void {
  const remember = getSettings().rememberWindow;
  const state = loadWindowState(remember);
  mainWindow = new BrowserWindow({
    x: state?.x,
    y: state?.y,
    width: state?.width ?? 1360,
    height: state?.height ?? 860,
    minWidth: 1024,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#15181c",
    title: appTitle(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      // Restore the persisted interface zoom (setZoomFactor keeps it applied
      // for the lifetime of the window; the renderer updates it at runtime).
      zoomFactor: Math.min(1.5, Math.max(0.75, getSettings().uiZoom / 100)),
      // Keep rAF/timers alive while minimized so playback-driven work (metronome
      // clicks, follow scroll, beat flashes) keeps running instead of pausing
      // and then firing everything at once on restore.
      backgroundThrottling: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    if (state?.maximized) mainWindow?.maximize();
    scheduleWelcomeWindow();
  });

  mainWindow.on("close", (e) => {
    if (mainWindow && allowQuit)
      saveWindowState(mainWindow, getSettings().rememberWindow);
    if (allowQuit || !mainWindow) return;
    e.preventDefault();
    requestQuit(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  mainWindow.webContents.on(
    "render-process-gone",
    (_e, details: { reason: string; exitCode: number }) => {
      log.error(
        `renderer gone: reason=${details.reason} exitCode=${details.exitCode}`,
      );
    },
  );

  // Route renderer console output into the log file even in production, so a
  // build without DevTools still leaves a trail. Handles both the legacy
  // (event, level, message) and current (event, details) payloads.
  mainWindow.webContents.on("console-message", ((...args: unknown[]) => {
    const arg = args[1] as
      | { level?: string | number; message?: string }
      | number
      | undefined;
    let level: string | number | undefined;
    let message: string;
    if (arg && typeof arg === "object" && "message" in arg) {
      level = arg.level ?? undefined;
      message = arg.message ?? "";
    } else {
      level = arg as number | undefined;
      message = String(args[2] ?? "");
    }
    const text = `[renderer] ${String(message)}`;
    if (level === 3 || level === "error") log.error(text);
    else if (level === 2 || level === "warning") log.warn(text);
    else if (!app.isPackaged) log.info(text);
  }) as (event: unknown, level: number, message: string) => void);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
