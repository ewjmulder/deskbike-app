# Web Bluetooth Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `@stoprocent/noble` (main-process BLE) with Electron's Web Bluetooth API (renderer-process BLE), eliminating the Linux `setcap` requirement for all users.

**Architecture:** A `BleAdapter` interface in the renderer has two implementations — `WebBluetoothAdapter` (calls `navigator.bluetooth`) and `MockAdapter` (pure JS timer). The main process adds an Electron `select-bluetooth-device` session handler that forwards discovered devices to the renderer so our own UI acts as the device picker. DB storage is the only reason the renderer still talks to main via IPC.

**Tech Stack:** Electron 33, Web Bluetooth API (`navigator.bluetooth`), TypeScript 5, React 18, Vitest, electron-vite, Drizzle ORM + better-sqlite3.

---

### Task 1: Move CSC parser to renderer and rewrite for Uint8Array

The parser currently uses Node.js `Buffer` methods (`readUInt32LE`, `readUInt16LE`). The renderer is a browser context — rewrite using `DataView` instead. `Buffer` extends `Uint8Array`, so existing tests continue to work with their `Buffer.from([...])` inputs.

**Files:**
- Create: `src/renderer/src/ble/csc-parser.ts`
- Modify: `tests/ble/csc-parser.test.ts` (import path only)

**Step 1: Create the renderer-side parser**

```typescript
// src/renderer/src/ble/csc-parser.ts

export interface CscRawFields {
  hasWheelData: boolean
  hasCrankData: boolean
  wheelRevs: number | null   // cumulative uint32
  wheelTime: number | null   // last event time, uint16, 1/1024s units
  crankRevs: number | null   // cumulative uint16
  crankTime: number | null   // last event time, uint16, 1/1024s units
}

export interface CscDeltas {
  timeDiffMs: number
  wheelRevsDiff: number | null
  wheelTimeDiff: number | null
  crankRevsDiff: number | null
  crankTimeDiff: number | null
}

export function parseRawCsc(data: Uint8Array): CscRawFields {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const flags = data[0]
  let idx = 1

  const hasWheelData = (flags & 0x01) !== 0
  const hasCrankData = (flags & 0x02) !== 0

  let wheelRevs: number | null = null
  let wheelTime: number | null = null
  let crankRevs: number | null = null
  let crankTime: number | null = null

  if (hasWheelData) {
    wheelRevs = view.getUint32(idx, true)
    idx += 4
    wheelTime = view.getUint16(idx, true)
    idx += 2
  }

  if (hasCrankData) {
    crankRevs = view.getUint16(idx, true)
    idx += 2
    crankTime = view.getUint16(idx, true)
    idx += 2
  }

  return { hasWheelData, hasCrankData, wheelRevs, wheelTime, crankRevs, crankTime }
}

export function computeDeltas(
  current: CscRawFields,
  previous: CscRawFields,
  timeDiffMs: number
): CscDeltas {
  let wheelRevsDiff: number | null = null
  let wheelTimeDiff: number | null = null
  let crankRevsDiff: number | null = null
  let crankTimeDiff: number | null = null

  if (
    current.hasWheelData && previous.hasWheelData &&
    current.wheelRevs !== null && previous.wheelRevs !== null &&
    current.wheelTime !== null && previous.wheelTime !== null
  ) {
    wheelRevsDiff = (current.wheelRevs - previous.wheelRevs) >>> 0
    wheelTimeDiff = (current.wheelTime - previous.wheelTime) & 0xffff
  }

  if (
    current.hasCrankData && previous.hasCrankData &&
    current.crankRevs !== null && previous.crankRevs !== null &&
    current.crankTime !== null && previous.crankTime !== null
  ) {
    crankRevsDiff = (current.crankRevs - previous.crankRevs) & 0xffff
    crankTimeDiff = (current.crankTime - previous.crankTime) & 0xffff
  }

  return { timeDiffMs, wheelRevsDiff, wheelTimeDiff, crankRevsDiff, crankTimeDiff }
}
```

