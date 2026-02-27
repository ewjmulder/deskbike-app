# Widget Window Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a separate floating widget window that shows live cycling metrics (speed, cadence, distance, duration) always-on-top of other apps, alongside the existing dashboard window.

**Architecture:** A second `BrowserWindow` (frameless, transparent, always-on-top) loads the same Vite bundle with `?view=widget`. A new `WindowManager` class in the main process manages both windows and broadcasts IPC events to all open windows. A `TrayManager` provides system tray access to show/hide the widget.

**Tech Stack:** Electron `BrowserWindow`, `Tray`, `nativeImage` — all built-in Electron APIs. No new npm packages needed.

---

## Task 1: Settings DB queries

The `settings` table already exists in the schema but has no query functions yet.

**Files:**
- Modify: `src/main/db/queries.ts`
- Test: `tests/main/db/settings.test.ts`

**Step 1: Write failing tests**

Create `tests/main/db/settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

let testDb: ReturnType<typeof drizzle>

vi.mock('../../../src/main/db/index', () => ({
  getDb: () => testDb,
}))

import { getSetting, setSetting } from '../../../src/main/db/queries'

beforeEach(() => {
  const sqlite = new Database(':memory:')
  sqlite.prepare('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run()
  testDb = drizzle(sqlite)
})

describe('getSetting', () => {
  it('returns null for missing key', () => {
    expect(getSetting('nonexistent')).toBeNull()
  })

  it('returns parsed value for existing key', () => {
    setSetting('widget.opacity', 0.8)
    expect(getSetting<number>('widget.opacity')).toBe(0.8)
  })
})

describe('setSetting', () => {
  it('creates a new setting', () => {
    setSetting('widget.alwaysOnTop', true)
    expect(getSetting<boolean>('widget.alwaysOnTop')).toBe(true)
  })

  it('overwrites an existing setting', () => {
    setSetting('widget.opacity', 0.5)
    setSetting('widget.opacity', 1.0)
    expect(getSetting<number>('widget.opacity')).toBe(1.0)
  })

  it('handles object values', () => {
    const bounds = { x: 100, y: 200, width: 280, height: 160 }
    setSetting('widget.bounds', bounds)
    expect(getSetting<typeof bounds>('widget.bounds')).toEqual(bounds)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm test tests/main/db/settings.test.ts
```

Expected: FAIL — `getSetting is not a function`

**Step 3: Implement getSetting and setSetting in queries.ts**

Add `settings` to the import at the top of `src/main/db/queries.ts`:

```typescript
import { measurements, sessions, settings } from './schema'
```

Add at the end of `src/main/db/queries.ts`:

```typescript
export function getSetting<T>(key: string): T | null {
  const db = getDb()
  const row = db.select().from(settings).where(eq(settings.key, key)).all()[0]
  if (!row) return null
  return JSON.parse(row.value) as T
}

export function setSetting<T>(key: string, value: T): void {
  const db = getDb()
  db.insert(settings)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } })
    .run()
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test tests/main/db/settings.test.ts
```

Expected: 5 tests pass.

**Step 5: Commit**

```bash
git add src/main/db/queries.ts tests/main/db/settings.test.ts
git commit -m "feat: add getSetting/setSetting DB queries"
```

---

## Task 2: WindowManager

**Files:**
- Create: `src/main/windows.ts`

**Step 1: Create WindowManager**

Create `src/main/windows.ts`:

