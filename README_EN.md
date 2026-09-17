# Beat Data Generator

> Author: **BUGJI** · License: **GNU GPL v3**

A music beat-marker editor built with **Electron + Vue 3 + TypeScript + Tailwind CSS**. Align a beat grid over an audio waveform, place beat markers and BPM change points, and generate beat data for rhythm-based applications.

## Features

- **Audio import**: mp3 / wav / ogg / flac / m4a / aac / opus, with real-time waveform rendering.
- **Audio intelligence**: on load, auto-detect BPM, place beat markers, find the best looping segment, and keep a live BPM readout plus a mel spectrogram in a collapsible analysis panel. Powered by **pleco-xa**, computed asynchronously in a Web Worker; each capability is an independent toggle in Settings.
- **Beat grid**: dual ruler (time + beat). Snapping from 1 to 1/32 beat subdivisions.
- **BPM lane**: add BPM points (absolute BPM or multiplier modes) to build a tempo map; supports locking the BPM lane.
- **Multiple marker tracks**: add / rename / recolor / lock / hide tracks. Markers on hidden tracks are excluded from the playback indicator and exports. Plugins can also register typed tracks.
- **Marker editing**: click to add, drag to fine-tune, right-click to delete; nudge by snap step, multi-select (Ctrl/Cmd+click), select all.
- **Loop groups**: a main marker can generate child markers by `interval × count`, with optional exclusion; capped at **256** children per group to keep the editor responsive.
- **Variable-speed playback**: 0.1–4× rate; choose pitch-following playback or pitch-preserving time stretch via soundtouchjs.
- **Metronome click**: plays a tick each time a marker is passed; a custom audio file can be selected (empty disables it).
- **Auto-follow**: the timeline scrolls once the playhead passes a configurable threshold.
- **Undo / redo**: up to 100 steps; copy / paste marker groups (including loops).
- **Sticky notes**: place floating notes on the timeline, edit them with double-click (Markdown).
- **Project files**: `.bdg` (JSON). Audio is referenced by a path relative to the project plus an MD5, verified / auto-relinked on open.
- **Exports**: timestamp list `.txt` (millisecond precision, de-duplicated) and **CMX3600 EDL** `.edl` (25 fps, non-drop).
- **Plugin system**: extend with new import/export formats, floating sidebar panels, custom shortcuts, standalone preview windows, and typed tracks. See `docs/plugin-system.md`.
- **Auto-save**: configurable interval (1–60 min) saves the current project in the background.
- **Theming**: 6 presets (default / midnight / forest / amber / graphite / light) with per-token color overrides, applied live.
- **Extras**: bilingual UI (中文 / English), welcome screen with recent projects, window-state memory, close-mode settings.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron |
| Build tooling | electron-vite / Vite |
| Frontend | Vue 3 + TypeScript |
| State | Pinia |
| Validation | zod (project-file / settings schemas) |
| UI | reka-ui (headless) + Tailwind CSS v4 |
| Icons | @lucide/vue |
| i18n | vue-i18n |
| Time-stretch | soundtouchjs |
| Audio intelligence | pleco-xa (async via Web Worker) |
| Waveform | Canvas (custom) |

## Project Layout

```
src/
├── main/            # Electron main process: windows, IPC, dialogs, settings/recents persistence, plugin manager
├── preload/         # Preload script (contextBridge exposes a safe API)
├── shared/          # IPC types, settings schema and plugin contract shared by main & renderer
└── renderer/        # Vue renderer
    └── src/
        ├── components/   # TopBar / SideBar / TransportBar / Timeline / SettingsModal / ProjectBar / AnalysisPanel etc.
        ├── stores/       # Pinia stores: project / selection / transport / view / settings / ui
        ├── services/     # Orchestration: timeline / history / clipboard / playback / audioIO / projectIO / bootstrap
        ├── schemas/      # zod project-file schema (v1 → v2 migration and per-item recovery)
        ├── plugins/      # Plugin host: registry / events / bridge API
        ├── i18n/         # Chinese & English strings (zh / en)
        ├── engine.ts     # Web Audio playback engine
        ├── tempo.ts      # beat↔time mapping and tempo map builder
        ├── stretch.ts    # soundtouchjs time stretch wrapper
        ├── analysis.ts   # Audio intelligence bridge (pleco-xa, async in Web Worker)
        ├── analysis.worker.ts # Analysis worker (BPM / beats / loop / spectrogram)
        ├── theme.ts      # theme presets and color-token derivation
        └── metrics.ts    # drawing metrics & palette
```

> Note: `src/renderer/src/store/index.ts` is only a re-export barrel kept for older imports; state lives in `stores/` and orchestration in `services/`.

## Development

Requires Node.js ≥ 20.19 (Vite 7's minimum) and npm.

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Preview a production build
npm start

# Build
npm run build

# Type checking
npm run typecheck

# Run tests (vitest)
npm test

# Tests in watch mode
npm run test:watch

# Test coverage
npm run test:cov
```

Tests currently cover the pure-logic layer: tempo math (`tempo.ts`), project-file parsing and recovery (`schemas/project.ts`), settings repair (`shared/settings.ts`), and undo/redo plus export formats (`services/history.ts` / `services/projectIO.ts`).

Runtime logs (electron-log) go to the terminal by default. To persist them, enable "Record logs to file" under **Settings → Developer options** (off by default): they are then written to `<userData>/logs/main.log`, rotated at 5 MB, with main-process logs plus renderer console warnings/errors funnelled into it (on Windows usually `%APPDATA%\<app name>\logs\main.log`). This helps when a packaged build has no DevTools.

Pitch-preserving off-speed playback uses `soundtouchjs` by default; switch the "Time-stretch engine" to the experimental `signalsmith-stretch` under **Settings → Developer options** for A/B comparison. Failures or timeouts fall back to SoundTouch automatically.

## Quick Start

1. Launch the app and choose **Open Audio** from the File menu; the waveform loads into the timeline.
2. Click on the **BPM lane** to add tempo points (or adjust base BPM / offset in the sidebar) to align the beat grid.
3. Click on a **marker track** to place markers (auto-snapped); drag to fine-tune.
4. Play back to verify the markers; toggle auto-follow, and audition at other speeds or with pitch-preserving stretch.
5. **Save Project** (`.bdg`) to keep markers and BPM data, or directly **Export Timestamps / EDL**.

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Ctrl+S | Save project |
| Ctrl+C / Ctrl+V | Copy / paste marker group |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Delete | Delete selected |
| ← / → | Nudge left / right by snap step (when selected) |
| Esc | Close popover / clear selection |
| Home | Go to start |
| Ctrl+wheel | Zoom timeline (when hovering it) |

## Export Formats

- **Timestamps (.txt)**: one float millisecond timestamp per line (3 decimals), de-duplicated across tracks.
- **EDL (.edl)**: CMX3600 spec, 25 fps, Non-Drop Frame; each marker produces a 1-frame event with a `FROM CLIP NAME`.

## License

This project is released under the **GNU GPL v3** license (see `LICENSE`). Author: **BUGJI**.
