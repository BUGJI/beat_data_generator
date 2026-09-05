import {
  store,
  tempoMap,
  addTrack,
  removeTrack,
  renameTrack,
  setTrackLocked,
  setTrackHidden,
  addMarker,
  moveMarker,
  removeMarker,
  addBpmPoint,
  removeBpmPoint,
  setBaseBpm,
  setOffset,
  markerSelectionIds,
  play,
  pause,
  togglePlay,
  stop,
  seekTo,
  select,
  closeCard,
  historyGestureBegin,
  historyGestureEnd,
  undo,
  redo,
} from "../store";
import { engine } from "../engine";
import type { LoopConfig } from "../types";
import { onEvent } from "./events";
import { uiHandleFor, type PanelHandle } from "./registry";

/**
 * The object handed to every plugin's activate(api). It is the only surface a
 * plugin gets: read project data (beat and time view), edit through the undo
 * aware editing api, control playback, subscribe to editor events, reach the
 * main process (own main.js handlers or generic services), and contribute UI.
 */

export interface TrackView {
  id: string;
  name: string;
  color: string;
  locked: boolean;
  hidden: boolean;
  type: string;
}

export interface MarkerView {
  id: string;
  trackId: string;
  beat: number;
  timeMs: number;
  parentId?: string;
  loop?: LoopConfig | null;
  attrs?: Record<string, unknown>;
}

export interface BpmView {
  id: string;
  beat: number;
  mode: "abs" | "mult";
  value: number;
}

export interface ProjectView {
  name: string;
  baseBpm: number;
  offsetMs: number;
  audioName: string | null;
  audioMd5: string | null;
  bpmLocked: boolean;
  tracks: TrackView[];
  markers: MarkerView[];
  bpmPoints: BpmView[];
}

export interface SelectionView {
  kind: "marker" | "bpm" | null;
  id: string | null;
  markerIds: string[];
}

export type FileFilter = { name: string; extensions: string[] };