```typescript
// src/main/windows.ts

import { BrowserWindow } from 'electron'
import { join } from 'path'
import { getSetting, setSetting } from './db/queries'

type WindowBounds = { x: number; y: number; width: number; height: number }

export class WindowManager {
  private dashboard: BrowserWindow | null = null
  private widget: BrowserWindow | null = null

  private loadUrl(win: BrowserWindow, query?: string): void {
    const base = process.env['ELECTRON_RENDERER_URL']
    if (base) {
      win.loadURL(query ? `${base}?${query}` : base)
    } else {
      win.loadFile(
        join(__dirname, '../renderer/index.html'),
        query ? { query: Object.fromEntries(new URLSearchParams(query)) } : undefined
      )
    }
  }

  createDashboard(): BrowserWindow {
    const win = new BrowserWindow({
      width: 900,
      height: 600,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const levels = ['V', 'I', 'W', 'E']
    win.webContents.on('console-message', (_e, level, message) => {
      const prefix = `[renderer:${levels[level] ?? '?'}]`
      if (level >= 2) console.error(prefix, message)
      else console.log(prefix, message)
    })

    this.loadUrl(win)
    this.dashboard = win
    win.on('closed', () => { this.dashboard = null })
    return win
  }

  createWidget(): BrowserWindow {
    const savedBounds = getSetting<WindowBounds>('widget.bounds')
    const alwaysOnTop = getSetting<boolean>('widget.alwaysOnTop') ?? true

    const win = new BrowserWindow({
      width: savedBounds?.width ?? 280,
      height: savedBounds?.height ?? 160,
      x: savedBounds?.x,
      y: savedBounds?.y,
      minWidth: 200,
      minHeight: 100,
      maxWidth: 420,
      maxHeight: 260,
      frame: false,
      transparent: true,
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    if (alwaysOnTop) {
      if (process.platform === 'darwin') {
        win.setAlwaysOnTop(true, 'floating')
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        win.setWindowButtonVisibility(false)
      } else {
        win.setAlwaysOnTop(true)
        if (process.platform === 'linux') {
          win.setVisibleOnAllWorkspaces(true)
        }
      }
    }

    const opacity = getSetting<number>('widget.opacity') ?? 0.9
    win.setOpacity(opacity)

    // Persist bounds on move/resize
    const saveBounds = (): void => { setSetting('widget.bounds', win.getBounds()) }
    win.on('moved', saveBounds)
    win.on('resized', saveBounds)

    const levels = ['V', 'I', 'W', 'E']
    win.webContents.on('console-message', (_e, level, message) => {
      const prefix = `[widget:${levels[level] ?? '?'}]`
      if (level >= 2) console.error(prefix, message)
      else console.log(prefix, message)
    })

    this.loadUrl(win, 'view=widget')
    this.widget = win
    win.on('closed', () => { this.widget = null })
    return win
  }

  showWidget(): void {
    if (!this.widget || this.widget.isDestroyed()) {
      this.createWidget()
    } else {
      this.widget.show()
    }
  }

  hideWidget(): void { this.widget?.hide() }

  toggleWidget(): void {
    if (!this.widget || this.widget.isDestroyed() || !this.widget.isVisible()) {
      this.showWidget()
    } else {
      this.hideWidget()
    }
  }

  getDashboard(): BrowserWindow | null { return this.dashboard }
  getWidget(): BrowserWindow | null { return this.widget }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const win of [this.dashboard, this.widget]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    }
  }

  setWidgetAlwaysOnTop(value: boolean): void {
    if (!this.widget || this.widget.isDestroyed()) return
    if (value) {
      if (process.platform === 'darwin') {
        this.widget.setAlwaysOnTop(true, 'floating')
      } else {
        this.widget.setAlwaysOnTop(true)
      }
    } else {
      this.widget.setAlwaysOnTop(false)
    }
    setSetting('widget.alwaysOnTop', value)
  }

  setWidgetOpacity(value: number): void {
    if (!this.widget || this.widget.isDestroyed()) return
    this.widget.setOpacity(Math.min(1, Math.max(0.1, value)))
    setSetting('widget.opacity', value)
  }
}
```

**Step 2: No unit test for WindowManager**

WindowManager creates actual Electron windows and cannot be meaningfully unit tested without a running Electron instance. Verified manually in Task 3.

**Step 3: Commit**

```bash
git add src/main/windows.ts
git commit -m "feat: add WindowManager (dual-window + broadcast)"
```

---

## Task 3: Update index.ts to use WindowManager

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Rewrite index.ts**

Replace the full contents of `src/main/index.ts`:

```typescript
// src/main/index.ts

import { app } from 'electron'
import { initDb } from './db/index'
import { registerIpcHandlers } from './ipc/handlers'
import type { IBleHelper } from './ble/helper'
import { BleHelper } from './ble/helper'
import { MockBleHelper } from './ble/mock-helper'
import { WindowManager } from './windows'
import { TrayManager } from './tray'

let helper: IBleHelper
let tray: TrayManager

app.whenReady().then(() => {
  const isMock = process.env['MOCK_BLE'] === '1'
  console.log(`[Main] app ready — MOCK_BLE=${isMock ? '1' : 'unset'}`)
  initDb()

  helper = isMock ? new MockBleHelper() : new BleHelper()
  const windowManager = new WindowManager()

  windowManager.createDashboard()
  windowManager.createWidget()

  helper.start()
  registerIpcHandlers(windowManager, helper)

  tray = new TrayManager(windowManager)
  tray.init()

  console.log('[Main] windows + tray ready')

  app.on('activate', () => {
    if (!windowManager.getDashboard()) {
      windowManager.createDashboard()
    }
  })
})

app.on('window-all-closed', () => {
  helper?.stop()
  tray?.destroy()
  if (process.platform !== 'darwin') app.quit()
})
```

