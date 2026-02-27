# History Tab Implementation Plan

> **Status update (2026-02-27):** Implemented.
> History tab is live in the dashboard and connected to session APIs.
> Current source of truth: runtime code in `src/renderer/src/HistoryTab.tsx` and `src/main/ipc/handlers.ts`.


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "History" tab alongside the existing "Live" tab, with a standalone session database viewer (sensor dropdown → session dropdown → detail card).

**Architecture:** App.tsx becomes a thin tab-shell; current content moves to DiagnosticTab.tsx; new HistoryTab.tsx handles the history view. A new `getSensorsWithSessions()` DB query surfaces the list of sensors; existing `getSessionHistory(sensorId)` already fetches the per-sensor session list. One new IPC channel (`session:get-sensors`) wires the query to the renderer.

**Tech Stack:** TypeScript, React 18, Electron IPC, Drizzle ORM, SQLite (better-sqlite3), Vitest

---

### Task 1: Add `getSensorsWithSessions()` DB query

**Files:**
- Modify: `src/main/db/queries.ts`

This is a simple Drizzle `selectDistinct` — no meaningful unit test (project has no DB integration tests; existing query functions are untested at that level).

**Step 1: Add the function at the bottom of queries.ts**

```typescript
export function getSensorsWithSessions(): string[] {
  const db = getDb()
  const rows = db
    .selectDistinct({ sensorId: sessions.sensorId })
    .from(sessions)
    .where(isNotNull(sessions.endedAt))
    .all()
  return rows.map((r) => r.sensorId)
}
```

The import `isNotNull` is already in scope (used by `getSessionHistory`).

**Step 2: Verify the file compiles**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/main/db/queries.ts
git commit -m "feat: add getSensorsWithSessions DB query"
```

---

### Task 2: Register IPC handler + expose in preload + update types

**Files:**
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

**Step 1: Add import in handlers.ts**

In `src/main/ipc/handlers.ts`, add `getSensorsWithSessions` to the existing import:

```typescript
import { insertMeasurement, InsertMeasurementInput, startSession, endSession, getSessionHistory, getSensorsWithSessions } from '../db/queries'
```

**Step 2: Register the handler in handlers.ts**

Add after the existing `session:get-history` handler (before the closing `}`):

```typescript
  ipcMain.handle('session:get-sensors', () => {
    console.log('[IPC] session:get-sensors')
    return getSensorsWithSessions()
  })
```

**Step 3: Expose in preload**

In `src/preload/index.ts`, add after `getSessionHistory`:

```typescript
  getSensors: (): Promise<string[]> => {
    console.log('[Preload] getSensors')
    return ipcRenderer.invoke('session:get-sensors')
  },
```

**Step 4: Declare type in env.d.ts**

In `src/renderer/src/env.d.ts`, add to the `deskbike` interface after `getSessionHistory`:

```typescript
    getSensors: () => Promise<string[]>
```

**Step 5: Verify compilation**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/main/ipc/handlers.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: add session:get-sensors IPC channel"
```

---

### Task 3: Extract shared formatting helpers

**Files:**
- Create: `src/renderer/src/format.ts`

Both DiagnosticTab and HistoryTab need the same two formatting functions currently defined inline in App.tsx.

**Step 1: Create `src/renderer/src/format.ts`**

```typescript
// src/renderer/src/format.ts

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`
}
```

**Step 2: Verify compilation**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/renderer/src/format.ts
git commit -m "feat: extract formatDuration/formatDistance to shared format.ts"
```

---

### Task 4: Extract DiagnosticTab.tsx from App.tsx

**Files:**
- Create: `src/renderer/src/DiagnosticTab.tsx`
- Modify: `src/renderer/src/App.tsx`

The goal is to move the current App.tsx content to DiagnosticTab.tsx with minimal changes. Logic is untouched.

**Step 1: Create `src/renderer/src/DiagnosticTab.tsx`**

Take the full content of `src/renderer/src/App.tsx` and:
1. Rename the component from `App` to `DiagnosticTab`
2. Replace the local `formatDuration`/`formatDistance` definitions with an import from `./format`
3. Change the export from `export default function App()` to `export default function DiagnosticTab()`

Full file:

