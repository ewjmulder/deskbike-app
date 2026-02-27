# Bleak Helper Process Implementation Plan

> **Status update (2026-02-27):** Implemented.
> This plan matches the chosen BLE architecture (Python helper + IPC bridge).
> Current source of truth remains the runtime code and `docs/Architecture.md`.


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken Web Bluetooth renderer approach with a Python + bleak helper process that runs natively per platform and communicates with Electron via JSON lines over stdin/stdout.

**Architecture:** The Electron main process spawns `src/helpers/ble_helper.py` as a child process. Commands flow from main → helper via stdin (JSON lines); events flow back via stdout (JSON lines). Main forwards BLE events to the renderer via IPC. The renderer's `BleAdapter` interface stays identical — only the concrete `IpcBleAdapter` implementation changes, so `App.tsx` is untouched.

**Tech Stack:** Python 3 + bleak (cross-platform BLE via D-Bus/CoreBluetooth/WinRT), Node.js `child_process.spawn`, Electron IPC, existing TypeScript BleAdapter interface.

---

## Protocol reference (stdin/stdout JSON lines)

**Main → Helper (stdin):**
```json
{"cmd": "scan"}
{"cmd": "connect", "device_id": "XX:XX:XX:XX:XX:XX"}
{"cmd": "disconnect"}
```

**Helper → Main (stdout):**
```json
{"type": "device", "id": "XX:XX:XX:XX:XX:XX", "name": "DeskBike-13851"}
{"type": "connected"}
{"type": "data", "raw": [3, 10, 0, 0, 0, 200, 4, 35, 0, 100, 4]}
{"type": "disconnected"}
{"type": "error", "message": "Device not found"}
```

---

## New `window.deskbike` API (preload)

```typescript
interface Window {
  deskbike: {
    isMock: boolean
    // Renderer → Main (ipcRenderer.invoke)
    scanStart: () => Promise<void>
    connect: (deviceId: string) => Promise<void>   // resolves when connected
    disconnect: () => Promise<void>
    saveMeasurement: (data: MeasurementData) => Promise<void>
    // Main → Renderer (ipcRenderer.on)
    onDeviceFound: (cb: (device: { id: string; name: string }) => void) => void
    onData: (cb: (raw: number[]) => void) => void
    onDisconnected: (cb: () => void) => void
    onBleError: (cb: (message: string) => void) => void
  }
}
```

---

## Task 1: Python BLE helper script

**Files:**
- Create: `src/helpers/ble_helper.py`
- Create: `requirements.txt`

**Step 1: Create `requirements.txt`**

```
bleak>=0.22
```

**Step 2: Create `src/helpers/ble_helper.py`**

```python
#!/usr/bin/env python3
"""
DeskBike BLE helper process.

Communicates with Electron main process via stdin/stdout using
newline-delimited JSON.

Commands (stdin):
  {"cmd": "scan"}
  {"cmd": "connect", "device_id": "XX:XX:XX:XX:XX:XX"}
  {"cmd": "disconnect"}

Events (stdout):
  {"type": "device", "id": "...", "name": "..."}
  {"type": "connected"}
  {"type": "data", "raw": [...]}
  {"type": "disconnected"}
  {"type": "error", "message": "..."}
"""

import asyncio
import json
import sys
from bleak import BleakScanner, BleakClient

CSC_SERVICE = "00001816-0000-1000-8000-00805f9b34fb"
CSC_MEASUREMENT = "00002a5b-0000-1000-8000-00805f9b34fb"


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


class BleManager:
    def __init__(self) -> None:
        self._connect_event: asyncio.Event = asyncio.Event()
        self._disconnect_event: asyncio.Event = asyncio.Event()
        self._connect_device_id: str | None = None
        self._client: BleakClient | None = None

    def request_connect(self, device_id: str) -> None:
        self._connect_device_id = device_id
        self._connect_event.set()

    def request_disconnect(self) -> None:
        self._disconnect_event.set()

    async def scan(self) -> None:
        seen: set[str] = set()

        def on_detection(device, _ad_data) -> None:
            if device.address not in seen:
                seen.add(device.address)
                emit({"type": "device", "id": device.address, "name": device.name or device.address})

        async with BleakScanner(on_detection):
            # Block until a connect command arrives
            await self._connect_event.wait()
        self._connect_event.clear()

    async def connect(self, device_id: str) -> None:
        def on_disconnect(_client: BleakClient) -> None:
            emit({"type": "disconnected"})
            self._disconnect_event.set()

        try:
            async with BleakClient(device_id, disconnected_callback=on_disconnect) as client:
                self._client = client
                emit({"type": "connected"})

                async def on_notify(_char, data: bytearray) -> None:
                    emit({"type": "data", "raw": list(data)})

                await client.start_notify(CSC_MEASUREMENT, on_notify)

                # Wait until disconnect is requested or device disconnects on its own
                await self._disconnect_event.wait()
                self._disconnect_event.clear()

                try:
                    await client.stop_notify(CSC_MEASUREMENT)
                except Exception:
                    pass
        except Exception as exc:
            emit({"type": "error", "message": str(exc)})
        finally:
            self._client = None


async def read_commands(manager: BleManager) -> None:
    loop = asyncio.get_event_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue

        if cmd.get("cmd") == "scan":
            asyncio.create_task(manager.scan())
        elif cmd.get("cmd") == "connect":
            device_id = cmd.get("device_id", "")
            manager.request_connect(device_id)
            asyncio.create_task(manager.connect(device_id))
        elif cmd.get("cmd") == "disconnect":
            manager.request_disconnect()


async def main() -> None:
    manager = BleManager()
    await read_commands(manager)


if __name__ == "__main__":
    asyncio.run(main())
```

