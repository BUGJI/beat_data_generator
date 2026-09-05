# Beat Data Generator

A music beat-marker editor built with **Electron + Vue 3 + TypeScript + Element Plus**. Align a beat grid over an audio waveform, place beat markers and BPM change points, and generate beat data for rhythm-based applications.

## Features

- **Audio import**: mp3 / wav / ogg / flac / m4a / aac / opus, with real-time waveform rendering.
- **Beat grid**: dual ruler (time + beat). Snapping from 1 to 1/32 beat subdivisions.
- **BPM lane**: place tempo points (absolute BPM or multiplier) to build a variable-speed tempo map; BPM can be locked.
- **Multiple marker tracks**: add / rename / recolor / lock / hide tracks. Markers on hidden tracks are excluded from the playback indicator and exports.
- **Marker editing**: click to add, drag to fine-tune, right-click to delete; nudge by snap step, multi-select (Ctrl/Cmd+click), select all.
- **Loop groups**: a main marker can generate child markers by `interval × count`, with optional exclusion.
- **Variable-speed playback**: 0.1–4× rate; choose pitch-following playback or pitch-preserving time stretch via soundtouchjs.
- **Auto-follow**: the timeline scrolls once the playhead passes a configurable threshold.
- **Undo / redo**: up to 100 steps; copy / paste marker groups (including loops).
- **Project files**: `.bdg` (JSON). Audio is referenced by a path relative to the project plus an MD5, verified / auto-relinked on open.
- **Exports**: timestamp list `.txt` (millisecond precision, de-duplicated) and **CMX3600 EDL** `.edl` (25 fps, non-drop).
- **Auto-save**: configurable interval (1–60 min) saves the current project in the background.
- **Extras**: bilingual UI (中文 / English), welcome screen with recent projects, window-state memory, close-mode settings, dark theme.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron |
| Build tooling | electron-vite / Vite |
| Frontend | Vue 3 + TypeScript |
| UI library | Element Plus + @element-plus/icons-vue |
| i18n | vue-i18n |
| Time-stretch | soundtouchjs |
| Waveform | Canvas (custom) |

## Project Layout

```
src/
├── main/            # Electron main process: windows, IPC, dialogs, settings/recents persistence
├── preload/         # Preload script (contextBridge exposes a safe API)
├── shared/          # IPC type definitions shared by main & renderer
└── renderer/        # Vue renderer
    └── src/
        ├── components/   # TopBar / SideBar / TransportBar / Timeline / SettingsModal / ProjectBar etc.
        ├── i18n/         # Chinese & English strings (zh / en)
        ├── store.ts      # Global state & domain logic (markers, tracks, BPM, history, IO)
        ├── engine.ts     # Web Audio playback engine
        ├── tempo.ts      # beat↔time mapping and tempo map builder
        ├── stretch.ts    # soundtouchjs time stretch wrapper
        ├── editorView.ts # viewport / scroll / zoom model
        └── metrics.ts    # drawing metrics & palette
```

## Development

Requires Node.js (≥ 18 recommended) and npm.

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
```

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

MIT License.