```typescript
// src/renderer/src/DiagnosticTab.tsx

import { useCallback, useEffect, useRef, useState } from 'react'
import { createBleAdapter } from './ble/adapter'
import type { BleAdapter, DeviceInfo } from './ble/adapter'
import { parseRawCsc, computeDeltas, type CscRawFields } from './ble/csc-parser'
import { useDevLog } from './useDevLog'
import { formatDuration, formatDistance } from './format'

export default function DiagnosticTab() {
  const logs = useDevLog()
  const logEndRef = useRef<HTMLDivElement>(null)
  const adapter = useRef<BleAdapter | null>(null)
  const [status, setStatus] = useState('idle')
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [packetCount, setPacketCount] = useState(0)
  const [lastHex, setLastHex] = useState<string | null>(null)
  const [mockSpeedKmh, setMockSpeedKmh] = useState(17.5)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([])
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null)
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const [liveSpeed, setLiveSpeed] = useState<number | null>(null)
  const [liveCadence, setLiveCadence] = useState<number | null>(null)
  const [sessionDistance, setSessionDistance] = useState(0)
  const [elapsedS, setElapsedS] = useState(0)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevCscRef = useRef<CscRawFields | null>(null)
  const prevTimestampRef = useRef<number | null>(null)
  const sessionDistanceRef = useRef(0)

  const INACTIVITY_MS = 2 * 60 * 1000
  const WHEEL_CIRCUMFERENCE_M = 2.105

  const MOCK_SPEED_MIN = 0
  const MOCK_SPEED_MAX = 40

  // Auto-scroll log panel to bottom on new entries
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    console.log('[DiagnosticTab] mount — isMock:', window.deskbike.isMock)
    try {
      adapter.current = createBleAdapter()
      console.log('[DiagnosticTab] BleAdapter created:', adapter.current.constructor.name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[DiagnosticTab] createBleAdapter failed:', err)
      setErrorDetail(`createBleAdapter: ${msg}`)
      setStatus('error')
      return
    }
    window.deskbike.onBleError((message) => {
      setErrorDetail(`BLE error: ${message}`)
      setStatus('error')
    })
  }, [])

  useEffect(() => {
    if (sessionId && sessionStartedAt) {
      elapsedIntervalRef.current = setInterval(() => {
        setElapsedS(Math.floor((Date.now() - new Date(sessionStartedAt).getTime()) / 1000))
      }, 1000)
    } else {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
      elapsedIntervalRef.current = null
      setElapsedS(0)
    }
    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    }
  }, [sessionId, sessionStartedAt])

  const endActiveSession = useCallback(async () => {
    if (!sessionIdRef.current || sessionIdRef.current === 'pending') return
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
    const endedAt = new Date().toISOString()
    await window.deskbike.sessionEnd(sessionIdRef.current, endedAt)
    sessionIdRef.current = null
    setSessionId(null)
    setSessionStartedAt(null)
    setLiveSpeed(null)
    setLiveCadence(null)
    setSessionDistance(0)
    sessionDistanceRef.current = 0
    prevCscRef.current = null
    prevTimestampRef.current = null
  }, [])

  function handleScan(): void {
    console.log('[DiagnosticTab] handleScan')
    if (!adapter.current) {
      setErrorDetail('adapter not initialised')
      setStatus('error')
      return
    }
    setDevices([])
    setErrorDetail(null)
    setStatus('scanning')
    try {
      adapter.current.startScan((device) => {
        console.log('[DiagnosticTab] device found:', device)
        setDevices((prev) => prev.find((d) => d.id === device.id) ? prev : [...prev, device])
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[DiagnosticTab] startScan failed:', err)
      setErrorDetail(`startScan: ${msg}`)
      setStatus('error')
    }
  }

  async function handleConnect(deviceId: string): Promise<void> {
    console.log(`[DiagnosticTab] handleConnect: ${deviceId}`)
    setStatus('connecting')
    setErrorDetail(null)
    try {
      await adapter.current!.selectDevice(
        deviceId,
        async (data) => {
          const parsed = parseRawCsc(data)
          const now = Date.now()
          const timestampUtc = new Date(now).toISOString()

          // Start session on first packet (sentinel prevents re-entry on concurrent packets)
          if (!sessionIdRef.current) {
            sessionIdRef.current = 'pending'
            const { sessionId: sid } = await window.deskbike.sessionStart(deviceId, timestampUtc)
            sessionIdRef.current = sid
            setSessionId(sid)
            setSessionStartedAt(timestampUtc)
          }

          // Reset inactivity timer
          if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
          inactivityTimerRef.current = setTimeout(async () => {
            await endActiveSession()
          }, INACTIVITY_MS)

          // Compute live speed/cadence from deltas
          if (prevCscRef.current && prevTimestampRef.current !== null) {
            const timeDiffMs = now - prevTimestampRef.current
            const deltas = computeDeltas(parsed, prevCscRef.current, timeDiffMs)

            if (deltas.wheelRevsDiff !== null && deltas.wheelRevsDiff > 0 &&
                deltas.wheelTimeDiff !== null && deltas.wheelTimeDiff > 0) {
              const distM = deltas.wheelRevsDiff * WHEEL_CIRCUMFERENCE_M
              const timeS = deltas.wheelTimeDiff / 1024
              setLiveSpeed((distM / timeS) * 3.6)
              sessionDistanceRef.current += distM
              setSessionDistance(sessionDistanceRef.current)
            }

            if (deltas.crankRevsDiff !== null && deltas.crankRevsDiff > 0 &&
                deltas.crankTimeDiff !== null && deltas.crankTimeDiff > 0) {
              setLiveCadence((deltas.crankRevsDiff / (deltas.crankTimeDiff / 1024)) * 60)
            }
          }
          prevCscRef.current = parsed
          prevTimestampRef.current = now

          // Existing hex display and save
          const hex = Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' ')
          console.log(`[DiagnosticTab] data packet: ${hex}`)
          setPacketCount((n) => n + 1)
          setLastHex(hex)
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
        async () => {
          console.log('[DiagnosticTab] disconnected (remote)')
          await endActiveSession()
          setStatus('disconnected')
          setConnectedDeviceId(null)
        }
      )
      console.log('[DiagnosticTab] connected successfully')
      setStatus('connected')
      setConnectedDeviceId(deviceId)
      const history = await window.deskbike.getSessionHistory(deviceId)
      setSessionHistory(history)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[DiagnosticTab] connect failed:', err)
      setErrorDetail(`connect: ${msg}`)
      setStatus('error')
    }
  }

  async function handleDisconnect(): Promise<void> {
    console.log('[DiagnosticTab] handleDisconnect')
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
    await endActiveSession()
    if (!adapter.current) return
    await adapter.current.disconnect()
    setStatus('disconnected')
    setConnectedDeviceId(null)
  }

  function handleMockSpeedChange(kmh: number): void {
    setMockSpeedKmh(kmh)
    window.deskbike.mockSetSpeed(kmh)
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, display: 'flex', gap: 32, alignItems: 'flex-start' }}>
      {/* Main content */}
      <div style={{ flex: 1 }}>
        <h2>DeskBike — diagnostic view</h2>

        <p>
          Mode: <strong>{window.deskbike.isMock ? 'MOCK' : 'Bleak (Python)'}</strong>
        </p>

        <p>Status: <strong>{status}</strong></p>
        {errorDetail && (
          <p style={{ color: 'red' }}>Error: {errorDetail}</p>
        )}

        <button onClick={handleScan} disabled={status === 'scanning' || status === 'connected'}>Scan</button>
        {' '}
        <button onClick={handleDisconnect} disabled={status !== 'connected'}>Disconnect</button>

        {devices.length > 0 && status !== 'connected' && (
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

        {/* Active session bar */}
        {sessionId && (
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: '#1a2a1a',
            border: '1px solid #3a5a3a',
            borderRadius: 6,
            display: 'flex',
            gap: 24,
            alignItems: 'center',
          }}>
            <span style={{ color: '#4f4', fontWeight: 'bold', fontSize: 12 }}>● ACTIVE SESSION</span>
            <span>{formatDuration(elapsedS)}</span>
            {sessionDistance > 0 && <span>{formatDistance(sessionDistance)}</span>}
            {liveSpeed !== null && <span>{liveSpeed.toFixed(1)} km/h</span>}
            {liveCadence !== null && <span>{Math.round(liveCadence)} RPM</span>}
          </div>
        )}

        {/* Session history */}
        {sessionHistory.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 6 }}>
              Session history — {connectedDeviceId}
            </h3>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #444' }}>
                  <th style={{ textAlign: 'left', padding: '4px 10px 4px 0' }}>Date</th>
                  <th style={{ textAlign: 'right', padding: '4px 10px' }}>Duration</th>
                  {sessionHistory.some((s) => s.distanceM !== null) && (
                    <th style={{ textAlign: 'right', padding: '4px 10px' }}>Distance</th>
                  )}
                  {sessionHistory.some((s) => s.avgSpeedKmh !== null) && (
                    <th style={{ textAlign: 'right', padding: '4px 10px' }}>Avg speed</th>
                  )}
                  {sessionHistory.some((s) => s.avgCadenceRpm !== null) && (
                    <th style={{ textAlign: 'right', padding: '4px 10px' }}>Avg cadence</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sessionHistory.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '4px 10px 4px 0' }}>
                      {new Date(s.startedAt).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', padding: '4px 10px' }}>
                      {s.durationS !== null ? formatDuration(s.durationS) : '—'}
                    </td>
                    {sessionHistory.some((x) => x.distanceM !== null) && (
                      <td style={{ textAlign: 'right', padding: '4px 10px' }}>
                        {s.distanceM !== null ? formatDistance(s.distanceM) : '—'}
                      </td>
                    )}
                    {sessionHistory.some((x) => x.avgSpeedKmh !== null) && (
                      <td style={{ textAlign: 'right', padding: '4px 10px' }}>
                        {s.avgSpeedKmh !== null ? `${s.avgSpeedKmh.toFixed(1)} km/h` : '—'}
                      </td>
                    )}
                    {sessionHistory.some((x) => x.avgCadenceRpm !== null) && (
                      <td style={{ textAlign: 'right', padding: '4px 10px' }}>
                        {s.avgCadenceRpm !== null ? `${Math.round(s.avgCadenceRpm)} RPM` : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 4 }}>Log ({logs.length})</h3>
          <div style={{
            height: 220,
            overflowY: 'auto',
            background: '#111',
            color: '#eee',
            fontSize: 11,
            padding: '6px 8px',
            borderRadius: 4,
          }}>
            {logs.map((e, i) => (
              <div key={i} style={{
                color: e.level === 'error' ? '#f77' : e.level === 'warn' ? '#fa0' : '#cfc',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {e.ts} {e.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      {/* Mock speed slider — only shown in MOCK mode */}
      {window.deskbike.isMock && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          paddingTop: 8,
          userSelect: 'none',
        }}>
          <span style={{ fontSize: 12 }}>{MOCK_SPEED_MAX} km/h</span>
          <input
            type="range"
            min={MOCK_SPEED_MIN}
            max={MOCK_SPEED_MAX}
            step={0.5}
            value={mockSpeedKmh}
            onChange={(e) => handleMockSpeedChange(Number(e.target.value))}
            style={{
              writingMode: 'vertical-lr',
              direction: 'rtl',
              height: 240,
              cursor: 'pointer',
            }}
          />
          <span style={{ fontSize: 12 }}>{MOCK_SPEED_MIN} km/h</span>
          <strong style={{ marginTop: 4, fontSize: 14 }}>{mockSpeedKmh.toFixed(1)} km/h</strong>
          <span style={{ fontSize: 10, color: '#888' }}>mock speed</span>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Verify compilation**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/renderer/src/DiagnosticTab.tsx
git commit -m "feat: extract DiagnosticTab from App"
```