**Step 2: Update test import path**

In `tests/ble/csc-parser.test.ts`, change line 2:
```typescript
// was:
import { parseRawCsc, computeDeltas } from '../../src/main/ble/csc-parser'
// becomes:
import { parseRawCsc, computeDeltas } from '../../src/renderer/src/ble/csc-parser'
```

**Step 3: Run tests — all 9 must pass**

```bash
pnpm test
```

Expected: `9 passed`

**Step 4: Commit**

```bash
git add src/renderer/src/ble/csc-parser.ts tests/ble/csc-parser.test.ts
git commit -m "refactor: move csc-parser to renderer, rewrite for Uint8Array/DataView"
```

---

### Task 2: Create BleAdapter interface and factory

**Files:**
- Create: `src/renderer/src/ble/adapter.ts`

**Step 1: Write the file**

```typescript
// src/renderer/src/ble/adapter.ts

export interface DeviceInfo {
  id: string
  name: string
}

export type DataHandler = (data: Uint8Array) => void
export type DisconnectHandler = () => void
export type DeviceFoundHandler = (device: DeviceInfo) => void

export interface BleAdapter {
  /** Start scanning. Calls onFound for each discovered device. */
  startScan(onFound: DeviceFoundHandler): void
  /** Select a device (ends scan) and connect to it. */
  selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void>
  disconnect(): Promise<void>
}

export function createBleAdapter(): BleAdapter {
  if (window.deskbike.isMock) {
    // Dynamic import to keep mock out of production bundle
    return new (require('./mock').MockAdapter)()
  }
  return new (require('./web-bluetooth').WebBluetoothAdapter)()
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/ble/adapter.ts
git commit -m "feat: add BleAdapter interface and factory"
```

---

### Task 3: Create MockAdapter in renderer

The mock generates synthetic CSC packets using the same sine/cosine logic as the old `src/main/ble/mock.ts`, but rewritten without `Buffer` (uses `DataView` instead).

**Files:**
- Create: `src/renderer/src/ble/mock.ts`

**Step 1: Write the file**

```typescript
// src/renderer/src/ble/mock.ts

import type { BleAdapter, DeviceFoundHandler, DataHandler, DisconnectHandler } from './adapter'

const MOCK_DEVICE_ID = 'mock-0'
const INTERVAL_MS = 1000
const WHEEL_CIRCUMFERENCE_M = 2.1

let wheelRevs = 0.0
let wheelTimeTicks = 0.0
let crankRevs = 0.0
let crankTimeTicks = 0.0

function buildPacket(): Uint8Array {
  const dt = INTERVAL_MS / 1000
  const phase = ((Date.now() % 60_000) / 60_000) * 2 * Math.PI

  const speedKmh = 17.5 + 2.5 * Math.sin(phase)   // 15–20 km/h
  const cadenceRpm = 70 + 5 * Math.cos(phase)      // 65–75 RPM

  wheelRevs += (speedKmh / 3.6 / WHEEL_CIRCUMFERENCE_M) * dt
  wheelTimeTicks += dt * 1024
  crankRevs += (cadenceRpm / 60) * dt
  crankTimeTicks += dt * 1024

  const buf = new Uint8Array(11)
  const view = new DataView(buf.buffer)
  view.setUint8(0, 0x03)
  view.setUint32(1, Math.round(wheelRevs) >>> 0, true)
  view.setUint16(5, Math.round(wheelTimeTicks) & 0xffff, true)
  view.setUint16(7, Math.round(crankRevs) & 0xffff, true)
  view.setUint16(9, Math.round(crankTimeTicks) & 0xffff, true)
  return buf
}

export class MockAdapter implements BleAdapter {
  private timer: ReturnType<typeof setInterval> | null = null

  startScan(onFound: DeviceFoundHandler): void {
    onFound({ id: MOCK_DEVICE_ID, name: 'DeskBike-MOCK' })
  }

  async selectDevice(
    _deviceId: string,
    onData: DataHandler,
    _onDisconnect: DisconnectHandler
  ): Promise<void> {
    this.timer = setInterval(() => onData(buildPacket()), INTERVAL_MS)
  }

  async disconnect(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/ble/mock.ts
git commit -m "feat: add renderer-side MockAdapter"
```

