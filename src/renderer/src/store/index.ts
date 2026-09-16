/**
 * Backwards-compatible barrel for the old monolithic store.
 *
 * State now lives in Pinia stores (see `stores/`) and orchestration lives in
 * `services/`. Importing state directly is no longer possible — components
 * should call `useProjectStore()` / `useTransportStore()` / ... and reach
 * actions through this barrel only for the function API.
 */
export * from "../stores/project";
export * from "../stores/selection";
export * from "../stores/transport";
export * from "../stores/view";
export * from "../stores/settings";
export * from "../stores/ui";

export * from "../services/timeline";
export * from "../services/history";
export * from "../services/clipboard";
export * from "../services/playback";
export * from "../services/audioIO";
export * from "../services/projectIO";
export * from "../services/bootstrap";