**Step 3: Install bleak and test the helper manually**

```bash
pip install bleak
# Start scanning (Ctrl+C after a few seconds)
echo '{"cmd": "scan"}' | python3 src/helpers/ble_helper.py
```

Expected output: JSON lines like `{"type": "device", "id": "XX:XX:XX:XX", "name": "..."}` for each discovered BLE device.

**Step 4: Commit**

```bash
git add src/helpers/ble_helper.py requirements.txt
git commit -m "feat: add Python BLE helper process with bleak (JSON lines protocol)"
```

---

## Task 2: BleHelper class in main process

**Files:**
- Create: `src/main/ble/helper.ts`

**Step 1: Write a unit test for BleHelper**

```typescript
// tests/main/ble/helper.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// BleHelper is hard to unit test without a real child process.
// We test the JSON parsing logic in isolation.
import { parseHelperLine } from '../../../src/main/ble/helper'

describe('parseHelperLine', () => {
  it('parses device event', () => {
    const event = parseHelperLine('{"type": "device", "id": "AA:BB", "name": "Bike"}')
    expect(event).toEqual({ type: 'device', id: 'AA:BB', name: 'Bike' })
  })

  it('parses data event', () => {
    const event = parseHelperLine('{"type": "data", "raw": [3, 10, 0]}')
    expect(event).toEqual({ type: 'data', raw: [3, 10, 0] })
  })

  it('returns null for invalid JSON', () => {
    expect(parseHelperLine('not json')).toBeNull()
  })

  it('returns null for empty line', () => {
    expect(parseHelperLine('')).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm test -- tests/main/ble/helper.test.ts
```

Expected: FAIL — `parseHelperLine` not found.

**Step 3: Create `src/main/ble/helper.ts`**

```typescript
// src/main/ble/helper.ts

import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { join } from 'path'
import { app } from 'electron'

export type HelperEvent =
  | { type: 'device'; id: string; name: string }
  | { type: 'connected' }
  | { type: 'data'; raw: number[] }
  | { type: 'disconnected' }
  | { type: 'error'; message: string }

export type HelperEventHandler = (event: HelperEvent) => void

/** Parse one line from the helper's stdout. Returns null if invalid. */
export function parseHelperLine(line: string): HelperEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as HelperEvent
  } catch {
    return null
  }
}

export class BleHelper {
  private process: ChildProcess | null = null
  private onEvent: HelperEventHandler | null = null

  setEventHandler(handler: HelperEventHandler): void {
    this.onEvent = handler
  }

  start(): void {
    const helperPath = app.isPackaged
      ? join(process.resourcesPath, 'helpers', 'ble_helper.py')
      : join(app.getAppPath(), 'src', 'helpers', 'ble_helper.py')

    console.log(`[BleHelper] spawning python3 ${helperPath}`)
    this.process = spawn('python3', [helperPath])

    const rl = createInterface({ input: this.process.stdout! })
    rl.on('line', (line) => {
      console.log(`[BleHelper] stdout: ${line}`)
      const event = parseHelperLine(line)
      if (event) this.onEvent?.(event)
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      console.error('[BleHelper] stderr:', data.toString())
    })

    this.process.on('exit', (code) => {
      console.log(`[BleHelper] process exited with code ${code}`)
      this.process = null
    })
  }

  send(cmd: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      console.warn('[BleHelper] send: no process stdin')
      return
    }
    const line = JSON.stringify(cmd) + '\n'
    console.log(`[BleHelper] stdin: ${line.trim()}`)
    this.process.stdin.write(line)
  }

  stop(): void {
    this.process?.kill()
    this.process = null
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm test -- tests/main/ble/helper.test.ts
```

Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/main/ble/helper.ts tests/main/ble/helper.test.ts
git commit -m "feat: add BleHelper class to spawn and communicate with Python helper"
```

---

## Task 3: Update IPC handlers in main process

**Files:**
- Modify: `src/main/ipc/handlers.ts`

The handlers need access to:
- `BleHelper` instance (to send commands)
- `WebContents` reference (to push events to renderer)
- `connectResolve`/`connectReject` to resolve the `ble:connect` invoke promise

**Step 1: Replace `src/main/ipc/handlers.ts`**

```typescript
// src/main/ipc/handlers.ts