---

### Task 4: Update queries.ts — accept pre-parsed fields, remove csc-parser dependency

After migration the renderer parses CSC data and sends all fields to main. Main no longer calls `parseRawCsc` — it receives the parsed fields directly and only does delta computation (inlined).

**Files:**
- Modify: `src/main/db/queries.ts`

**Step 1: Replace the file content**

```typescript
// src/main/db/queries.ts

import { eq, desc } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { getDb } from './index'
import { measurements } from './schema'

export interface InsertMeasurementInput {
  sensorId: string
  timestampUtc: string  // ISO 8601
  rawData: number[]     // Uint8Array serialized as number[] for IPC transfer
  hasWheelData: boolean
  hasCrankData: boolean
  wheelRevs: number | null
  wheelTime: number | null
  crankRevs: number | null
  crankTime: number | null
}

export function insertMeasurement(input: InsertMeasurementInput): void {
  const db = getDb()

  const prev = db
    .select()
    .from(measurements)
    .where(eq(measurements.sensorId, input.sensorId))
    .orderBy(desc(measurements.timestampUtc))
    .limit(1)
    .all()[0]

  const timeDiffMs = prev
    ? new Date(input.timestampUtc).getTime() - new Date(prev.timestampUtc).getTime()
    : null

  let wheelRevsDiff: number | null = null
  let wheelTimeDiff: number | null = null
  let crankRevsDiff: number | null = null
  let crankTimeDiff: number | null = null

  if (prev && timeDiffMs !== null) {
    if (input.hasWheelData && prev.hasWheelData &&
        input.wheelRevs !== null && prev.wheelRevs !== null &&
        input.wheelTime !== null && prev.wheelTime !== null) {
      wheelRevsDiff = (input.wheelRevs - prev.wheelRevs) >>> 0
      wheelTimeDiff = (input.wheelTime - prev.wheelTime) & 0xffff
    }
    if (input.hasCrankData && prev.hasCrankData &&
        input.crankRevs !== null && prev.crankRevs !== null &&
        input.crankTime !== null && prev.crankTime !== null) {
      crankRevsDiff = (input.crankRevs - prev.crankRevs) & 0xffff
      crankTimeDiff = (input.crankTime - prev.crankTime) & 0xffff
    }
  }

  db.insert(measurements)
    .values({
      id: randomUUID(),
      sensorId: input.sensorId,
      timestampUtc: input.timestampUtc,
      rawData: Buffer.from(input.rawData),
      hasWheelData: input.hasWheelData,
      hasCrankData: input.hasCrankData,
      wheelRevs: input.wheelRevs,
      wheelTime: input.wheelTime,
      crankRevs: input.crankRevs,
      crankTime: input.crankTime,
      timeDiffMs,
      wheelRevsDiff,
      wheelTimeDiff,
      crankRevsDiff,
      crankTimeDiff
    })
    .run()
}

export function getRecentMeasurements(sensorId: string, limit = 100) {
  const db = getDb()
  return db
    .select()
    .from(measurements)
    .where(eq(measurements.sensorId, sensorId))
    .orderBy(desc(measurements.timestampUtc))
    .limit(limit)
    .all()
}
```

**Step 2: Run tests (should still pass)**

```bash
pnpm test
```

Expected: `9 passed`

**Step 3: Commit**

```bash
git add src/main/db/queries.ts
git commit -m "refactor: queries.ts accepts pre-parsed CSC fields, removes csc-parser dependency"
```

---

### Task 5: Update preload API and renderer type declarations

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

**Step 1: Replace preload**

