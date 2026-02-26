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

**Linux BLE permissions (required for real hardware):** noble needs raw HCI socket access. Run once after `pnpm install`, and again after any Electron upgrade:
```bash
pnpm setup:ble   # sudo setcap cap_net_raw,cap_net_admin+eip on the Electron binary
```
Without this, noble stays in `unknown` state and scanning never starts. Use `MOCK_BLE=1 pnpm dev` to develop without this requirement.

After `pnpm install`, native modules are automatically rebuilt for Electron via `postinstall`. If rebuild fails, run manually:
```bash
pnpm electron-rebuild -f -w better-sqlite3 -w @stoprocent/noble
```

If `pnpm dev` throws `Error: Electron uninstall`, the Electron binary was not downloaded (pnpm install order issue). Fix:
```bash
node node_modules/electron/install.js
```

## Architecture

```
src/
  main/          # Electron main process (Node.js) — BLE, SQLite, IPC
    ble/
      scanner.ts       # Scans for CSC BLE devices (noble)
      connection.ts    # Connects and subscribes to CSC notifications
      csc-parser.ts    # Pure function: parses CSC BLE bytes + computes deltas
    db/
      schema.ts        # Drizzle ORM schema (all 5 tables)
      index.ts         # DB init: opens SQLite, runs migrations
      queries.ts       # insertMeasurement, getRecentMeasurements
      migrations/      # Auto-generated SQL — never edit manually
    ipc/
      handlers.ts      # IPC handler registration (ble:scan, ble:connect, ble:disconnect)
    index.ts           # Electron entry: initDb → createWindow → registerIpcHandlers
  preload/
    index.ts     # contextBridge: exposes window.deskbike to renderer
  renderer/      # React app (Vite, Chromium)
    src/
      App.tsx          # Currently: diagnostic UI (status, device list, live hex)
      env.d.ts         # window.deskbike type declarations
scripts/
  emulator.ts    # Standalone BLE CSC peripheral emulator (@abandonware/bleno)
tests/
  ble/
    csc-parser.test.ts  # Unit tests for CSC parser (9 tests, including rollover)
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

**IPC pattern** — Renderer never touches Node APIs. `src/preload/index.ts` exposes `window.deskbike` via `contextBridge`. All BLE and DB operations run in the main process.

**BLE library** — `@stoprocent/noble` (maintained fork of noble) for central role. `@abandonware/bleno` for the emulator peripheral role. Both are native modules rebuilt against Electron's Node version.

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

**Linux constraint:** `noble` (central) and `bleno` (peripheral) cannot share the same Bluetooth adapter. Run the emulator on a second machine, USB BT dongle (`BLENO_HCI_DEVICE_ID=1`), or use the real deskbike sensor instead.

**Software mock (no hardware):** `MOCK_BLE=1 pnpm dev` starts the app with a built-in mock that emits synthetic CSC packets every second (15–20 km/h, 65–75 RPM). The mock device appears as `DeskBike-MOCK` in the scan results.

## Native module rebuild gotcha

`package.json` lists `electron-rebuild` in scripts but the actual installed package is `@electron/rebuild` (official successor). The `electron-rebuild` binary still works — it's provided by `@electron/rebuild`. Do not add `electron-rebuild` as a separate dependency.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 33 |
| Language | TypeScript 5 |
| Frontend | React 18 + Vite (electron-vite 3) |
| BLE central | @stoprocent/noble |
| BLE peripheral (emulator) | @abandonware/bleno |
| Database | SQLite via better-sqlite3 |
| ORM | Drizzle ORM + drizzle-kit |
| Tests | Vitest |
| Package manager | pnpm |