import { ipcMain, WebContents } from 'electron'
import { insertMeasurement, InsertMeasurementInput } from '../db/queries'
import { BleHelper } from '../ble/helper'

type Resolve = () => void
type Reject = (err: Error) => void

export function registerIpcHandlers(webContents: WebContents, helper: BleHelper): void {
  console.log('[IPC] registerIpcHandlers')

  // Forward helper events to renderer
  helper.setEventHandler((event) => {
    console.log(`[IPC] helper event: ${event.type}`)
    switch (event.type) {
      case 'device':
        webContents.send('ble:device-found', { id: event.id, name: event.name })
        break
      case 'connected':
        pendingConnectResolve?.()
        pendingConnectResolve = null
        pendingConnectReject = null
        break
      case 'data':
        webContents.send('ble:data', event.raw)
        break
      case 'disconnected':
        webContents.send('ble:disconnected')
        break
      case 'error':
        pendingConnectReject?.(new Error(event.message))
        pendingConnectResolve = null
        pendingConnectReject = null
        webContents.send('ble:error', event.message)
        break
    }
  })

  let pendingConnectResolve: Resolve | null = null
  let pendingConnectReject: Reject | null = null

  ipcMain.handle('ble:scan-start', () => {
    console.log('[IPC] ble:scan-start')
    helper.send({ cmd: 'scan' })
  })

  ipcMain.handle('ble:connect', (_e, deviceId: string) => {
    console.log(`[IPC] ble:connect → ${deviceId}`)
    return new Promise<void>((resolve, reject) => {
      pendingConnectResolve = resolve
      pendingConnectReject = reject
      helper.send({ cmd: 'connect', device_id: deviceId })
    })
  })

  ipcMain.handle('ble:disconnect', () => {
    console.log('[IPC] ble:disconnect')
    helper.send({ cmd: 'disconnect' })
  })

  ipcMain.handle('ble:save-measurement', (_e, data: InsertMeasurementInput) => {
    console.log(`[IPC] ble:save-measurement: sensorId=${data.sensorId}`)
    insertMeasurement(data)
  })
}
```

**Step 2: Commit**

```bash
git add src/main/ipc/handlers.ts
git commit -m "feat: update IPC handlers for bleak helper process (scan/connect/disconnect/events)"
```

---

## Task 4: Update main process entry point

**Files:**
- Modify: `src/main/index.ts`

Remove: Web Bluetooth flag, `select-bluetooth-device` handler, permission handler.
Add: `BleHelper` instantiation and `registerIpcHandlers` call with new signature.

**Step 1: Replace `src/main/index.ts`**

```typescript
// src/main/index.ts

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { initDb } from './db/index'
import { registerIpcHandlers } from './ipc/handlers'
import { BleHelper } from './ble/helper'