```typescript
// src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('deskbike', {
  // True when MOCK_BLE=1 — renderer uses MockAdapter instead of WebBluetoothAdapter
  isMock: process.env['MOCK_BLE'] === '1',

  // Main → Renderer: Electron found BLE devices (fires as scan progresses)
  onDevicesFound: (cb: (devices: Array<{ deviceId: string; deviceName: string }>) => void) => {
    ipcRenderer.on('ble:devices-found', (_e, v) => cb(v))
  },

  // Renderer → Main: tell Electron which device the user selected
  selectBleDevice: (deviceId: string) => ipcRenderer.invoke('ble:select-device', deviceId),

  // Renderer → Main: persist a parsed measurement to the DB
  saveMeasurement: (data: {
    sensorId: string
    timestampUtc: string
    rawData: number[]
    hasWheelData: boolean
    hasCrankData: boolean
    wheelRevs: number | null
    wheelTime: number | null
    crankRevs: number | null
    crankTime: number | null
  }) => ipcRenderer.invoke('ble:save-measurement', data),
})
```

**Step 2: Replace env.d.ts**

```typescript
// src/renderer/src/env.d.ts

interface BtDevice {
  deviceId: string
  deviceName: string
}

interface MeasurementData {
  sensorId: string
  timestampUtc: string
  rawData: number[]
  hasWheelData: boolean
  hasCrankData: boolean
  wheelRevs: number | null
  wheelTime: number | null
  crankRevs: number | null
  crankTime: number | null
}

interface Window {
  deskbike: {
    isMock: boolean
    onDevicesFound: (cb: (devices: BtDevice[]) => void) => void
    selectBleDevice: (deviceId: string) => Promise<void>
    saveMeasurement: (data: MeasurementData) => Promise<void>
  }
}
```

**Step 3: Commit**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "refactor: simplify preload API — BLE moves to renderer"
```

---

### Task 6: Update main process — session handler and IPC handlers

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/handlers.ts`

**Step 1: Replace handlers.ts**

```typescript
// src/main/ipc/handlers.ts

import { ipcMain } from 'electron'
import { insertMeasurement } from '../db/queries'

let pendingBluetoothCallback: ((deviceId: string) => void) | null = null

export function setPendingBluetoothCallback(cb: ((deviceId: string) => void) | null): void {
  pendingBluetoothCallback = cb
}

export function registerIpcHandlers(): void {
  // Called by renderer when user clicks a device in our scan UI
  ipcMain.handle('ble:select-device', (_e, deviceId: string) => {
    if (pendingBluetoothCallback) {
      pendingBluetoothCallback(deviceId)
      pendingBluetoothCallback = null
    }
  })

  // Called by renderer with parsed measurement data for DB persistence
  ipcMain.handle('ble:save-measurement', (_e, data) => {
    insertMeasurement(data)
  })
}
```

**Step 2: Replace index.ts**

```typescript
// src/main/index.ts

import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { initDb } from './db/index'
import { registerIpcHandlers, setPendingBluetoothCallback } from './ipc/handlers'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Intercept Electron's Bluetooth device picker so our renderer UI acts as the picker
  session.defaultSession.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault()
    setPendingBluetoothCallback(callback)
    win.webContents.send('ble:devices-found', deviceList)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  initDb()
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

**Step 3: Run tests (should still pass)**

```bash
pnpm test
```

Expected: `9 passed`

**Step 4: Commit**

```bash
git add src/main/index.ts src/main/ipc/handlers.ts
git commit -m "feat: add select-bluetooth-device session handler, simplify IPC handlers"
```

---

### Task 7: Create WebBluetoothAdapter

This adapter calls `navigator.bluetooth.requestDevice()` (which "hangs" until a device is selected) and exposes scanning as a streaming callback by listening for `ble:devices-found` IPC messages that the main process emits as Electron discovers devices.

**Files:**
- Create: `src/renderer/src/ble/web-bluetooth.ts`

**Step 1: Write the file**

```typescript
// src/renderer/src/ble/web-bluetooth.ts

import type { BleAdapter, DeviceFoundHandler, DataHandler, DisconnectHandler } from './adapter'