**Step 2: Run all tests (should still pass)**

```bash
pnpm test
```

Expected: all existing tests pass (no test imports `index.ts` directly).

**Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: use WindowManager + TrayManager in app entry"
```

---

## Task 4: Update IPC handlers to broadcast

**Files:**
- Modify: `src/main/ipc/handlers.ts`

**Step 1: Replace handlers.ts**

Replace the full contents of `src/main/ipc/handlers.ts`:

```typescript
// src/main/ipc/handlers.ts

import { ipcMain } from 'electron'
import {
  insertMeasurement, InsertMeasurementInput,
  startSession, endSession, getSessionHistory,
  getSetting, setSetting,
} from '../db/queries'
import type { IBleHelper } from '../ble/helper'
import type { WindowManager } from '../windows'

export function registerIpcHandlers(windowManager: WindowManager, helper: IBleHelper): void {
  console.log('[IPC] registerIpcHandlers')

  let pendingConnectResolve: (() => void) | null = null
  let pendingConnectReject: ((err: Error) => void) | null = null

  helper.setEventHandler((event) => {
    console.log(`[IPC] helper event: ${event.type}`)
    switch (event.type) {
      case 'device':
        windowManager.broadcast('ble:device-found', { id: event.id, name: event.name })
        break
      case 'connected':
        pendingConnectResolve?.()
        pendingConnectResolve = null
        pendingConnectReject = null
        break
      case 'data':
        windowManager.broadcast('ble:data', event.raw)
        break
      case 'disconnected':
        windowManager.broadcast('ble:disconnected')
        break
      case 'error':
        if (pendingConnectReject) {
          pendingConnectReject(new Error(event.message))
          pendingConnectResolve = null
          pendingConnectReject = null
        } else {
          windowManager.broadcast('ble:error', event.message)
        }
        break
    }
  })

  ipcMain.handle('ble:scan-start', () => {
    console.log('[IPC] ble:scan-start')
    helper.send({ cmd: 'scan' })
  })

  ipcMain.handle('ble:connect', (_e, deviceId: string) => {
    console.log(`[IPC] ble:connect → ${deviceId}`)
    pendingConnectReject?.(new Error('New connect request superseded previous one'))
    pendingConnectResolve = null
    pendingConnectReject = null
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

  ipcMain.handle('ble:mock-set-speed', (_e, kmh: number) => {
    helper.setMockSpeedKmh?.(kmh)
  })

  ipcMain.handle('session:start', (_e, { sensorId, startedAt }: { sensorId: string; startedAt: string }) => {
    console.log(`[IPC] session:start sensorId=${sensorId}`)
    const sessionId = startSession(sensorId, startedAt)
    return { sessionId }
  })

  ipcMain.handle('session:end', (_e, { sessionId, endedAt }: { sessionId: string; endedAt: string }) => {
    console.log(`[IPC] session:end sessionId=${sessionId}`)
    endSession(sessionId, endedAt)
  })

  ipcMain.handle('session:get-history', (_e, { sensorId }: { sensorId: string }) => {
    console.log(`[IPC] session:get-history sensorId=${sensorId}`)
    return getSessionHistory(sensorId)
  })

  ipcMain.handle('settings:get', (_e, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    setSetting(key, value)
  })

  ipcMain.handle('widget:show', () => {
    console.log('[IPC] widget:show')
    windowManager.showWidget()
  })

  ipcMain.handle('widget:hide', () => {
    console.log('[IPC] widget:hide')
    windowManager.hideWidget()
  })

  ipcMain.handle('widget:toggle', () => {
    console.log('[IPC] widget:toggle')
    windowManager.toggleWidget()
  })
}
```

**Step 2: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add src/main/ipc/handlers.ts
git commit -m "feat: broadcast IPC to all windows; add settings + widget handlers"
```

---

## Task 5: Preload + env.d.ts

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

**Step 1: Add to preload**

Add these entries to the `contextBridge.exposeInMainWorld('deskbike', { ... })` object in `src/preload/index.ts`:

```typescript
  isWidget: (): boolean => {
    return new URLSearchParams(window.location.search).get('view') === 'widget'
  },

  getSetting: <T>(key: string): Promise<T | null> => {
    return ipcRenderer.invoke('settings:get', key)
  },

  setSetting: (key: string, value: unknown): Promise<void> => {
    return ipcRenderer.invoke('settings:set', key, value)
  },

  widgetShow: (): Promise<void> => ipcRenderer.invoke('widget:show'),
  widgetHide: (): Promise<void> => ipcRenderer.invoke('widget:hide'),
  widgetToggle: (): Promise<void> => ipcRenderer.invoke('widget:toggle'),
```

**Step 2: Update env.d.ts**

Add to the `deskbike` interface in `src/renderer/src/env.d.ts`:

```typescript
    isWidget: () => boolean
    getSetting: <T>(key: string) => Promise<T | null>
    setSetting: (key: string, value: unknown) => Promise<void>
    widgetShow: () => Promise<void>
    widgetHide: () => Promise<void>
    widgetToggle: () => Promise<void>
```

**Step 3: Commit**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: expose settings + widget controls in preload"
```

---

## Task 6: TrayManager

**Files:**
- Create: `src/main/tray.ts`

**Step 1: Create TrayManager**

Create `src/main/tray.ts`:

```typescript
// src/main/tray.ts

import { Tray, Menu, nativeImage, app } from 'electron'
import type { WindowManager } from './windows'

export class TrayManager {
  private tray: Tray | null = null
  private windowManager: WindowManager

  constructor(windowManager: WindowManager) {
    this.windowManager = windowManager
  }

  init(): void {
    const icon = nativeImage.createEmpty()
    this.tray = new Tray(icon)
    this.tray.setToolTip('DeskBike')
    this.rebuildMenu()
    this.tray.on('click', () => this.windowManager.toggleWidget())
  }

  private rebuildMenu(): void {
    if (!this.tray) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Show Widget',
        type: 'checkbox',
        checked: this.windowManager.getWidget()?.isVisible() ?? false,
        click: () => {
          this.windowManager.toggleWidget()
          this.rebuildMenu()
        },
      },
      {
        label: 'Open Dashboard',
        click: () => {
          const d = this.windowManager.getDashboard()
          if (d && !d.isDestroyed()) {
            d.show()
            d.focus()
          }
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])

    this.tray.setContextMenu(menu)
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
```

**Step 2: Note on tray icon**

`nativeImage.createEmpty()` produces a blank icon. On Linux this may produce a warning. A proper icon asset can be added later; the tray is still functional.

**Step 3: Commit**

```bash
git add src/main/tray.ts
git commit -m "feat: add TrayManager with widget toggle and quit"
```

---

## Task 7: WidgetView component

**Files:**
- Create: `src/renderer/src/components/widget/WidgetView.tsx`

**Step 1: Create WidgetView**

Create `src/renderer/src/components/widget/WidgetView.tsx`:

```tsx
// src/renderer/src/components/widget/WidgetView.tsx

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseRawCsc, computeDeltas, type CscRawFields } from '../../ble/csc-parser'

const WHEEL_CIRCUMFERENCE_M = 2.105

interface Metrics {
  speedKmh: number | null
  cadenceRpm: number | null
  distanceM: number
  elapsedS: number
}

function fmt2(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatDuration(s: number): string {
  return `${fmt2(Math.floor(s / 3600))}:${fmt2(Math.floor((s % 3600) / 60))}:${fmt2(Math.floor(s % 60))}`
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

export default function WidgetView(): JSX.Element {
  const [metrics, setMetrics] = useState<Metrics>({ speedKmh: null, cadenceRpm: null, distanceM: 0, elapsedS: 0 })
  const [connected, setConnected] = useState(false)

  const prevCscRef = useRef<CscRawFields | null>(null)
  const prevTimestampRef = useRef<number | null>(null)
  const sessionStartRef = useRef<number | null>(null)
  const distanceRef = useRef(0)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startElapsed = useCallback(() => {
    if (elapsedIntervalRef.current) return
    sessionStartRef.current = Date.now()
    elapsedIntervalRef.current = setInterval(() => {
      if (sessionStartRef.current) {
        setMetrics((m) => ({ ...m, elapsedS: Math.floor((Date.now() - sessionStartRef.current!) / 1000) }))
      }
    }, 1000)
  }, [])

  const reset = useCallback(() => {
    if (elapsedIntervalRef.current) { clearInterval(elapsedIntervalRef.current); elapsedIntervalRef.current = null }
    prevCscRef.current = null
    prevTimestampRef.current = null
    sessionStartRef.current = null
    distanceRef.current = 0
    setConnected(false)
    setMetrics({ speedKmh: null, cadenceRpm: null, distanceM: 0, elapsedS: 0 })
  }, [])

  useEffect(() => {
    window.deskbike.onData((raw) => {
      const now = Date.now()
      const parsed = parseRawCsc(new Uint8Array(raw))

      if (!connected) { setConnected(true); startElapsed() }

      if (prevCscRef.current && prevTimestampRef.current !== null) {
        const deltas = computeDeltas(parsed, prevCscRef.current, now - prevTimestampRef.current)
        setMetrics((m) => {
          let { speedKmh, cadenceRpm, distanceM } = m
          if (deltas.wheelRevsDiff !== null && deltas.wheelRevsDiff > 0 &&
              deltas.wheelTimeDiff !== null && deltas.wheelTimeDiff > 0) {
            const d = deltas.wheelRevsDiff * WHEEL_CIRCUMFERENCE_M
            speedKmh = (d / (deltas.wheelTimeDiff / 1024)) * 3.6
            distanceRef.current += d
            distanceM = distanceRef.current
          }
          if (deltas.crankRevsDiff !== null && deltas.crankRevsDiff > 0 &&
              deltas.crankTimeDiff !== null && deltas.crankTimeDiff > 0) {
            cadenceRpm = (deltas.crankRevsDiff / (deltas.crankTimeDiff / 1024)) * 60
          }
          return { ...m, speedKmh, cadenceRpm, distanceM }
        })
      }
      prevCscRef.current = parsed
      prevTimestampRef.current = now
    })

    window.deskbike.onDisconnected(reset)
    return () => { if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current) }
  }, [connected, startElapsed, reset])

  return (
    <div style={{
      width: '100%', height: '100vh',
      background: 'rgba(15, 15, 20, 0.88)', color: '#fff',
      fontFamily: 'monospace', userSelect: 'none',
      WebkitAppRegion: 'drag',
      display: 'flex', flexDirection: 'column',
      padding: '10px 14px', boxSizing: 'border-box',
      borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
    } as React.CSSProperties}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#888', letterSpacing: 1 }}>
          {connected ? '● LIVE' : '○ —'}
        </span>
        <button
          onClick={() => window.deskbike.widgetToggle()}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '0 2px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Toggle dashboard"
        >⤢</button>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 42, fontWeight: 'bold', lineHeight: 1 }}>
          {metrics.speedKmh !== null ? metrics.speedKmh.toFixed(1) : '—'}
        </span>
        <span style={{ fontSize: 12, color: '#888', alignSelf: 'flex-end', paddingBottom: 6 }}>km/h</span>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#ccc', marginTop: 4 }}>
        <span>{metrics.cadenceRpm !== null ? `${Math.round(metrics.cadenceRpm)} RPM` : '— RPM'}</span>
        <span>{formatDistance(metrics.distanceM)}</span>
        <span style={{ marginLeft: 'auto', color: '#666' }}>{formatDuration(metrics.elapsedS)}</span>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/widget/WidgetView.tsx
git commit -m "feat: add WidgetView component with live CSC metrics"
```

---

## Task 8: Wire WidgetView into App.tsx

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Step 1: Add widget routing**

Add this import near the top of `src/renderer/src/App.tsx` (with existing imports):

```typescript
import WidgetView from './components/widget/WidgetView'
```

Add this as the **first** thing in the `App()` function body, before any hooks:

```typescript
  if (window.deskbike.isWidget()) {
    return <WidgetView />
  }
```

**Step 2: Manual integration test**

```bash
MOCK_BLE=1 pnpm dev
```

Checklist:
- [ ] Dashboard opens at 900×600 with existing diagnostic view
- [ ] Widget opens as frameless, transparent, always-on-top window at ~280×160
- [ ] Widget shows `—` speed and `— RPM` before connecting
- [ ] Click Scan → Connect in dashboard
- [ ] Widget shows live speed, cadence, distance updating every ~1 s
- [ ] Dragging the widget moves it; close and reopen via tray → same position
- [ ] Tray right-click shows menu with "Show Widget" checkbox and "Quit"

**Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: route widget window to WidgetView"
```

---

## Task 9: Run full test suite

**Step 1: Run all tests**

```bash
pnpm test
```

Expected output: all existing tests pass (settings tests from Task 1 + all previous tests).

**Step 2: If any test fails**

Check which test broke and fix the root cause before continuing. Do not skip or comment out tests.