const helper = new BleHelper()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Forward renderer console output to terminal
  const levels = ['V', 'I', 'W', 'E']
  win.webContents.on('console-message', (_e, level, message) => {
    const prefix = `[renderer:${levels[level] ?? '?'}]`
    if (level >= 2) {
      console.error(prefix, message)
    } else {
      console.log(prefix, message)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const isMock = process.env['MOCK_BLE'] === '1'
  console.log(`[Main] app ready — MOCK_BLE=${isMock ? '1' : 'unset'}`)
  initDb()

  const win = createWindow()

  if (!isMock) {
    helper.start()
  }

  registerIpcHandlers(win.webContents, helper)
  console.log('[Main] window created')
})

app.on('window-all-closed', () => {
  helper.stop()
  if (process.platform !== 'darwin') app.quit()
})
```

**Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: update main process to spawn BleHelper; remove Web Bluetooth session handlers"
```

---

## Task 5: Update preload

**Files:**
- Modify: `src/preload/index.ts`

**Step 1: Replace `src/preload/index.ts`**

```typescript
// src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron'

const isMock = process.env['MOCK_BLE'] === '1'
console.log(`[Preload] init — isMock=${isMock}`)

contextBridge.exposeInMainWorld('deskbike', {
  isMock,

  // Renderer → Main: start BLE scan
  scanStart: () => {
    console.log('[Preload] scanStart')
    return ipcRenderer.invoke('ble:scan-start')
  },

  // Renderer → Main: connect to device (resolves when connected)
  connect: (deviceId: string) => {
    console.log(`[Preload] connect → ${deviceId}`)
    return ipcRenderer.invoke('ble:connect', deviceId)
  },

  // Renderer → Main: disconnect
  disconnect: () => {
    console.log('[Preload] disconnect')
    return ipcRenderer.invoke('ble:disconnect')
  },

  // Renderer → Main: persist measurement to DB
  saveMeasurement: (data: object) => {
    console.log('[Preload] saveMeasurement')
    return ipcRenderer.invoke('ble:save-measurement', data)
  },

  // Main → Renderer: BLE device found during scan
  onDeviceFound: (cb: (device: { id: string; name: string }) => void) => {
    ipcRenderer.on('ble:device-found', (_e, device) => {
      console.log(`[Preload] ble:device-found: ${device.name} (${device.id})`)
      cb(device)
    })
  },

  // Main → Renderer: raw CSC packet received
  onData: (cb: (raw: number[]) => void) => {
    ipcRenderer.on('ble:data', (_e, raw) => cb(raw))
  },

  // Main → Renderer: device disconnected
  onDisconnected: (cb: () => void) => {
    ipcRenderer.on('ble:disconnected', () => {
      console.log('[Preload] ble:disconnected')
      cb()
    })
  },

  // Main → Renderer: BLE error
  onBleError: (cb: (message: string) => void) => {
    ipcRenderer.on('ble:error', (_e, message) => {
      console.warn(`[Preload] ble:error: ${message}`)
      cb(message)
    })
  },
})
```

**Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: update preload with new IPC channels for bleak helper protocol"
```

---

## Task 6: Create IpcBleAdapter and update adapter factory

**Files:**
- Create: `src/renderer/src/ble/ipc-adapter.ts`
- Modify: `src/renderer/src/ble/adapter.ts`
- Delete: `src/renderer/src/ble/web-bluetooth.ts`

**Step 1: Write a unit test for IpcBleAdapter**

```typescript
// tests/ble/ipc-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IpcBleAdapter } from '../../src/renderer/src/ble/ipc-adapter'

// Mock window.deskbike
const mockDeskbike = {
  isMock: false,
  scanStart: vi.fn().mockResolvedValue(undefined),
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  saveMeasurement: vi.fn().mockResolvedValue(undefined),
  onDeviceFound: vi.fn(),
  onData: vi.fn(),
  onDisconnected: vi.fn(),
  onBleError: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  // @ts-expect-error — mock global
  global.window = { deskbike: mockDeskbike }
})