const CSC_SERVICE = 0x1816
const CSC_MEASUREMENT_CHAR = 0x2a5b

export class WebBluetoothAdapter implements BleAdapter {
  private pendingDevice: Promise<BluetoothDevice> | null = null
  private currentDevice: BluetoothDevice | null = null

  startScan(onFound: DeviceFoundHandler): void {
    // Forward devices from main (select-bluetooth-device session event)
    window.deskbike.onDevicesFound((devices) => {
      for (const d of devices) {
        onFound({ id: d.deviceId, name: d.deviceName || d.deviceId })
      }
    })

    // requestDevice() starts BLE scanning and "hangs" until selectDevice() is called.
    // Must be called synchronously inside a user gesture handler (button click).
    this.pendingDevice = navigator.bluetooth.requestDevice({
      filters: [{ services: [CSC_SERVICE] }]
    })
  }

  async selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void> {
    if (!this.pendingDevice) throw new Error('Call startScan() before selectDevice()')

    // Signal main to call the stored select-bluetooth-device callback.
    // This resolves the pending requestDevice() promise.
    await window.deskbike.selectBleDevice(deviceId)

    const device = await this.pendingDevice
    this.pendingDevice = null
    this.currentDevice = device

    device.addEventListener('gattserverdisconnected', () => {
      this.currentDevice = null
      onDisconnect()
    })

    const server = await device.gatt!.connect()
    const service = await server.getPrimaryService(CSC_SERVICE)
    const characteristic = await service.getCharacteristic(CSC_MEASUREMENT_CHAR)

    characteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic
      const dv = target.value!
      onData(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))
    })

    await characteristic.startNotifications()
  }

  async disconnect(): Promise<void> {
    if (this.currentDevice?.gatt?.connected) {
      this.currentDevice.gatt.disconnect()
    }
    this.currentDevice = null
    this.pendingDevice = null
  }
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/ble/web-bluetooth.ts
git commit -m "feat: add WebBluetoothAdapter using navigator.bluetooth"
```

---

### Task 8: Update App.tsx

BLE logic moves into the component. The adapter is created once on mount. Scan, device selection, and data handling all go through the adapter.

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Step 1: Replace App.tsx**

```typescript
// src/renderer/src/App.tsx

import { useEffect, useRef, useState } from 'react'
import { createBleAdapter } from './ble/adapter'
import type { BleAdapter, DeviceInfo } from './ble/adapter'
import { parseRawCsc } from './ble/csc-parser'

