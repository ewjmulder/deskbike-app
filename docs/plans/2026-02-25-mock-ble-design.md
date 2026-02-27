# Design: Software BLE Mock (`MOCK_BLE=1`)

> **Status update (2026-02-27):** Historical design notes.
> Intent is still relevant (software mock mode exists), but file paths and module names changed in final implementation.
> Current source of truth: `docs/Architecture.md` and `src/main/ble/mock-helper.ts`.


## Problem

On Linux, `noble` (BLE central) and `bleno` (BLE peripheral) cannot share the same Bluetooth adapter. Running both the app and the emulator on one machine is therefore not possible without a second USB BT dongle. During development, this blocks UI work when no hardware is available.

## Goal

Add a software mock that feeds synthetic CSC data directly into the existing IPC pipeline — no Bluetooth hardware required. All three data sources remain supported:

| Mode | How to activate |
|------|----------------|
| Real sensor | `pnpm dev` |
| BLE emulator (bleno) | `BLENO_HCI_DEVICE_ID=1 pnpm emulator` + `pnpm dev` |
| Software mock | `MOCK_BLE=1 pnpm dev` |

## Approach

Env var `MOCK_BLE=1` selects the mock at startup. No runtime toggle, no UI changes.

## New file: `src/main/ble/mock.ts`

Exports `startScan`, `stopScan`, `connect`, `disconnect` with the same signatures as the real BLE modules.

- `startScan(onDevice)` — immediately calls `onDevice` with a single fake device:
  `{ id: 'mock-0', name: 'DeskBike-MOCK', address: '00:00:00:00:00:00' }`
- `stopScan()` — no-op
- `connect(deviceId, onData, onDisconnect)` — starts a 1000ms interval emitting synthetic CSC packets (same sine/cosine logic as `scripts/emulator.ts`: 15–20 km/h, 65–75 RPM)
- `disconnect(deviceId)` — clears the interval, calls `onDisconnect`

The `buildPacket()` function is duplicated from the emulator (not imported from `scripts/`) to keep the main process free of emulator dependencies.

## Change: `src/main/ipc/handlers.ts`

Replace static imports with conditional imports based on `MOCK_BLE`:

```ts
const MOCK = process.env.MOCK_BLE === '1'
const { startScan, stopScan } = MOCK
  ? await import('../ble/mock')
  : await import('../ble/scanner')
const { connect, disconnect } = MOCK
  ? await import('../ble/mock')
  : await import('../ble/connection')
```

No other changes to `handlers.ts`. The rest of the IPC flow (`insertMeasurement`, `win.webContents.send`) is unchanged.

## No renderer changes

The existing diagnostic UI already handles the full flow: Scan → device list → Connect → live data. The mock is transparent to the renderer.
