# DeskBike App

Cross-platform desktop app (Windows, macOS, Linux) for desk bike CSC (Cycling Speed & Cadence) BLE sensor data. Shows real-time statistics and challenges for people cycling at their desk.

## Documentation status

- Last updated: 2026-03-06
- This file reflects the current implementation.
- Historical plans live in `docs/plans/` and include status banners.

## Language convention

- All code and documentation: **English**
- Chat conversations with the user: **Dutch**

## Commands

```bash
pip install bleak  # One-time setup: install Python BLE library for helper process
./run.sh          # Sanity check + test + build + run (real BLE)
./run.sh mock     # Sanity check + test + build + run (software mock)
pnpm dev          # Start Electron app in development mode (hot reload)
pnpm build        # Build for production
pnpm test         # Run all tests (Vitest)
pnpm test:watch   # Tests in watch mode
pnpm db:generate  # Generate Drizzle migrations from schema changes
pnpm dev:mock     # Start with software BLE mock (no hardware needed)
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
      queries.ts       # insertMeasurement, startSession, endSession, touchSession, closeOrphanedSessions
      migrations/      # Auto-generated SQL — never edit manually
    ipc/
      handlers.ts      # IPC handlers: ble:scan-start, ble:connect, ble:disconnect, ble:save-measurement, ble:mock-set-speed, session:*, settings:*, widget:*
    index.ts           # Electron entry: initDb → closeOrphanedSessions → registerIpcHandlers → createWindow
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
    ble/helper.test.ts              # Unit tests for helper line protocol parsing
    db/session-stats.test.ts
    db/session-lifecycle.test.ts    # Unit tests for touchSession + closeOrphanedSessions
    db/settings.test.ts
docs/
  Architecture.md          # Full architecture reference
  native-addon-abi.md      # Native addon ABI mismatch between system Node and Electron — background, solutions, trade-offs
  plans/                   # Implementation plans (historical)
```

## Key design decisions

**Event store data model** — `measurements` table is append-only and immutable. Every raw BLE notification is stored with its original bytes (`raw_data` BLOB) plus decoded CSC fields and deltas. Interpreted values (speed, cadence) go in a separate `computed_metrics` table that can be fully regenerated.

**Three-layer measurements table:**
1. Raw: `sensor_id`, `timestamp_utc` (ISO 8601), `raw_data` (original bytes)
2. CSC decoded: `has_wheel_data`, `has_crank_data`, `wheel_revs`, `wheel_time`, `crank_revs`, `crank_time`
3. Deltas: `time_diff_ms`, `*_diff` fields (rollover-corrected with `>>> 0` for uint32, `& 0xffff` for uint16)

**IPC pattern** — Renderer never touches Node APIs. `src/preload/index.ts` exposes `window.deskbike` via `contextBridge`. BLE is managed in the main process via the helper process; the renderer communicates with it through IPC. DB persistence also goes through IPC.

**Session lifecycle** — Sessions are crash-safe via two mechanisms:
1. `session:heartbeat` IPC — called fire-and-forget on every BLE data packet; does a lightweight `UPDATE sessions SET ended_at = ?`. So `ended_at` is always current even if the app crashes.
2. `closeOrphanedSessions()` — runs at startup; closes any sessions still missing `ended_at` (e.g. from a hard kill) using the timestamp of their last measurement, then computes stats via `endSession`. Uses the next session's `started_at` as an upper bound to avoid cross-session measurement contamination when the same sensor_id has multiple sessions.

`sqlite3` CLI is not available on this machine — use Python to inspect the DB:
```bash
python3 -c "import sqlite3,os; db=sqlite3.connect(os.path.expanduser('~/.config/deskbike-app/deskbike.sqlite')); [print(r) for r in db.execute('SELECT sensor_id, started_at, ended_at FROM sessions ORDER BY started_at DESC LIMIT 10')]"
```

**Native addon ABI** — `better-sqlite3` is a native addon that must be compiled for a specific ABI. Electron 33 uses ABI 130 (Electron-internal); system Node 22/25 uses ABI 141. These never match — this is structural, not fixable by switching Node versions. `run.sh` maintains a `.native-cache/` directory with one compiled binary per runtime version, keyed by `node-{VER}` and `electron-{VER}`. On first run both are compiled; afterwards they are restored from cache in ~1s. See `docs/native-addon-abi.md` for full background.

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
