# Design: Migrate BLE from noble to Electron Web Bluetooth

**Date:** 2026-02-26
**Status:** Approved

## Context

The app currently uses `@stoprocent/noble` (a native Node.js BLE module) in the Electron main process to scan and connect to the CSC deskbike sensor. On Linux, noble requires `CAP_NET_RAW` + `CAP_NET_ADMIN` capabilities on the Electron binary (`setcap`), which is a barrier for end users and fails silently in development. On macOS and Windows noble works without extra setup, but at the cost of a native addon that must be rebuilt per Electron version.

Electron's Web Bluetooth API (available since Electron 10, stable in Electron 33) delegates to the OS Bluetooth stack — CoreBluetooth on macOS, WinRT on Windows, BlueZ D-Bus on Linux — with no native addon and no extra permissions on any platform.

## Decision

Replace noble with Electron Web Bluetooth. BLE logic moves from the main process to the renderer. The mock (`MOCK_BLE=1`) stays functional as a renderer-side adapter.

## Architecture

### Files removed
- `src/main/ble/scanner.ts`
- `src/main/ble/connection.ts`
- `src/main/ble/mock.ts`
- `src/main/ble/csc-parser.ts` (moved to renderer)
- `@stoprocent/noble` dependency
- `pnpm setup:ble` script

### Files added
```
src/renderer/src/ble/
  adapter.ts         — BleAdapter interface + createBleAdapter() factory
  web-bluetooth.ts   — WebBluetoothAdapter (uses navigator.bluetooth)
  mock.ts            — MockAdapter (pure JS, no IPC)
  csc-parser.ts      — moved from main, rewritten for Uint8Array/DataView
```

### Files modified
- `src/main/index.ts` — add `select-bluetooth-device` session handler
- `src/main/ipc/handlers.ts` — replace BLE handlers with `ble:select-device` + `ble:save-measurement`
- `src/preload/index.ts` — new slimmer API
- `src/renderer/src/App.tsx` — use BleAdapter directly
- `src/renderer/src/env.d.ts` — updated type declarations
- `tests/ble/csc-parser.test.ts` — update import path only
- `package.json` — remove noble, clean up postinstall

## Data Flow

### Scan + connect (real hardware)
```
[User klikt Scan]
  renderer: adapter.startScan(onFound)
  → WebBluetoothAdapter: roept navigator.bluetooth.requestDevice({filters:[{services:[0x1816]}]}) aan
    (promise hangt — Electron scant op achtergrond)
  → Electron: select-bluetooth-device event → main stuurt ble:devices-found naar renderer
  → UI toont gevonden devices

[User klikt device in lijst]
  renderer: adapter.selectDevice(id, onData, onDisconnect)
  → IPC ble:select-device → main roept stored callback(id) aan
  → requestDevice() resolveert met BluetoothDevice
  → renderer: device.gatt.connect()
      → getPrimaryService(0x1816)
      → getCharacteristic(0x2A5B)
      → startNotifications()
      → characteristicvaluechanged → onData(Uint8Array)
      → csc-parser → IPC ble:save-measurement → DB
```

### Mock flow (MOCK_BLE=1)
```
MockAdapter.startScan() → roept onFound direct aan met fake device
MockAdapter.selectDevice() → start setInterval, genereert fake CSC-pakketjes
Geen navigator.bluetooth, geen IPC
```

## Interfaces

### BleAdapter
```typescript
interface BleAdapter {
  startScan(onFound: (device: DeviceInfo) => void): void
  selectDevice(
    deviceId: string,
    onData: (data: Uint8Array) => void,
    onDisconnect: () => void
  ): Promise<void>
  disconnect(): Promise<void>
}
```

### Preload API (window.deskbike)
```typescript
{
  isMock: boolean                                          // MOCK_BLE=1 ?
  onDevicesFound(cb: (devices: BtDevice[]) => void): void // select-bluetooth-device events
  selectBleDevice(deviceId: string): Promise<void>        // trigger callback in main
  saveMeasurement(data: MeasurementData): Promise<void>   // → DB via IPC
}
```

`BtDevice` = `{ deviceId: string; deviceName: string }` (Electron's format from `select-bluetooth-device`).

## Main Process Changes

### index.ts additions
```typescript
let pendingBluetoothCallback: ((deviceId: string) => void) | null = null

session.defaultSession.on('select-bluetooth-device', (event, deviceList, callback) => {
  event.preventDefault()
  pendingBluetoothCallback = callback
  win.webContents.send('ble:devices-found', deviceList)
})
```

### handlers.ts (simplified)
```typescript
ipcMain.handle('ble:select-device', (_e, deviceId: string) => {
  pendingBluetoothCallback?.(deviceId)
  pendingBluetoothCallback = null
})

ipcMain.handle('ble:save-measurement', (_e, data) => {
  insertMeasurement(data)
})
```

## CSC Parser

`csc-parser.ts` is rewritten to accept `Uint8Array` instead of `Buffer` (uses `DataView` for multi-byte reads). `Buffer` extends `Uint8Array`, so the 9 existing tests work unchanged — only the import path changes from `src/main/ble/csc-parser` to `src/renderer/src/ble/csc-parser`.

## What Stays Unchanged

- `scripts/emulator.ts` + `@abandonware/bleno` — emulator still useful for testing
- `src/main/db/` — all DB code unchanged
- All 9 CSC parser tests — pass unchanged (only import path updated)
- `MOCK_BLE=1 pnpm dev` / `pnpm dev:mock` — mock still works, different implementation