export interface OpenWindowOptions {
  url: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface PluginApi {
  readonly id: string;
  readonly version: string;
  readonly dir: string;
  log: (...args: unknown[]) => void;

  project: {
    snapshot: () => ProjectView;
    bpmAtBeat: (beat: number) => number;
    bpmAtTime: (ms: number) => number;
    timeOfBeat: (beat: number) => number;
    beatOfTime: (ms: number) => number;
    edit: {
      addTrack: (opts?: { name?: string }) => string;
      removeTrack: (trackId: string) => void;
      renameTrack: (trackId: string, name: string) => void;
      setTrackLocked: (trackId: string, v: boolean) => void;
      setTrackHidden: (trackId: string, v: boolean) => void;
      addMarker: (opts: {
        trackId: string;
        beat: number;
      }) => string | null;
      moveMarker: (id: string, beat: number) => boolean;
      removeMarker: (id: string) => void;
      addBpmPoint: (beat: number) => string | null;
      removeBpmPoint: (id: string) => void;
      setBaseBpm: (v: number) => void;
      setOffset: (v: number) => void;
      /** Wrap several edits in a single undo step. */
      batch: (fn: () => void) => void;
      undo: () => void;
      redo: () => void;
    };
  };

  selection: {
    current: () => SelectionView;
    selectMarker: (id: string) => void;
    selectBpm: (id: string) => void;
    clear: () => void;
  };

  player: {
    play: () => void;
    pause: () => void;
    togglePlay: () => void;
    stop: () => void;
    seekTo: (ms: number) => void;
    positionMs: () => number;
    durationMs: () => number;
    playing: () => boolean;
    rate: () => number;
  };

  events: {
    on: (name: "project" | "selection" | "playhead" | "playing", cb: (payload?: unknown) => void) => () => void;
  };

  ui: {
    registerAction: (def: { label: string | Record<string, string>; run: () => void | Promise<void> }) => () => void;
    registerPanel: (def: {
      id: string;
      title: string | Record<string, string>;
      mount: (el: HTMLElement) => void | (() => void);
    }) => PanelHandle;
    registerShortcut: (def: {
      id: string;
      label: string | Record<string, string>;
      combo: string;
      run: () => void | Promise<void>;
    }) => () => void;
    openPanel: (uid: number) => void;
    closePanel: (uid: number) => void;
  };

  system: {
    pickFile: (opts?: { title?: string; filters?: FileFilter[] }) => Promise<string | null>;
    saveFile: (opts: {
      title?: string;
      defaultPath?: string;
      filters?: FileFilter[];
    }) => Promise<{ canceled: boolean; filePath?: string }>;
    readText: (path: string) => Promise<{ canceled: boolean; filePath?: string; content?: string }>;
    writeText: (path: string, content: string) => Promise<boolean>;
    openWindow: (opts: OpenWindowOptions) => Promise<void>;
    openPluginsFolder: () => Promise<void>;
  };

  callMain: (method: string, ...args: unknown[]) => Promise<unknown>;
}

export interface PluginBinding {
  id: string;
  version: string;
  dir: string;
}

function clampMarkerLoop(l?: LoopConfig | null): LoopConfig | null {
  if (!l) return null;
  return {
    interval: l.interval,
    count: l.count,
    ...(l.exclude?.length ? { exclude: [...l.exclude] } : {}),
  };
}

export function createPluginApi(binding: PluginBinding): {
  api: PluginApi;
  finalize: () => void;
} {
  const ui = uiHandleFor(binding.id);
  const unsubs: Array<() => void> = [];
  const log = (...args: unknown[]) =>
    console.log(`[plugin:${binding.id}]`, ...args);

  const snapshot = (): ProjectView => {
    const map = tempoMap();
    const p = store.project;
    return {
      name: p.name,
      baseBpm: p.baseBpm,
      offsetMs: p.offsetMs,
      audioName: p.audioName,
      audioMd5: p.audioMd5,
      bpmLocked: p.bpmLocked === true,
      tracks: p.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        locked: t.locked === true,
        hidden: t.hidden === true,
        type: (t as { type?: string }).type ?? "beat",
      })),
      markers: p.markers.map((m) => {
        const out: MarkerView = {
          id: m.id,
          trackId: m.trackId,
          beat: m.beat,
          timeMs: map.timeOfBeat(m.beat),
        };
        if (m.parentId) out.parentId = m.parentId;
        const loop = clampMarkerLoop(m.loop);
        if (loop) out.loop = loop;
        const attrs = (m as { attrs?: Record<string, unknown> }).attrs;
        if (attrs) out.attrs = { ...attrs };
        return out;
      }),
      bpmPoints: p.bpmPoints.map((b) => ({
        id: b.id,
        beat: b.beat,
        mode: b.mode,
        value: b.value,
      })),
    };
  };

  const api: PluginApi = {
    id: binding.id,
    version: binding.version,
    dir: binding.dir,
    log,

    project: {
      snapshot,
      bpmAtBeat: (b) => tempoMap().bpmAtBeat(b),
      bpmAtTime: (ms) => tempoMap().bpmAtTime(ms),
      timeOfBeat: (b) => tempoMap().timeOfBeat(b),
      beatOfTime: (ms) => tempoMap().beatOfTime(ms),
      edit: {
        addTrack: (opts) => addTrack(opts?.name)?.id ?? "",
        removeTrack,
        renameTrack,
        setTrackLocked,
        setTrackHidden,
        addMarker: ({ trackId, beat }) => addMarker(trackId, beat)?.id ?? null,
        moveMarker,
        removeMarker,
        addBpmPoint: (beat) => addBpmPoint(beat)?.id ?? null,
        removeBpmPoint,
        setBaseBpm,
        setOffset,
        batch: (fn) => {
          historyGestureBegin();
          try {
            fn();
          } finally {
            historyGestureEnd();
          }
        },
        undo,
        redo,
      },
    },

    selection: {
      current: () => ({
        kind: store.ui.selected.kind,
        id: store.ui.selected.id,
        markerIds: markerSelectionIds(),
      }),
      selectMarker: (id) => {
        select("marker", id);
      },
      selectBpm: (id) => {
        select("bpm", id);
      },
      clear: () => closeCard(),
    },

    player: {
      play,
      pause,
      togglePlay,
      stop,
      seekTo,
      positionMs: () => store.ui.positionMs,
      durationMs: () => engine.durationMs(),
      playing: () => store.ui.playing,
      rate: () => store.ui.rate,
    },

    events: {
      on: (name, cb) => {
        const off = onEvent(name, cb);
        unsubs.push(off);
        return off;
      },
    },

    ui,

    system: {
      pickFile: (opts) =>
        window.api.pickFile(opts?.title ?? "Open file", opts?.filters ?? []),
      saveFile: (opts) =>
        window.api.saveFileDialog(
          opts.title ?? "Save file",
          opts.defaultPath ?? "untitled",
          opts.filters ?? [],
        ),
      readText: (path) => window.api.readTextFile(path),
      writeText: (path, content) => window.api.writeTextFile(path, content),
      openWindow: (opts) => window.api.openWindow(opts),
      openPluginsFolder: () => window.api.openPluginsFolder(),
    },

    callMain: (method, ...args) =>
      window.api.invokePlugin(binding.id, method, args),
  };

  const finalize = (): void => {
    for (const off of [...unsubs]) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    unsubs.length = 0;
    ui.dispose();
  };

  return { api, finalize };
}
