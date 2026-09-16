import { watch } from "vue";
import { useProjectStore } from "../stores/project";
import { useSelectionStore } from "../stores/selection";
import { useTransportStore } from "../stores/transport";

/**
 * Thin event bus the plugin API subscribes to. Events are emitted from a few
 * central watchers so individual plugins do not each attach their own deep
 * watchers to the whole project state.
 *
 * Events: "project" | "selection" | "playhead" | "playing"
 *
 * The watchers read Pinia stores, so they are installed by
 * `initPluginEvents()` once Pinia is active (see services/bootstrap.ts).
 */

type Handler = (payload?: unknown) => void;

const listeners = new Map<string, Set<Handler>>();

function emit(name: string, payload?: unknown): void {
  const set = listeners.get(name);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[plugin-events] ${name} handler error`, err);
    }
  }
}

export function onEvent(name: string, cb: Handler): () => void {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

let installed = false;

export function initPluginEvents(): void {
  if (installed) return;
  installed = true;
  const project = useProjectStore();
  const selection = useSelectionStore();
  const transport = useTransportStore();

  let projectQueued = false;
  watch(
    () => project,
    () => {
      if (projectQueued) return;
      projectQueued = true;
      queueMicrotask(() => {
        projectQueued = false;
        emit("project");
      });
    },
    { deep: true },
  );

  let selectionQueued = false;
  watch(
    () => ({
      kind: selection.selected.kind,
      id: selection.selected.id,
      multi: [...selection.multi],
    }),
    () => {
      if (selectionQueued) return;
      selectionQueued = true;
      queueMicrotask(() => {
        selectionQueued = false;
        emit("selection");
      });
    },
  );

  watch(
    () => transport.positionMs,
    (ms) => emit("playhead", ms),
  );

  watch(
    () => transport.playing,
    (playing) => emit("playing", playing),
  );
}