export default function App() {
  const adapter = useRef<BleAdapter | null>(null)
  const [status, setStatus] = useState('idle')
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [packetCount, setPacketCount] = useState(0)
  const [lastHex, setLastHex] = useState<string | null>(null)

  useEffect(() => {
    adapter.current = createBleAdapter()
  }, [])

  function handleScan(): void {
    setDevices([])
    setStatus('scanning')
    adapter.current!.startScan((device) => {
      setDevices((prev) => prev.find((d) => d.id === device.id) ? prev : [...prev, device])
    })
  }

  async function handleConnect(deviceId: string): Promise<void> {
    setStatus('connecting')
    try {
      await adapter.current!.selectDevice(
        deviceId,
        (data) => {
          const parsed = parseRawCsc(data)
          const timestampUtc = new Date().toISOString()
          setPacketCount((n) => n + 1)
          setLastHex(Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' '))
          window.deskbike.saveMeasurement({
            sensorId: deviceId,
            timestampUtc,
            rawData: Array.from(data),
            hasWheelData: parsed.hasWheelData,
            hasCrankData: parsed.hasCrankData,
            wheelRevs: parsed.wheelRevs,
            wheelTime: parsed.wheelTime,
            crankRevs: parsed.crankRevs,
            crankTime: parsed.crankTime,
          })
        },
        () => setStatus('disconnected')
      )
      setStatus('connected')
    } catch (err) {
      console.error('[BLE] connect failed:', err)
      setStatus('error')
    }
  }

  async function handleDisconnect(): Promise<void> {
    await adapter.current!.disconnect()
    setStatus('disconnected')
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>DeskBike — diagnostic view</h2>
      <p>Status: <strong>{status}</strong></p>

      <button onClick={handleScan}>Scan</button>
      {' '}
      <button onClick={handleDisconnect}>Disconnect</button>

      {devices.length > 0 && (
        <div>
          <h3>Devices found:</h3>
          <ul>
            {devices.map((d) => (
              <li key={d.id}>
                {d.name} ({d.id}){' '}
                <button onClick={() => handleConnect(d.id)}>Connect</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastHex && (
        <div>
          <h3>Live data (packet #{packetCount})</h3>
          <p>Raw bytes: <code>{lastHex}</code></p>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Run tests**

```bash
pnpm test
```

Expected: `9 passed`

**Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: App.tsx uses BleAdapter directly, BLE logic moved from main to renderer"
```

---

### Task 9: Clean up — delete old main BLE files and update package.json

**Files:**
- Delete: `src/main/ble/scanner.ts`
- Delete: `src/main/ble/connection.ts`
- Delete: `src/main/ble/mock.ts`
- Delete: `src/main/ble/csc-parser.ts`
- Modify: `package.json`

**Step 1: Delete old files**

```bash
rm src/main/ble/scanner.ts src/main/ble/connection.ts src/main/ble/mock.ts src/main/ble/csc-parser.ts
rmdir src/main/ble
```

**Step 2: Update package.json**

Remove `@stoprocent/noble` from `dependencies`.
Remove `setup:ble` from `scripts`.
Update `postinstall` to only rebuild `better-sqlite3` (noble is gone):

```json
"postinstall": "electron-rebuild -f -w better-sqlite3",
```

Final scripts section:
```json
"scripts": {
  "dev": "electron-vite dev",
  "dev:mock": "MOCK_BLE=1 electron-vite dev",
  "build": "electron-vite build",
  "preview": "electron-vite preview",
  "postinstall": "electron-rebuild -f -w better-sqlite3",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "emulator": "tsx scripts/emulator.ts"
}
```

**Step 3: Remove noble from node_modules**

```bash
pnpm remove @stoprocent/noble
```

**Step 4: Run tests — all 9 must still pass**

```bash
pnpm test
```

Expected: `9 passed`

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove noble, scanner.ts, connection.ts, old mock and csc-parser from main"
```

---

### Task 10: Update CLAUDE.md and verify end-to-end

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Remove the Linux BLE permissions section from CLAUDE.md**

Remove the block that starts with `**Linux BLE permissions (required for real hardware):**` (added in the previous debugging session — no longer relevant after migration).

Also update the BLE emulator note to reflect that `noble` no longer conflicts (only `bleno` is used now for the emulator peripheral, and `navigator.bluetooth` is used for central — different subsystems, no conflict).

**Step 2: Verify mock mode**

```bash
pnpm dev:mock
```

Expected in terminal:
```
[BLE] mode: SOFTWARE MOCK (DeskBike-MOCK)   ← this log still comes from handlers.ts... wait, actually handlers.ts was replaced.
```

Actually after the migration, the `[BLE] mode:` log is gone (it was in the old `handlers.ts`). That's fine. Verify the app starts, click "Scan", see `DeskBike-MOCK` in the device list, click "Connect", see live data packets arriving.

**Step 3: Verify real hardware (if available)**

```bash
pnpm dev
```

Click "Scan". App should discover the deskbike without any `setcap` required. Click the device name, live packets should arrive.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — remove Linux setcap requirement after Web Bluetooth migration"
```

---

## Post-migration checklist

- [ ] `pnpm test` → 9 passed
- [ ] `pnpm dev:mock` → DeskBike-MOCK appears, live data flows
- [ ] `pnpm dev` (real hardware, no sudo) → deskbike appears in scan, live data flows
- [ ] `src/main/ble/` directory is gone
- [ ] `@stoprocent/noble` not in `package.json`
- [ ] No `setup:ble` script in `package.json`
