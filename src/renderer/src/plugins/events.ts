import { watch } from "vue";
import { store } from "../store";

/**
 * Thin event bus the plugin API subscribes to. Events are emitted from a few
 * central watchers so individual plugins do not each attach their own deep
 * watchers to the whole project state.
 *
 * Events: "project" | "selection" | "playhead" | "playing"
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

let projectQueued = false;
watch(
  () => store.project,
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
    kind: store.ui.selected.kind,
    id: store.ui.selected.id,
    multi: [...store.ui.multi],
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
  () => store.ui.positionMs,
  (ms) => emit("playhead", ms),
);

watch(
  () => store.ui.playing,
  (playing) => emit("playing", playing),
);
