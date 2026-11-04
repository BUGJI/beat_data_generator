import { dialog, shell } from "electron";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import type {
  AudioFileResult,
  IpcFileFilter,
  MetronomeFile,
  SaveResult,
  TextFileResult,
} from "../../shared/ipc";
import { dirName } from "../../shared/path";
import {
  AUDIO_FILTERS,
  bytesToAudioResult,
  EDL_FILTERS,
  IMAGE_MIME,
  MAX_IMAGE_BYTES,
  PROJECT_FILTERS,
  sanitizeFilters,
  TEXT_FILTERS,
} from "../files";
import { handle } from "../ipcHandle";
import { mt } from "../i18n";
import { joinDefaultDir, lastDirDefault, rememberDir } from "../lastDirs";
import log from "../logger";
import { listMetronomeFiles, metronomeDir } from "../metronome";
import { win } from "../windows";

/** File dialogs, audio / text / binary IO and metronome assets. */
export function installFileIpc(): void {
  handle("openAudio", async (): Promise<AudioFileResult | null> => {
    const w = win();
    if (!w) return null;
    const r = await dialog.showOpenDialog(w, {
      title: mt("openAudio"),
      defaultPath: lastDirDefault("audio"),
      filters: AUDIO_FILTERS,
      properties: ["openFile"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    rememberDir("audio", r.filePaths[0]);
    return bytesToAudioResult(r.filePaths[0], true);
  });

  handle(
    "readAudioFile",
    async (_e, filePath: string): Promise<AudioFileResult | null> => {
      try {
        return await bytesToAudioResult(filePath, true);
      } catch {
        return null;
      }
    },
  );

  handle("listMetronomes", (): MetronomeFile[] => listMetronomeFiles());

  handle("openMetronomeFolder", async (): Promise<void> => {
    const dir = metronomeDir();
    mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });

  handle(
    "readMetronome",
    async (_e, file: string): Promise<AudioFileResult | null> => {
      if (typeof file !== "string" || !file) return null;
      // New selections are file names inside the metronome folder; absolute
      // paths are still accepted so older settings keep working.
      const full = isAbsolute(file)
        ? file
        : join(metronomeDir(), basename(file));
      try {
        return await bytesToAudioResult(full);
      } catch {
        return null;
      }
    },
  );

  handle("openTextFile", async (): Promise<TextFileResult> => {
    const w = win();
    if (!w) return { canceled: true };
    const r = await dialog.showOpenDialog(w, {
      title: mt("openProject"),
      defaultPath: lastDirDefault("project"),
      filters: PROJECT_FILTERS,
      properties: ["openFile"],
    });
    if (r.canceled || r.filePaths.length === 0) return { canceled: true };
    rememberDir("project", r.filePaths[0]);
    try {
      const content = await readFile(r.filePaths[0], "utf-8");
      return { canceled: false, filePath: r.filePaths[0], content };
    } catch (err) {
      log.error("open project failed", err);
      return { canceled: true };
    }
  });

  async function saveViaDialog(
    kind: "audio" | "project" | "export",
    title: string,
    defaultPath: string,
    filters: Electron.FileFilter[],
    content: string,
  ): Promise<SaveResult> {
    const w = win();
    if (!w) return { canceled: true };
    const memKind = kind === "export" ? "project" : kind;
    const dirFromPath = dirName(defaultPath);
    const proposed =
      memKind === "project"
        ? joinDefaultDir(memKind as "project", defaultPath, dirFromPath)
        : defaultPath;
    const r = await dialog.showSaveDialog(w, {
      title,
      defaultPath: proposed,
      filters,
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    if (kind !== "export") rememberDir(kind as "audio" | "project", r.filePath);
    await writeFile(r.filePath, content, "utf-8");
    return { canceled: false, filePath: r.filePath };
  }

  handle(
    "saveTextFile",
    async (_e, defaultPath: string): Promise<SaveResult> => {
      // show the save dialog only; the caller writes afterwards so it can store
      // an audio name that is relative to the finally chosen folder.
      const dirFromPath = dirName(defaultPath);
      const proposed = joinDefaultDir("project", defaultPath, dirFromPath);
      const w = win();
      if (!w) return { canceled: true };
      const r = await dialog.showSaveDialog(w, {
        title: mt("saveProject"),
        defaultPath: proposed,
        filters: PROJECT_FILTERS,
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      rememberDir("project", r.filePath);
      return { canceled: false, filePath: r.filePath };
    },
  );

  handle(
    "saveProjectFile",
    (_e, defaultPath: string, content: string): Promise<SaveResult> =>
      saveViaDialog(
        "export",
        mt("exportTimestamps"),
        defaultPath,
        TEXT_FILTERS,
        content,
      ),
  );

  handle(
    "saveEDLFile",
    (_e, defaultPath: string, content: string): Promise<SaveResult> =>
      saveViaDialog(
        "export",
        mt("exportEdl"),
        defaultPath,
        EDL_FILTERS,
        content,
      ),
  );

  handle(
    "readTextFile",
    async (_e, filePath: string): Promise<TextFileResult> => {
      try {
        const content = await readFile(filePath, "utf-8");
        return { canceled: false, filePath, content };
      } catch {
        return { canceled: true };
      }
    },
  );

  handle(
    "writeProjectFile",
    async (_e, filePath: string, content: string): Promise<boolean> => {
      try {
        await writeFile(filePath, content, "utf-8");
        return true;
      } catch {
        return false;
      }
    },
  );

  handle(
    "readBinaryFile",
    async (_e, filePath: string): Promise<Uint8Array | null> => {
      try {
        const buf = await readFile(filePath);
        return new Uint8Array(buf);
      } catch {
        return null;
      }
    },
  );

  handle(
    "writeBinaryFile",
    async (_e, filePath: string, data: Uint8Array): Promise<boolean> => {
      if (typeof filePath !== "string" || !filePath) return false;
      if (!(data instanceof Uint8Array)) return false;
      try {
        await writeFile(filePath, data);
        return true;
      } catch {
        return false;
      }
    },
  );

  handle("computeMd5", async (_e, filePath: string): Promise<string | null> => {
    try {
      const buf = await readFile(filePath);
      return createHash("md5").update(buf).digest("hex");
    } catch {
      return null;
    }
  });

  handle("getFilePath", async (_e, title: string): Promise<string | null> => {
    const w = win();
    if (!w) return null;
    const r = await dialog.showOpenDialog(w, {
      title,
      defaultPath: lastDirDefault("audio"),
      filters: AUDIO_FILTERS,
      properties: ["openFile"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    rememberDir("audio", r.filePaths[0]);
    return r.filePaths[0];
  });

  handle(
    "readImageAsDataUrl",
    async (_e, filePath: string): Promise<string | null> => {
      if (typeof filePath !== "string" || !filePath) return null;
      const mime = IMAGE_MIME[extname(filePath).toLowerCase()];
      if (!mime) return null;
      try {
        const buf = await readFile(filePath);
        if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES)
          return null;
        return `data:${mime};base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    },
  );

  handle(
    "pickFile",
    async (
      _e,
      title: string,
      filters: IpcFileFilter[],
    ): Promise<string | null> => {
      const w = win();
      if (!w) return null;
      const r = await dialog.showOpenDialog(w, {
        title: typeof title === "string" && title ? title : "Open file",
        defaultPath: lastDirDefault("audio") ?? undefined,
        filters: sanitizeFilters(filters),
        properties: ["openFile"],
      });
      if (r.canceled || r.filePaths.length === 0) return null;
      return r.filePaths[0];
    },
  );

  handle(
    "saveFileDialog",
    async (
      _e,
      title: string,
      defaultPath: string,
      filters: IpcFileFilter[],
    ): Promise<SaveResult> => {
      const w = win();
      if (!w) return { canceled: true };
      const r = await dialog.showSaveDialog(w, {
        title: typeof title === "string" && title ? title : "Save file",
        defaultPath:
          typeof defaultPath === "string" && defaultPath
            ? defaultPath
            : "untitled",
        filters: sanitizeFilters(filters),
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      return { canceled: false, filePath: r.filePath };
    },
  );
}
