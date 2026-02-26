# DeskBike App

Cross-platform desktop app (Windows, macOS, Linux) for desk bike CSC (Cycling Speed & Cadence) BLE sensor data. Shows real-time statistics and challenges for people cycling at their desk.

## Language convention

- All code and documentation: **English**
- Chat conversations with the user: **Dutch**

## Commands

```bash
pnpm dev          # Start Electron app in development mode (hot reload)
pnpm build        # Build for production
pnpm test         # Run all tests (Vitest)
pnpm test:watch   # Tests in watch mode
pnpm db:generate  # Generate Drizzle migrations from schema changes
pnpm emulator     # Run BLE CSC emulator (needs separate BT adapter on Linux)
MOCK_BLE=1 pnpm dev  # Start with software BLE mock (no hardware needed)
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
  main/          # Electron main process (Node.js) — SQLite, IPC, BT session
    db/
      schema.ts        # Drizzle ORM schema (all 5 tables)
      index.ts         # DB init: opens SQLite, runs migrations
      queries.ts       # insertMeasurement, getRecentMeasurements
      migrations/      # Auto-generated SQL — never edit manually
    ipc/
      handlers.ts      # IPC handler registration (ble:select-device, ble:save-measurement)
    index.ts           # Electron entry: initDb → registerIpcHandlers → createWindow
                       # Also: session.on('select-bluetooth-device') for Web Bluetooth device picking
  preload/
    index.ts     # contextBridge: exposes window.deskbike to renderer
  renderer/      # React app (Vite, Chromium)
    src/
      App.tsx          # Diagnostic UI — scan, connect, live hex display
      env.d.ts         # window.deskbike type declarations
      ble/
        adapter.ts       # BleAdapter interface + createBleAdapter() factory
        web-bluetooth.ts # WebBluetoothAdapter: navigator.bluetooth (real hardware)
        mock.ts          # MockAdapter: pure JS timer (MOCK_BLE=1)
        csc-parser.ts    # parseRawCsc + computeDeltas (Uint8Array/DataView)
scripts/
  emulator.ts    # Standalone BLE CSC peripheral emulator (@abandonware/bleno)
tests/
  ble/
    csc-parser.test.ts  # Unit tests for CSC parser (9 tests, including rollover)
    mock.test.ts        # Unit tests for MockAdapter (4 tests)
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

**IPC pattern** — Renderer never touches Node APIs. `src/preload/index.ts` exposes `window.deskbike` via `contextBridge`. BLE runs entirely in the renderer via Web Bluetooth; only DB persistence goes through IPC.

**BLE architecture** — BLE central role uses `navigator.bluetooth` (Web Bluetooth API) in the renderer — no native module, no Linux permissions required. The main process registers a `session.on('select-bluetooth-device')` handler that forwards discovered devices to the renderer, so our own UI acts as the device picker. `@abandonware/bleno` is used only for the emulator peripheral role.

## Database

SQLite at `~/.config/deskbike-app/deskbike.sqlite` (Linux), `~/Library/Application Support/deskbike-app/deskbike.sqlite` (macOS).

Schema changes: edit `src/main/db/schema.ts`, then run `pnpm db:generate`. Never edit migration files manually.

Inspect during development:
```bash
sqlite3 ~/.config/deskbike-app/deskbike.sqlite ".tables"
sqlite3 ~/.config/deskbike-app/deskbike.sqlite "SELECT sensor_id, timestamp_utc, wheel_revs_diff, wheel_time_diff FROM measurements LIMIT 10;"
```

## BLE emulator

The emulator (`pnpm emulator`) advertises as `DeskBike-EMU` with CSC service UUID `1816`. It simulates 15–20 km/h and 65–75 RPM using sine/cosine waves.

**Linux:** No adapter conflicts — `navigator.bluetooth` (Web Bluetooth, renderer) and `bleno` (peripheral, emulator) use different subsystems. The emulator can run on the same machine as the app.

**Software mock (no hardware):** `MOCK_BLE=1 pnpm dev` starts the app with a built-in mock that emits synthetic CSC packets every second (15–20 km/h, 65–75 RPM). The mock device appears as `DeskBike-MOCK` in the scan results.

## Native module rebuild gotcha

`package.json` lists `electron-rebuild` in scripts but the actual installed package is `@electron/rebuild` (official successor). The `electron-rebuild` binary still works — it's provided by `@electron/rebuild`. Do not add `electron-rebuild` as a separate dependency.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 33 |
| Language | TypeScript 5 |
| Frontend | React 18 + Vite (electron-vite 3) |
| BLE central | Web Bluetooth API (navigator.bluetooth) |
| BLE peripheral (emulator) | @abandonware/bleno |
| Database | SQLite via better-sqlite3 |
| ORM | Drizzle ORM + drizzle-kit |
| Tests | Vitest |
| Package manager | pnpm |