---

### Task 5: Refactor App.tsx into a tab shell

**Files:**
- Modify: `src/renderer/src/App.tsx`

Replace the entire content of App.tsx with the thin tab-shell below.

**Step 1: Replace App.tsx**

```typescript
// src/renderer/src/App.tsx

import { useState } from 'react'
import DiagnosticTab from './DiagnosticTab'
import HistoryTab from './HistoryTab'

type Tab = 'live' | 'history'

const TAB_LABELS: Record<Tab, string> = {
  live: 'Live',
  history: 'History',
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('live')

  return (
    <div style={{ fontFamily: 'monospace' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #333',
        padding: '0 24px',
      }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #4f4' : '2px solid transparent',
              color: activeTab === tab ? '#eee' : '#888',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 13,
              padding: '8px 16px',
              marginBottom: -1,
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'live' ? <DiagnosticTab /> : <HistoryTab />}
    </div>
  )
}
```

**Step 2: Verify compilation**

```bash
pnpm tsc --noEmit
```

Expected: error about `HistoryTab` not found — that's expected, Task 6 creates it.

**Step 3: Commit (after Task 6 passes compilation)**

Hold off on this commit — do it together with Task 6.

---

### Task 6: Create HistoryTab.tsx

**Files:**
- Create: `src/renderer/src/HistoryTab.tsx`

