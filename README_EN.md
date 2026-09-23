# <img width="24" alt="logo" src="./build/icon.png"> Beat Data Generator

**English** | [中文](README.md)

A music beat-marker editor: align a beat grid over the audio waveform, place beat markers and BPM change points, and generate beat data for rhythm-based applications. **Mark once, export to multiple targets** (see [Export & Integration Targets](#export--integration-targets)).

[![license](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![release](https://img.shields.io/github/v/release/BUGJI/beat_data_generator?include_prereleases&label=release&color=green)](https://github.com/BUGJI/beat_data_generator/releases/latest)
![node](https://img.shields.io/badge/node-%E2%89%A5%2020.19-brightgreen)

<img width="820" alt="Main window" src="https://github.com/user-attachments/assets/79314d83-6f06-4afc-9e28-ccdd6d2c1f36" />

## Download & Install

| Platform | How to install | Status |
| --- | --- | --- |
| **Windows** (x64) | Grab `Beat-Data-Generator-<version>-setup.exe` from [Releases](https://github.com/BUGJI/beat_data_generator/releases/latest) and run it | ✅ Available |
| **macOS / Linux** | No prebuilt package yet — run from source, see [Development](#development) | 🚧 In progress |

The current release is a **public beta**. macOS and Linux support is on the roadmap; if you try the source build on those platforms, feedback is very welcome.

**Auto-update**: the app checks for new versions silently on startup (turn it off under **Settings → Advanced → Window & startup**), or check manually via **Settings → About → Check for updates**. Updates come from GitHub Releases.

See [`CHANGELOG.md`](CHANGELOG.md) (Chinese) for the per-version history.

<!-- TODO: if the installer is unsigned, document the Windows SmartScreen prompt here -->

## Features

### Editing

- **Audio import**: mp3 / wav / ogg / flac / m4a / aac / opus, with real-time waveform rendering.
- **Beat grid**: dual ruler (time + beat). Snapping from 1 to 1/32 beat subdivisions.
- **Marker editing**: click to add, drag to fine-tune, right-click to delete; nudge by snap step, multi-select (Ctrl/Cmd + click), select all.
- **Multiple marker tracks**: add / rename / recolor / lock / hide tracks. Markers on hidden tracks are excluded from the playback indicator and exports.
- **Loop groups**: a main marker can generate child markers by `interval × count`, with optional exclusion; capped at **256** children per group to keep the editor responsive.
- **Sticky notes**: place floating notes (non-modal, never steals focus) on the timeline and edit them with double-click (Markdown).
- **Undo / redo**: up to 100 steps; copy / paste marker groups (including loops).

### Analysis & playback

- **Audio intelligence**: on load, auto-detect BPM, place beat markers, find the best looping segment, and keep a live BPM readout plus a mel spectrogram in a collapsible analysis panel. Powered by **pleco-xa**, computed asynchronously in a Web Worker; each capability is an independent toggle in Settings.
- **BPM lane**: add BPM points (absolute BPM or multiplier modes) to build a tempo map; supports locking the BPM lane.
- **Variable-speed playback**: 0.1–4× rate; pitch-following playback, or pitch-preserving time stretch (defaults to `signalsmith-stretch`, with `soundtouchjs` as fallback — see [Time-stretch engine](#time-stretch-engine)).
- **Metronome click**: plays a tick each time a marker is passed; a custom audio file can be selected (empty disables it).
- **Auto-follow**: the timeline scrolls once the playhead passes a configurable threshold.

### Project & export

- **Project files**: `.bdg` (JSON). Audio is referenced by a path relative to the project plus an MD5, verified / auto-relinked on open.
- **Auto-save**: configurable interval (1–60 min) saves the current project in the background.
- **Built-in exports**: timestamp list `.txt` (millisecond precision, de-duplicated) and **CMX3600 EDL** `.edl` (25 fps, non-drop).
- **Plugin-based import / export**: ADOFAI, Phira, MIDI and more are provided by official plugins — see the table below.

### Extensibility & appearance

- **Plugin system**: extend with new import/export formats, floating sidebar panels, custom shortcuts, standalone preview windows, and typed tracks. See [`docs/plugin-system.md`](docs/plugin-system.md).
- **Theming**: 6 presets (default / midnight / forest / amber / graphite / light) with per-token color overrides, applied live.
- **Extras**: bilingual UI (中文 / English), welcome screen with recent projects, window-state memory, close-mode settings.

## Export & Integration Targets

One project can feed several targets: generic formats ship with the editor, everything else is distributed through the [official plugin organisation](https://github.com/beat-data-generator).

| Target | Format | Provided by |
| --- | --- | --- |
| Timestamp list | `.txt`: one float millisecond timestamp per line (3 decimals), de-duplicated across tracks | Built-in |
| CMX3600 EDL | `.edl`: 25 fps, Non-Drop Frame; each marker produces a 1-frame event with a `FROM CLIP NAME` | Built-in |
| A Dance of Fire and Ice | `.adofai` level, with double-press, BPM speed track and pause compensation | Plugin [bdg_plugin_adofai](https://github.com/beat-data-generator/bdg_plugin_adofai) |
| Phira / RPE | `.pez` chart, optional single-judge-line merge, packed together with the audio | Plugin [bdg_plugin_phira](https://github.com/beat-data-generator/bdg_plugin_phira) |
| DG-LAB 4 | Connect devices via WebSocket Relay and drive strength / pulse on beat points during playback (live sync, not a file export) | Plugin [bdg_plugin_dglab_v3](https://github.com/beat-data-generator/bdg_plugin_dglab_v3) |
| Text timestamps / MIDI (import) | Import markers from text timestamps or MIDI files: integers are milliseconds, decimals are seconds; MIDI note times create new tracks | Plugin [bdg_plugin_import](https://github.com/beat-data-generator/bdg_plugin_import) |

**Installing a plugin**: download the plugin repository folder → drop it into the plugin directory (**Settings → Plugins → Open plugin folder**, i.e. `<userData>/plugins`) → hit "Rescan and load" in Settings. In development mode the project's `plugins/` folder is scanned as well.

**Writing your own plugin**: [`plugins/plugin-api.d.ts`](plugins/plugin-api.d.ts) ships commented type declarations, [bdg_plugin_template](https://github.com/beat-data-generator/bdg_plugin_template) is a minimal working template, and [`docs/plugin-system.md`](docs/plugin-system.md) has the full guide.

## Screenshots

<img width="820" alt="Demo Run/Play" src="https://github.com/user-attachments/assets/3adcdc2b-4c97-46b8-b394-1a5803385a90" />

<img width="820" alt="Custom" src="https://github.com/user-attachments/assets/20f7b578-20bd-4206-b7d4-45ea80c4e7b4" />


## Quick Start

1. Launch the app and choose **Open Audio** from the File menu; the waveform loads into the timeline.
2. Click on the **BPM lane** to add tempo points (or adjust base BPM / offset in the sidebar) to align the beat grid.
3. Click on a **marker track** to place markers (auto-snapped); drag to fine-tune.
4. Play back to verify the markers; toggle auto-follow, and audition at other speeds or with pitch-preserving stretch.
5. **Save Project** (`.bdg`) to keep markers and BPM data.
6. Export with the built-in exporters (timestamps / EDL) or any installed plugin.

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
| Wheel / drag | Scroll the timeline vertically / horizontally |

Shortcuts are currently read-only (listed under **Settings → Shortcuts**); user remapping is planned for a later version. Plugins can register their own shortcuts via `api.ui.registerShortcut`.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron |
| Build tooling | electron-vite / Vite 7 |
| Frontend | Vue 3 + TypeScript |
| State | Pinia |
| Validation | zod 4 (project-file / settings schemas) |
| UI | reka-ui (headless) + Tailwind CSS v4 |
| Icons | @lucide/vue |
| i18n | vue-i18n |
| Time-stretch | signalsmith-stretch (default) / soundtouchjs (fallback) |
| Audio intelligence | pleco-xa (async via Web Worker) |
| Markdown rendering | slimdown-js (notes / plugin panels) |
| Waveform | Canvas (custom) |
| Auto-update | electron-updater (GitHub Releases) |
| Logging | electron-log |

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

Requires **Node.js ≥ 20.19** (Vite 7's minimum) and npm.

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Preview a production build
npm start

# Build (outputs to out/)
npm run build

# Package the Windows installer (outputs to release/)
npm run dist:win

# Type checking (main + renderer)
npm run typecheck

# Run tests (vitest)
npm test

# Tests in watch mode
npm run test:watch

# Test coverage
npm run test:cov

# Lint & format
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

Tests currently cover the pure-logic layer: tempo math (`tempo.ts`), project-file parsing and recovery (`schemas/project.ts`), settings repair (`shared/settings.ts`), and undo/redo plus export formats (`services/history.ts` / `services/projectIO.ts`).

### Runtime logs

Runtime logs (electron-log) go to the terminal by default. To persist them, enable "Record logs to file" under **Settings → Developer options** (off by default): they are then written to `<userData>/logs/main.log`, rotated at 5 MB, with main-process logs plus renderer console warnings/errors funnelled into it (on Windows usually `%APPDATA%\<app name>\logs\main.log`). This helps when a packaged build has no DevTools.

### Time-stretch engine

Pitch-preserving off-speed playback uses `signalsmith-stretch` by default (WASM offline render, better quality); switch back to `soundtouchjs` under **Settings → Audio → Playback**. Signalsmith failures or timeouts fall back to SoundTouch automatically.

## FAQ

- **Where are the logs?** See [Runtime logs](#runtime-logs) — nothing is written to disk until you enable it in Developer options.
- **Pitch-preserving playback sounds off / stutters?** It defaults to `signalsmith-stretch`; failures or timeouts fall back to `soundtouchjs` automatically, and you can pin the engine under **Settings → Audio → Playback**.
- **"Check for updates" does nothing?** Update checks are unsupported in development mode; if the check fails, download manually from [Releases](https://github.com/BUGJI/beat_data_generator/releases/latest).
- **Does it run on macOS / Linux?** Only Windows installers are published today; other platforms are on the roadmap — meanwhile you can try the source build and report back.
- **Why is the EDL fixed at 25 fps?** That is the current fixed output (25 fps, non-drop); for other frame rates or formats, open an [issue](https://github.com/BUGJI/beat_data_generator/issues) or write a plugin as described in [Export & Integration Targets](#export--integration-targets).

## Contributing

Setup, code style, commit and release process: see [`CONTRIBUTING.md`](CONTRIBUTING.md) (Chinese; issues and PRs in English are welcome). Bug reports and feature requests: use the [issue templates](https://github.com/BUGJI/beat_data_generator/issues/new/choose). Plugins belong in the [official plugin organisation](https://github.com/beat-data-generator).

## License

This project is released under the **GNU GPL v3** license (see [`LICENSE`](LICENSE)). Author: **BUGJI**.

### Third-party components

| Component | License |
| --- | --- |
| Electron | MIT |
| Vue / Pinia / vue-i18n / reka-ui / zod | MIT |
| @lucide/vue | ISC |
| signalsmith-stretch | MIT |
| pleco-xa | MIT |
| slimdown-js | MIT |
| electron-log / electron-updater | MIT |
| soundtouchjs (SoundTouch) | LGPL-2.1 |

The identifiers above are the licenses declared by each package on npm; check the `LICENSE` file in each upstream repository before redistributing. The built-in metronome samples live in `resources/metronomes/`. The click samples (Kick / Shaker / VehiclePositive) come from *A Dance Of Fire And Ice* by 7th Beat Games; all rights remain with the original authors, credited here as the source.
