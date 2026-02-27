# DeskBike App Architecture

## Document Status

- Last updated: 2026-02-27
- Scope: Current implementation in this repository
- This document supersedes older noble/Web Bluetooth descriptions

## Overview

DeskBike is a cross-platform Electron desktop app that connects to CSC BLE sensors, streams live metrics, and stores session history locally.

Key architectural choice: BLE central logic runs in a Python helper process (`bleak`) instead of in Electron renderer/main native JS BLE stacks.

## Runtime Topology

```text
Electron Main Process (Node.js)
  - app lifecycle
  - database init + migrations
  - BLE helper process bridge (stdin/stdout JSON lines)
  - IPC handlers
  - window manager (dashboard + widget)
  - tray manager
        |
        | contextBridge + ipcRenderer/ipcMain
        v
Renderer Process (React)
  - Live tab (diagnostic + session flow)
  - History tab
  - Widget view
  - CSC packet parsing and live metric derivation
```

## Tech Stack (Current)

| Layer | Technology | Usage in this project |
| --- | --- | --- |
| Desktop runtime | Electron 33 | Main/preload/renderer split, native window/tray APIs |
| Frontend | React 18 + Vite (`electron-vite`) | Dashboard + widget UI |
| Language | TypeScript 5 | Main, preload, renderer, scripts, tests |
| BLE central | Python 3 + `bleak` | Real scanning/connecting/notifying via helper process |
| Software mock | In-process TypeScript mock helper | `MOCK_BLE=1` no-hardware workflow |
| Persistence | SQLite (`better-sqlite3`) | Local event and session storage |
| ORM/migrations | Drizzle ORM + drizzle-kit | Schema definitions and SQL migrations |
| Testing | Vitest | Parser/helper/session logic tests |
| Packaging | electron-builder + PyInstaller helper binary | Cross-platform installers with bundled helper |

## Processes and Responsibilities

### 1) Main Process (`src/main`)

Responsibilities:

- Starts app and initializes SQLite + migrations (`db/index.ts`)
- Chooses real helper (`BleHelper`) or software mock (`MockBleHelper`) at startup
- Registers IPC contract (`ipc/handlers.ts`)
- Manages dashboard and widget windows (`windows.ts`)
- Manages tray behavior (`tray.ts`)

Startup flow:

1. `app.whenReady()`
2. `initDb()`
3. create helper (`MOCK_BLE` switch)
4. create windows
5. helper.start()
6. register IPC handlers
7. initialize tray

### 2) BLE Helper Process

Files:

- Bridge in main: `src/main/ble/helper.ts`
- Python helper: `src/helpers/ble_helper.py`

Protocol (newline-delimited JSON):

- Main -> helper commands: `scan`, `connect`, `disconnect`
- Helper -> main events: `device`, `connected`, `data`, `disconnected`, `error`

Why this design:

- Uses platform-native BLE through `bleak` backends
- Avoids brittle Electron-side BLE constraints
- Keeps renderer sandbox clean

### 3) Preload Bridge (`src/preload/index.ts`)

Preload exposes `window.deskbike` through `contextBridge`.

Renderer capabilities include:

- BLE actions/events (`scanStart`, `connect`, `disconnect`, `onData`, ...)
- Measurement persistence (`saveMeasurement`)
- Session APIs (`sessionStart`, `sessionEnd`, `getSessionHistory`, `getSensors`)
- Settings and widget controls

Renderer never directly accesses Node APIs.

### 4) Renderer (`src/renderer/src`)

Main UI:

- `App.tsx` routes between dashboard tabs or widget mode (`?view=widget`)
- `DiagnosticTab.tsx` handles scan/connect/live metrics/session lifecycle
- `HistoryTab.tsx` shows completed sessions per sensor
- `components/widget/WidgetView.tsx` renders compact always-on-top view

BLE data handling:

- Raw CSC packets arrive via IPC
- Parsed by `ble/csc-parser.ts`
- Live speed/cadence computed from delta math in renderer

## Data and Session Model

### Tables

- `measurements`: append-only raw packets + decoded CSC fields + per-packet deltas
- `sessions`: session boundaries and aggregate stats
- `computed_metrics`: present in schema for regenerable derived data (not yet primary runtime source)
- `settings`: JSON-encoded key/value app settings
- `achievements`: reserved for future progression features

### Session lifecycle

- Session starts on first packet after successful connect
- Session ends on disconnect or inactivity timeout (renderer-managed timer)
- At session end, main process computes and writes aggregates (`session-stats.ts`)

## Windowing and Tray

- Dashboard window: standard desktop app window
- Widget window: frameless/transparent, configurable always-on-top, persists bounds + opacity
- Tray icon/menu:
  - toggle widget
  - open dashboard
  - quit app

## Build, Test, Packaging

### Development

- `pnpm dev`: real BLE helper mode
- `pnpm dev:mock`: software BLE mode

### Tests

- `pnpm test` (Vitest, Node environment)
- Coverage focus: CSC parsing, helper protocol parsing, session stat math, DB helper behavior

### Distribution

- `pnpm build`
- `pnpm build:helper` (PyInstaller binary from `ble_helper.py`)
- `pnpm dist` (electron-builder packages app + helper + migrations)

`electron-builder.yml` bundles:

- `dist-helpers/ble_helper(.exe)` -> `resources/helpers/`
- `src/main/db/migrations/` -> `resources/migrations/`

## Platform Notes

- Linux:
  - no special adapter pinning is required for standard helper usage
- macOS:
  - packaging enables hardened runtime + entitlements file
- Windows:
  - NSIS packaging target configured

## Known Gaps / Next Opportunities

- `computed_metrics` table is defined but not yet fully integrated into live write/read flows
- Widget can consume live data but does not independently start BLE scans/connections
- No auto-update channel configured yet