**Step 1: Create the file**

```typescript
// src/renderer/src/HistoryTab.tsx

import { useEffect, useState } from 'react'
import { formatDuration, formatDistance } from './format'

function sessionLabel(s: SessionRecord): string {
  const date = new Date(s.startedAt).toLocaleString()
  const parts: string[] = [date]
  if (s.distanceM !== null) parts.push(formatDistance(s.distanceM))
  if (s.durationS !== null) parts.push(formatDuration(s.durationS))
  return parts.join(' — ')
}

export default function HistoryTab() {
  const [sensors, setSensors] = useState<string[]>([])
  const [selectedSensor, setSelectedSensor] = useState<string>('')
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null)

  useEffect(() => {
    window.deskbike.getSensors().then((list) => {
      setSensors(list)
      if (list.length > 0) setSelectedSensor(list[0])
    })
  }, [])

  useEffect(() => {
    if (!selectedSensor) return
    window.deskbike.getSessionHistory(selectedSensor).then((history) => {
      setSessions(history)
      setSelectedSession(null)
    })
  }, [selectedSensor])

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>Session history</h2>

      {sensors.length === 0 ? (
        <p style={{ color: '#888' }}>No sessions recorded yet.</p>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>SENSOR</label>
            <select
              value={selectedSensor}
              onChange={(e) => setSelectedSensor(e.target.value)}
              style={{ fontFamily: 'monospace', padding: '4px 8px', background: '#111', color: '#eee', border: '1px solid #444' }}
            >
              {sensors.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>

          {sessions.length === 0 ? (
            <p style={{ color: '#888' }}>No completed sessions for this sensor.</p>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>SESSION</label>
              <select
                value={selectedSession?.id ?? ''}
                onChange={(e) => {
                  const s = sessions.find((x) => x.id === e.target.value) ?? null
                  setSelectedSession(s)
                }}
                style={{
                  fontFamily: 'monospace',
                  padding: '4px 8px',
                  background: '#111',
                  color: '#eee',
                  border: '1px solid #444',
                  width: '100%',
                  maxWidth: 520,
                }}
              >
                <option value=''>— pick a session —</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
                ))}
              </select>
            </div>
          )}

          {selectedSession && (
            <div style={{
              marginTop: 8,
              padding: '12px 16px',
              background: '#111',
              border: '1px solid #333',
              borderRadius: 6,
              maxWidth: 400,
            }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>SESSION DETAIL</div>
              <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Started</td>
                    <td>{new Date(selectedSession.startedAt).toLocaleString()}</td>
                  </tr>
                  {selectedSession.durationS !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Duration</td>
                      <td>{formatDuration(selectedSession.durationS)}</td>
                    </tr>
                  )}
                  {selectedSession.distanceM !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Distance</td>
                      <td>{formatDistance(selectedSession.distanceM)}</td>
                    </tr>
                  )}
                  {selectedSession.avgSpeedKmh !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Avg speed</td>
                      <td>{selectedSession.avgSpeedKmh.toFixed(1)} km/h</td>
                    </tr>
                  )}
                  {selectedSession.maxSpeedKmh !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Max speed</td>
                      <td>{selectedSession.maxSpeedKmh.toFixed(1)} km/h</td>
                    </tr>
                  )}
                  {selectedSession.avgCadenceRpm !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Avg cadence</td>
                      <td>{Math.round(selectedSession.avgCadenceRpm)} RPM</td>
                    </tr>
                  )}
                  {selectedSession.maxCadenceRpm !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Max cadence</td>
                      <td>{Math.round(selectedSession.maxCadenceRpm)} RPM</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

**Step 2: Verify compilation**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

**Step 3: Run existing tests**

```bash
pnpm test
```

Expected: all tests pass (no changes to tested modules).

**Step 4: Commit App.tsx + HistoryTab.tsx together**

```bash
git add src/renderer/src/App.tsx src/renderer/src/HistoryTab.tsx
git commit -m "feat: add History tab with sensor/session dropdowns and detail card"
```

---

### Task 7: Manual smoke test

Start the app and verify:

```bash
MOCK_BLE=1 pnpm dev
```

1. App opens showing "Live" and "History" tabs; "Live" is active.
2. Click "History" tab — shows "No sessions recorded yet." (if no data) OR the sensor dropdown.
3. Switch back to "Live", scan, connect to DeskBike-MOCK, ride for a moment, disconnect.
4. Switch to "History" tab — sensor dropdown shows the mock device ID.
5. Select sensor → session dropdown shows the completed session with distance and duration.
6. Select session → detail card appears with all available stats.
7. Verify tab switching doesn't reset BLE state (connecting, then switching to History and back keeps status).