describe('IpcBleAdapter', () => {
  it('startScan registers onDeviceFound and calls scanStart', () => {
    const adapter = new IpcBleAdapter()
    const onFound = vi.fn()
    adapter.startScan(onFound)
    expect(mockDeskbike.onDeviceFound).toHaveBeenCalledOnce()
    expect(mockDeskbike.scanStart).toHaveBeenCalledOnce()
  })

  it('selectDevice registers onData, onDisconnected and calls connect', async () => {
    const adapter = new IpcBleAdapter()
    const onData = vi.fn()
    const onDisconnect = vi.fn()
    await adapter.selectDevice('AA:BB', onData, onDisconnect)
    expect(mockDeskbike.onData).toHaveBeenCalledOnce()
    expect(mockDeskbike.onDisconnected).toHaveBeenCalledOnce()
    expect(mockDeskbike.connect).toHaveBeenCalledWith('AA:BB')
  })

  it('disconnect calls window.deskbike.disconnect', async () => {
    const adapter = new IpcBleAdapter()
    await adapter.disconnect()
    expect(mockDeskbike.disconnect).toHaveBeenCalledOnce()
  })

  it('onData callback receives Uint8Array from raw number array', async () => {
    const adapter = new IpcBleAdapter()
    const onData = vi.fn()
    await adapter.selectDevice('AA:BB', onData, vi.fn())

    // Simulate main pushing ble:data
    const rawCallback = mockDeskbike.onData.mock.calls[0][0]
    rawCallback([3, 10, 0, 0, 0, 200, 4, 35, 0, 100, 4])

    expect(onData).toHaveBeenCalledWith(new Uint8Array([3, 10, 0, 0, 0, 200, 4, 35, 0, 100, 4]))
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm test -- tests/ble/ipc-adapter.test.ts
```

Expected: FAIL — `IpcBleAdapter` not found.

**Step 3: Create `src/renderer/src/ble/ipc-adapter.ts`**

```typescript
// src/renderer/src/ble/ipc-adapter.ts

import type { BleAdapter, DeviceFoundHandler, DataHandler, DisconnectHandler } from './adapter'

export class IpcBleAdapter implements BleAdapter {
  startScan(onFound: DeviceFoundHandler): void {
    console.log('[IpcBleAdapter] startScan')
    window.deskbike.onDeviceFound((device) => {
      console.log(`[IpcBleAdapter] device found: ${device.name} (${device.id})`)
      onFound({ id: device.id, name: device.name })
    })
    window.deskbike.scanStart()
  }

  async selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void> {
    console.log(`[IpcBleAdapter] selectDevice: ${deviceId}`)
    window.deskbike.onData((raw) => onData(new Uint8Array(raw)))
    window.deskbike.onDisconnected(onDisconnect)
    await window.deskbike.connect(deviceId)
    console.log('[IpcBleAdapter] connected')
  }

  async disconnect(): Promise<void> {
    console.log('[IpcBleAdapter] disconnect')
    await window.deskbike.disconnect()
  }
}
```

**Step 4: Update `src/renderer/src/ble/adapter.ts`**

```typescript
// src/renderer/src/ble/adapter.ts

import { MockAdapter } from './mock'
import { IpcBleAdapter } from './ipc-adapter'

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
  /** Select a device (ends scan) and connect to it. Resolves when connected. */
  selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void>
  disconnect(): Promise<void>
}

export function createBleAdapter(): BleAdapter {
  const isMock = window.deskbike.isMock
  console.log(`[BLE] createBleAdapter: isMock=${isMock}`)
  if (isMock) {
    console.log('[BLE] using MockAdapter')
    return new MockAdapter()
  }
  console.log('[BLE] using IpcBleAdapter')
  return new IpcBleAdapter()
}
```

**Step 5: Run tests to verify passing**

```bash
pnpm test -- tests/ble/ipc-adapter.test.ts
```

Expected: PASS (4 tests).

**Step 6: Delete web-bluetooth.ts**

```bash
rm src/renderer/src/ble/web-bluetooth.ts
```

**Step 7: Commit**

```bash
git add src/renderer/src/ble/ipc-adapter.ts src/renderer/src/ble/adapter.ts
git rm src/renderer/src/ble/web-bluetooth.ts
git commit -m "feat: add IpcBleAdapter; replace WebBluetoothAdapter in factory; delete web-bluetooth.ts"
```

---

## Task 7: Update env.d.ts and clean up App.tsx

**Files:**
- Modify: `src/renderer/src/env.d.ts`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Replace `src/renderer/src/env.d.ts`**

Remove the old Bluetooth / Navigator types, update `window.deskbike`.

```typescript
// src/renderer/src/env.d.ts

interface BtDevice {
  id: string
  name: string
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
    scanStart: () => Promise<void>
    connect: (deviceId: string) => Promise<void>
    disconnect: () => Promise<void>
    saveMeasurement: (data: MeasurementData) => Promise<void>
    onDeviceFound: (cb: (device: BtDevice) => void) => void
    onData: (cb: (raw: number[]) => void) => void
    onDisconnected: (cb: () => void) => void
    onBleError: (cb: (message: string) => void) => void
  }
}
```

**Step 2: Update `src/renderer/src/App.tsx`**

Remove `bleAvailable` state, `navigator.bluetooth` check, `getAvailability()` call, and the old `onDevicesFound`/`selectBleDevice` references. The adapter interface is unchanged so `handleScan`, `handleConnect`, `handleDisconnect` need no logic changes.

Key diff — in `useEffect`:
- Remove `bleAvailable` state and setter
- Remove `navigator.bluetooth` check
- Remove `getAvailability()` call

In the JSX:
- Remove the `navigator.bluetooth: available/MISSING` line

New `useEffect` (mount):
```typescript
useEffect(() => {
  console.log('[App] mount — isMock:', window.deskbike.isMock)
  try {
    adapter.current = createBleAdapter()
    console.log('[App] BleAdapter created:', adapter.current.constructor.name)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[App] createBleAdapter failed:', err)
    setErrorDetail(`createBleAdapter: ${msg}`)
    setStatus('error')
  }
}, [])
```

Also register `onBleError` in `handleScan`:
```typescript
function handleScan(): void {
  if (!adapter.current) { ... }
  setDevices([])
  setErrorDetail(null)
  setStatus('scanning')
  window.deskbike.onBleError((message) => {
    setErrorDetail(`BLE error: ${message}`)
    setStatus('error')
  })
  try {
    adapter.current.startScan((device) => {
      setDevices((prev) => prev.find((d) => d.id === device.id) ? prev : [...prev, device])
    })
  } catch (err) {
    ...
  }
}
```

**Step 3: Run all tests**

```bash
pnpm test
```

Expected: all 17 tests pass (13 existing + 4 IpcBleAdapter).

**Step 4: Commit**

```bash
git add src/renderer/src/env.d.ts src/renderer/src/App.tsx
git commit -m "feat: update env.d.ts and App.tsx for bleak helper IPC API"
```

---

## Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Update the Architecture section to reflect:
- `src/helpers/ble_helper.py` — Python BLE helper process
- `requirements.txt` — bleak dependency
- BLE architecture: main spawns helper via `child_process.spawn`, JSON lines stdio
- Remove Web Bluetooth references
- Update BLE architecture bullet under Key design decisions

Also add to Commands:
```bash
pip install bleak  # one-time: install Python BLE dependency
```

**Step 1: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for bleak helper process architecture"
```

---

## Task 9: Integration test

**Step 1: Start the app**

```bash
pnpm dev
```

Expected: app starts, `[BleHelper] spawning python3 ...` appears in terminal.

**Step 2: Test with mock (no hardware)**

```bash
MOCK_BLE=1 pnpm dev
```

Expected: MockAdapter is used (no helper spawned), scan shows DeskBike-MOCK, connect works.

**Step 3: Test with real hardware (or emulator)**

Start the emulator in a separate terminal:
```bash
pnpm emulator
```

In the app:
1. Click Scan — terminal should show `[BleHelper] stdin: {"cmd":"scan"}` and helper stdout lines with found devices
2. Click Connect on the emulator device — should connect and show live hex data
3. Click Disconnect

**Step 4: Commit final state**

```bash
git add -A
git commit -m "chore: verify bleak helper process integration end-to-end"
```

---

## Scope summary

| File | Action |
|------|--------|
| `src/helpers/ble_helper.py` | Create (Python BLE helper) |
| `requirements.txt` | Create |
| `src/main/ble/helper.ts` | Create (BleHelper class) |
| `src/main/ipc/handlers.ts` | Replace (new IPC handlers) |
| `src/main/index.ts` | Replace (spawn helper, remove Web BT) |
| `src/preload/index.ts` | Replace (new IPC channels) |
| `src/renderer/src/ble/ipc-adapter.ts` | Create (IpcBleAdapter) |
| `src/renderer/src/ble/adapter.ts` | Update (factory uses IpcBleAdapter) |
| `src/renderer/src/ble/web-bluetooth.ts` | Delete |
| `src/renderer/src/env.d.ts` | Replace (new window.deskbike interface) |
| `src/renderer/src/App.tsx` | Update (remove BT availability checks) |
| `CLAUDE.md` | Update |
| `tests/main/ble/helper.test.ts` | Create |
| `tests/ble/ipc-adapter.test.ts` | Create |
