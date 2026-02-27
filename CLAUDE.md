# DeskBike App

Cross-platform desktop app (Windows, macOS, Linux) for desk bike CSC (Cycling Speed & Cadence) BLE sensor data. Shows real-time statistics and challenges for people cycling at their desk.

## Documentation status

- Last updated: 2026-02-27
- This file reflects the current implementation.
- Historical plans live in `docs/plans/` and include status banners.

## Language convention

- All code and documentation: **English**
- Chat conversations with the user: **Dutch**

## Commands

```bash
pip install bleak  # One-time setup: install Python BLE library for helper process
pnpm dev          # Start Electron app in development mode (hot reload)
pnpm build        # Build for production
pnpm test         # Run all tests (Vitest)
pnpm test:watch   # Tests in watch mode
pnpm db:generate  # Generate Drizzle migrations from schema changes
pnpm dev:mock        # Start with software BLE mock (no hardware needed)
```

After `pnpm install`, native modules are automatically rebuilt for Electron via `postinstall`. If rebuild fails, run manually:
```bash
pnpm electron-rebuild -f -w better-sqlite3
```

If `pnpm dev` throws `Error: Electron uninstall`, the Electron binary was not downloaded (pnpm install order issue). Fix:
```bash
node node_modules/electron/install.js
```

## Architecture

```
src/
  main/          # Electron main process (Node.js) — SQLite, IPC, BLE helper
    ble/
      helper.ts        # IBleHelper interface + BleHelper: spawns ble_helper.py, JSON lines protocol
      mock-helper.ts   # MockBleHelper: drop-in for BleHelper when MOCK_BLE=1; emits synthetic CSC packets
    db/
      schema.ts        # Drizzle ORM schema (all 5 tables)
      index.ts         # DB init: opens SQLite, runs migrations
      queries.ts       # insertMeasurement, getRecentMeasurements
      migrations/      # Auto-generated SQL — never edit manually
    ipc/
      handlers.ts      # IPC handlers: ble:scan-start, ble:connect, ble:disconnect, ble:save-measurement, ble:mock-set-speed
    index.ts           # Electron entry: initDb → registerIpcHandlers → createWindow
  preload/
    index.ts     # contextBridge: exposes window.deskbike to renderer
  renderer/      # React app (Vite, Chromium)
    src/
      App.tsx          # Tab shell + widget routing (?view=widget)
      DiagnosticTab.tsx# Live BLE diagnostics + session lifecycle
      HistoryTab.tsx   # Session history per sensor
      env.d.ts         # window.deskbike type declarations
      ble/
        adapter.ts       # BleAdapter interface + createBleAdapter() factory
        ipc-adapter.ts   # IpcBleAdapter: talks to main process via IPC (real hardware)
        csc-parser.ts    # parseRawCsc + computeDeltas (Uint8Array/DataView)
      components/widget/
        WidgetView.tsx   # Floating compact metrics UI
  helpers/
    ble_helper.py  # Python BLE helper process (bleak); JSON lines over stdin/stdout
requirements.txt   # Python dependencies (bleak)
tests/
  ble/
    csc-parser.test.ts  # Unit tests for CSC parser (9 tests, including rollover)
    ipc-adapter.test.ts # Unit tests for renderer IPC BLE adapter
  main/
    ble/helper.test.ts  # Unit tests for helper line protocol parsing
    db/session-stats.test.ts
docs/
  Architecture.md       # Full architecture reference
  plans/                # Implementation plans (historical)
```

## Key design decisions

**Event store data model** — `measurements` table is append-only and immutable. Every raw BLE notification is stored with its original bytes (`raw_data` BLOB) plus decoded CSC fields and deltas. Interpreted values (speed, cadence) go in a separate `computed_metrics` table that can be fully regenerated.

**Three-layer measurements table:**
1. Raw: `sensor_id`, `timestamp_utc` (ISO 8601), `raw_data` (original bytes)
2. CSC decoded: `has_wheel_data`, `has_crank_data`, `wheel_revs`, `wheel_time`, `crank_revs`, `crank_time`
3. Deltas: `time_diff_ms`, `*_diff` fields (rollover-corrected with `>>> 0` for uint32, `& 0xffff` for uint16)

**IPC pattern** — Renderer never touches Node APIs. `src/preload/index.ts` exposes `window.deskbike` via `contextBridge`. BLE is managed in the main process via the helper process; the renderer communicates with it through IPC. DB persistence also goes through IPC.

**Mock-only IPC features** — Add an optional method to `IBleHelper` (e.g. `setMockSpeedKmh?`) so `BleHelper` ignores it automatically. Register a `ble:mock-*` IPC handler in `handlers.ts` that calls `helper.method?.()`. Expose via preload and declare in `env.d.ts`.

**BLE architecture** — BLE central role is handled by `src/helpers/ble_helper.py`, a Python subprocess spawned by the main process (`src/main/ble/helper.ts`) via `child_process.spawn`. Communication uses a JSON lines protocol over stdin/stdout. This approach uses BlueZ D-Bus on Linux, CoreBluetooth on macOS, and WinRT on Windows. The renderer's `IpcBleAdapter` (`src/renderer/src/ble/ipc-adapter.ts`) communicates with the main process via IPC.

## Database

SQLite at `~/.config/deskbike-app/deskbike.sqlite` (Linux), `~/Library/Application Support/deskbike-app/deskbike.sqlite` (macOS).

Schema changes: edit `src/main/db/schema.ts`, then run `pnpm db:generate`. Never edit migration files manually.

Inspect during development:
```bash
sqlite3 ~/.config/deskbike-app/deskbike.sqlite ".tables"
sqlite3 ~/.config/deskbike-app/deskbike.sqlite "SELECT sensor_id, timestamp_utc, wheel_revs_diff, wheel_time_diff FROM measurements LIMIT 10;"
```

## BLE testing modes

Two modes for testing BLE:

| Mode | Command | BLE stack tested |
|------|---------|-----------------|
| Software mock | `pnpm dev:mock` | No BLE — synthetic packets injected in main process |
| Real sensor | `pnpm dev` | Full BLE stack with actual CSC sensor |

**Software mock (`pnpm dev:mock`):** `MockBleHelper` in main process emits synthetic CSC packets every second. Speed is slider-controlled in the UI (default 17.5 km/h, wheel circumference 2.1 m); cadence varies 65–75 RPM. The mock device appears as `DeskBike-MOCK` in the scan results.

## Packaging gotchas

**Drizzle migrations** — `src/main/db/migrations/` must be in `extraResources` in `electron-builder.yml` so packaged apps can find them at `process.resourcesPath + '/migrations'` (already expected by `src/main/db/index.ts`).

**Do not use `ELECTRON_SKIP_BINARY_DOWNLOAD=1` in CI** — electron-builder needs to download the Electron binary when packaging. Skipping it during `pnpm install` causes an EOF error on macOS during the package step.

**Download build artifacts from CI:**
```bash
gh run list --workflow=build.yml --limit=5
gh run download RUN_ID --name deskbike-linux --dir ~/Downloads/deskbike-linux
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 33 |
| Language | TypeScript 5 |
| Frontend | React 18 + Vite (electron-vite 3) |
| BLE central | Python + bleak (via child process, JSON lines IPC) |
| Database | SQLite via better-sqlite3 |
| ORM | Drizzle ORM + drizzle-kit |
| Tests | Vitest |
| Package manager | pnpm |
