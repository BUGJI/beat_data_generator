import {
  addTrack,
  addTypedTrack,
  removeTrack,
  renameTrack,
  setTrackLocked,
  setTrackHidden,
  addMarker,
  moveMarker,
  removeMarker,
  updateMarkerAttrs,
  updateMarkerLoop,
  addBpmPoint,
  removeBpmPoint,
  setBaseBpm,
  setOffset,
} from "../stores/project";
import { markerSelectionIds, select, closeCard } from "../stores/selection";
import { play, pause, togglePlay, stop, seekTo } from "../services/playback";
import { tempoMap } from "../services/timeline";
import {
  historyGestureBegin,
  historyGestureEnd,
  undo,
  redo,
} from "../services/history";
import { engine } from "../engine";
import { replaceAudioFromBytes } from "../services/audioIO";
import { encodeWav, sliceAudioBuffer } from "../services/audioCrop";
import { baseName } from "@shared/path";
import type { LocaText } from "@shared/plugin";
import type { LoopConfig } from "../types";
import { useProjectStore } from "../stores/project";
import { useSelectionStore } from "../stores/selection";
import { useTransportStore } from "../stores/transport";
import {
  useViewStore,
  timeToScreenX,
  screenToTime,
  timeToX,
} from "../stores/view";
import { onEvent } from "./events";
import { pluginStorageFor, flushPluginStorage } from "./storage";
import {
  uiHandleFor,
  registerTrackType,
  dropPluginTrackTypes,
  type PanelHandle,
  type BarButtonHandle,
  type PluginBarButtonDef,
  type TrackTypeDef,
} from "./registry";

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
    /** Markers on every track of the given plugin track type `<pluginId>:<id>`. */
    markersOfType: (typeKey: string) => MarkerView[];
    /** Tracks of the given plugin track type `<pluginId>:<id>`. */
    tracksOfType: (typeKey: string) => TrackView[];
    /** A single track view by id, or null when it does not exist/is hidden. */
    trackById: (id: string) => TrackView | null;
    edit: {
      addTrack: (opts?: { name?: string }) => string;
      removeTrack: (trackId: string) => void;
      renameTrack: (trackId: string, name: string) => void;
      setTrackLocked: (trackId: string, v: boolean) => void;
      setTrackHidden: (trackId: string, v: boolean) => void;
      addMarker: (opts: { trackId: string; beat: number }) => string | null;
      moveMarker: (id: string, beat: number) => boolean;
      removeMarker: (id: string) => void;
      /** Create a track of a plugin-typed kind; null when the type is unknown. */
      addTypedTrack: (typeKey: string, name?: string) => string | null;
      /** Merge changes into a marker's plugin attributes (undo aware). */
      setMarkerAttrs: (id: string, attrs: Record<string, unknown>) => void;
      /** Set a main marker's loop group config (undo aware); null clears it. */
      setMarkerLoop: (
        id: string,
        cfg: { interval: number; count: number; exclude?: number[] } | null,
      ) => void;
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

  /** Read the decoded audio and swap in a new one (used by audio tools). */
  audio: {
    /** The currently loaded decoded audio, or null when no audio is loaded. */
    getBuffer: () => AudioBuffer | null;
    /**
     * Encode an AudioBuffer to 16-bit PCM WAV bytes. When `startMs`/`endMs` are
     * given, only that span is encoded; otherwise the whole buffer.
     */
    encodeWav: (
      buffer: AudioBuffer,
      startMs?: number,
      endMs?: number,
    ) => Uint8Array;
    /**
     * Decode `bytes` and make them the current audio (waveform, relink, MD5,
     * analysis). `autoApply` defaults to false so auto-BPM/beats do not clobber
     * the user's chart after a replace.
     */
    replaceFromBytes: (
      bytes: Uint8Array,
      opts: { filePath: string; name?: string; autoApply?: boolean },
    ) => Promise<boolean>;
  };

  events: {
    on: (
      name: "project" | "selection" | "playhead" | "playing" | "view",
      cb: (payload?: unknown) => void,
    ) => () => void;
  };

  /** Read-only timeline transform, for positioning overlays in time space. */
  timeline: {
    /** Screen x (px inside the editor) of a time in ms. */
    timeToScreenX: (ms: number) => number;
    /** Time in ms at a screen x (px inside the editor). */
    screenToTime: (x: number) => number;
    /** Content x (unscrolled px) of a time in ms. */
    timeToX: (ms: number) => number;
    /** Current scroll offset, viewport size and horizontal zoom. */
    viewport: () => {
      x: number;
      y: number;
      vw: number;
      vh: number;
      pxPerSec: number;
    };
    /** Loaded audio duration in ms (0 when no audio). */
    durationMs: () => number;
  };

  ui: {
    registerAction: (def: {
      label: LocaText;
      run: () => void | Promise<void>;
    }) => () => void;
    registerPanel: (def: {
      id: string;
      title: LocaText;
      mount: (el: HTMLElement) => void | (() => void);
      /** Initial window size in px (used until the user resizes/moves it). */
      defaultWidth?: number;
      defaultHeight?: number;
      /** Lower bounds enforced while resizing. */
      minWidth?: number;
      minHeight?: number;
    }) => PanelHandle;
    registerShortcut: (def: {
      id: string;
      label: LocaText;
      combo: string;
      run: () => void | Promise<void>;
    }) => () => void;
    /** File > Import entries; the plugin reads a file and edits the project. */
    registerImporter: (def: {
      label: LocaText;
      run: () => void | Promise<void>;
    }) => () => void;
    /** Export menu entries; the plugin serializes the project to a file. */
    registerExporter: (def: {
      label: LocaText;
      run: () => void | Promise<void>;
    }) => () => void;
    /**
     * Mount a full-bleed overlay inside the timeline viewport. The container is
     * pointer-events:none; interactive children must opt into pointer-events
     * and stopPropagation so the canvas beneath does not also react. Return an
     * optional cleanup from `mount`.
     */
    registerTimelineOverlay: (def: {
      id: string;
      mount: (el: HTMLElement) => void | (() => void);
      z?: number;
    }) => () => void;
    /**
     * Add a quick-action button to the project bar. Toggle buttons flip their
     * pressed state on click and receive the new value in `run`; use the
     * returned handle to drive it programmatically.
     */
    registerBarButton: (def: PluginBarButtonDef) => BarButtonHandle;
    /** Show a transient toast in the editor (info/success/warning/error). */
    notify: (opts: {
      message: string;
      type?: "info" | "success" | "warning" | "error";
      durationMs?: number;
    }) => void;
    openPanel: (uid: number) => void;
    closePanel: (uid: number) => void;
  };

  system: {
    pickFile: (opts?: {
      title?: string;
      filters?: FileFilter[];
    }) => Promise<string | null>;
    saveFile: (opts: {
      title?: string;
      defaultPath?: string;
      filters?: FileFilter[];
    }) => Promise<{ canceled: boolean; filePath?: string }>;
    readText: (
      path: string,
    ) => Promise<{ canceled: boolean; filePath?: string; content?: string }>;
    writeText: (path: string, content: string) => Promise<boolean>;
    /** Read raw bytes from an absolute path; null when missing (audio export). */
    readBytes: (path: string) => Promise<Uint8Array | null>;
    /** Write raw bytes to an absolute path (audio export). */
    writeBytes: (path: string, bytes: Uint8Array) => Promise<boolean>;
    openWindow: (opts: OpenWindowOptions) => Promise<void>;
    openPluginsFolder: () => Promise<void>;
    /** Absolute filesystem path of the loaded audio, or null when none. */
    audioPath: () => string | null;
  };

  /** Register custom track types whose points share the built-in beat timeline. */
  trackTypes: {
    register: (def: TrackTypeDef) => { ok: boolean; reason?: string };
  };

  callMain: (method: string, ...args: unknown[]) => Promise<unknown>;

  /**
   * Per-plugin persistent key/value store, scoped to this plugin and saved to
   * disk by the main process. Synchronous get/set like localStorage, but kept
   * out of web storage (namespaced, survives cache clears, written to a real
   * file). Use it for panel preferences and small settings, not large data.
   */
  storage: {
    /** Read a value; returns `def` when the key is absent. */
    get: <T = unknown>(key: string, def?: T) => T;
    /** Write a value (persisted shortly after; coalesced with other writes). */
    set: (key: string, value: unknown) => void;
    remove: (key: string) => void;
    all: () => Record<string, unknown>;
    clear: () => void;
  };
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
  const project = useProjectStore();
  const selection = useSelectionStore();
  const transport = useTransportStore();
  const view = useViewStore();
  const ui = uiHandleFor(binding.id);
  const unsubs: Array<() => void> = [];
  const log = (...args: unknown[]) =>
    console.log(`[plugin:${binding.id}]`, ...args);

  const snapshot = (): ProjectView => {
    const map = tempoMap();
    const p = project;
    // hidden tracks (and their markers) are withheld from plugins.
    const hiddenSet = new Set(
      p.tracks.filter((t) => t.hidden === true).map((t) => t.id),
    );
    return {
      name: p.name,
      baseBpm: p.baseBpm,
      offsetMs: p.offsetMs,
      audioName: p.audioName,
      audioMd5: p.audioMd5,
      bpmLocked: p.bpmLocked === true,
      tracks: p.tracks
        .filter((t) => t.hidden !== true)
        .map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          locked: t.locked === true,
          hidden: t.hidden === true,
          type: (t as { type?: string }).type ?? "beat",
        })),
      markers: p.markers
        .filter((m) => !hiddenSet.has(m.trackId))
        .map((m) => {
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
      markersOfType: (typeKey) => {
        const snap = snapshot();
        const ids = new Set(
          snap.tracks.filter((t) => t.type === typeKey).map((t) => t.id),
        );
        return snap.markers.filter((m) => ids.has(m.trackId));
      },
      tracksOfType: (typeKey) =>
        snapshot().tracks.filter((t) => t.type === typeKey),
      trackById: (id) => snapshot().tracks.find((t) => t.id === id) ?? null,
      edit: {
        addTrack: (opts) => addTrack(opts?.name)?.id ?? "",
        removeTrack,
        renameTrack,
        setTrackLocked,
        setTrackHidden,
        addMarker: ({ trackId, beat }) => addMarker(trackId, beat)?.id ?? null,
        moveMarker,
        removeMarker,
        addTypedTrack: (typeKey, name) => addTypedTrack(typeKey, name),
        setMarkerAttrs: (id, attrs) => updateMarkerAttrs(id, attrs),
        setMarkerLoop: (id, cfg) => updateMarkerLoop(id, cfg),
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
        kind: selection.selected.kind,
        id: selection.selected.id,
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
      positionMs: () => transport.positionMs,
      durationMs: () => engine.durationMs(),
      playing: () => transport.playing,
      rate: () => transport.rate,
    },

    audio: {
      getBuffer: () => engine.sourceBuffer,
      encodeWav: (buffer, startMs, endMs) =>
        encodeWav(
          typeof startMs === "number" && typeof endMs === "number"
            ? sliceAudioBuffer(buffer, startMs, endMs)
            : buffer,
        ),
      replaceFromBytes: (bytes, opts) =>
        replaceAudioFromBytes(bytes, {
          path: opts.filePath,
          name: opts.name ?? baseName(opts.filePath),
          adopt: true,
          autoApply: opts.autoApply ?? false,
        }),
    },

    events: {
      on: (name, cb) => {
        const off = onEvent(name, cb);
        unsubs.push(off);
        return off;
      },
    },

    timeline: {
      timeToScreenX: (ms) => timeToScreenX(ms),
      screenToTime: (x) => screenToTime(x),
      timeToX: (ms) => timeToX(ms),
      viewport: () => ({
        x: view.x,
        y: view.y,
        vw: view.vw,
        vh: view.vh,
        pxPerSec: view.pxPerSec,
      }),
      durationMs: () => engine.durationMs(),
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
      readBytes: (path) => window.api.readBinaryFile(path),
      writeBytes: (path, bytes) => window.api.writeBinaryFile(path, bytes),
      openWindow: (opts) => window.api.openWindow(opts),
      openPluginsFolder: () => window.api.openPluginsFolder(),
      /** absolute filesystem path of the currently loaded audio, or null. */
      audioPath: () => project.audioPath,
    },

    callMain: (method, ...args) =>
      window.api.invokePlugin(binding.id, method, args),

    storage: pluginStorageFor(binding.id),

    trackTypes: {
      register: (def) => registerTrackType(binding.id, def),
    },
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
    dropPluginTrackTypes(binding.id);
    // make sure any debounced api.storage writes are on disk before unload
    flushPluginStorage(binding.id);
  };

  return { api, finalize };
}
