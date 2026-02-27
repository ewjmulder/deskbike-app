# DeskBike App

Cross-platform Electron desktop app (Linux/macOS/Windows) for CSC BLE desk bike sensors.
It shows live speed/cadence data, tracks sessions, and stores history in SQLite.

## Current Status (2026-02-27)

- Runtime architecture is stable: Electron main/preload/renderer with strict IPC boundaries.
- BLE central is implemented through a Python `bleak` helper process (`src/helpers/ble_helper.py`).
- A software BLE mock (`MOCK_BLE=1`) is available for testing.
- Session history and widget window are implemented and persisted via SQLite + Drizzle.

## Tech Stack

- Electron 33
- TypeScript 5
- React 18 + Vite (`electron-vite`)
- SQLite (`better-sqlite3`) + Drizzle ORM
- Python 3 + `bleak` (BLE helper process)
- Vitest
- pnpm

## Project Structure

```text
src/
  main/       Electron main process (windows, tray, DB, IPC, BLE helper bridge)
  preload/    Safe API bridge (window.deskbike)
  renderer/   React UI (Live, History, Widget)
  helpers/    Python BLE helper process (bleak)
docs/
  Architecture.md
  plans/      Historical implementation/design plans with status updates
scripts/
tests/
  Unit tests (parser, helper protocol, DB/session logic)
```

## Development

Requirements:

- Node.js 20+
- pnpm
- Python 3 (for local non-packaged BLE helper mode)

Install dependencies:

```bash
pnpm install
```

Run app:

```bash
pnpm dev          # real BLE helper mode
pnpm dev:mock     # software BLE mock mode
```

Tests:

```bash
pnpm test
```

Build and package:

```bash
pnpm build
pnpm build:helper
pnpm dist
```

## Documentation

- Current architecture and runtime flow: `docs/Architecture.md`
- Historical plans with explicit status headers: `docs/plans/*.md`
