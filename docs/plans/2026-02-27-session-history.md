# Session History Implementation Plan

> **Status update (2026-02-27):** Implemented.
> Session recording and history views are live.
> Current source of truth: runtime code and tests in `tests/main/db/session-stats.test.ts`.


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically record cycling sessions per sensor, compute statistics when a session ends, and display session history after connecting.

**Architecture:** Renderer-driven session lifecycle — the renderer detects inactivity (2-minute timer), calls session:start on first data packet and session:end on inactivity or disconnect. The main process handles all DB writes via IPC. A pure `computeSessionStats` function encapsulates the stats math and is unit-tested independently. Live speed/cadence in the active session bar is computed in the renderer using the existing `computeDeltas` from `csc-parser.ts`.

**Tech Stack:** TypeScript, Drizzle ORM, better-sqlite3, Vitest, React 18

---

## Task 1: computeSessionStats — pure function + tests

The stats math is isolated here so it can be fully unit-tested without touching Electron or the DB.

**Files:**
- Create: `src/main/db/session-stats.ts`
- Create: `tests/main/db/session-stats.test.ts`

**Step 1: Write the failing test**

Create `tests/main/db/session-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeSessionStats } from '../../../src/main/db/session-stats'

const START = '2026-01-01T10:00:00.000Z'
const END_30MIN = '2026-01-01T10:30:00.000Z'

describe('computeSessionStats', () => {
  it('returns zero duration and all nulls for empty measurements', () => {
    const stats = computeSessionStats([], START, END_30MIN)
    expect(stats.durationS).toBe(1800)
    expect(stats.distanceM).toBeNull()
    expect(stats.avgSpeedKmh).toBeNull()
    expect(stats.maxSpeedKmh).toBeNull()
    expect(stats.avgCadenceRpm).toBeNull()
    expect(stats.maxCadenceRpm).toBeNull()
  })

  it('computes distance and speed from wheel data', () => {
    // 1 rev in 1024 ticks = 1 second → 2.105 m, speed = 2.105 * 3.6 = 7.578 km/h
    const m = {
      hasWheelData: true, hasCrankData: false,
      wheelRevsDiff: 1, wheelTimeDiff: 1024,
      crankRevsDiff: null, crankTimeDiff: null,
    }
    const stats = computeSessionStats([m], START, END_30MIN)
    expect(stats.distanceM).toBeCloseTo(2.105, 3)
    expect(stats.avgSpeedKmh).toBeCloseTo(7.578, 2)
    expect(stats.maxSpeedKmh).toBeCloseTo(7.578, 2)
  })

  it('computes cadence from crank data', () => {
    // 1 rev in 512 ticks = 0.5 second → 120 RPM
    const m = {
      hasWheelData: false, hasCrankData: true,
      wheelRevsDiff: null, wheelTimeDiff: null,
      crankRevsDiff: 1, crankTimeDiff: 512,
    }
    const stats = computeSessionStats([m], START, END_30MIN)
    expect(stats.distanceM).toBeNull()
    expect(stats.avgCadenceRpm).toBeCloseTo(120, 1)
    expect(stats.maxCadenceRpm).toBeCloseTo(120, 1)
  })

  it('averages and maxes across multiple packets', () => {
    // slow: 1 rev / 2048 ticks → 3.789 km/h
    // fast: 2 revs / 1024 ticks → 15.156 km/h
    const slow = {
      hasWheelData: true, hasCrankData: false,
      wheelRevsDiff: 1, wheelTimeDiff: 2048,
      crankRevsDiff: null, crankTimeDiff: null,
    }
    const fast = {
      hasWheelData: true, hasCrankData: false,
      wheelRevsDiff: 2, wheelTimeDiff: 1024,
      crankRevsDiff: null, crankTimeDiff: null,
    }
    const stats = computeSessionStats([slow, fast], START, END_30MIN)
    expect(stats.distanceM).toBeCloseTo(3 * 2.105, 3)
    expect(stats.maxSpeedKmh).toBeCloseTo(15.156, 2)
    expect(stats.avgSpeedKmh).toBeCloseTo((3.789 + 15.156) / 2, 1)
  })

  it('ignores packets with zero revsDiff or zero timeDiff', () => {
    const zero = {
      hasWheelData: true, hasCrankData: true,
      wheelRevsDiff: 0, wheelTimeDiff: 1024,
      crankRevsDiff: 1, crankTimeDiff: 0,
    }
    const stats = computeSessionStats([zero], START, END_30MIN)
    expect(stats.distanceM).toBeNull() // zero revs = no contribution
    expect(stats.avgCadenceRpm).toBeNull() // zero timeDiff = skip
  })
})
```

**Step 2: Run test to verify it fails**

```bash
pnpm test tests/main/db/session-stats.test.ts
```
Expected: `FAIL` with "Cannot find module"

**Step 3: Implement `src/main/db/session-stats.ts`**

```ts
export const WHEEL_CIRCUMFERENCE_M = 2.105

export interface MeasurementForStats {
  hasWheelData: boolean
  hasCrankData: boolean
  wheelRevsDiff: number | null
  wheelTimeDiff: number | null
  crankRevsDiff: number | null
  crankTimeDiff: number | null
}

export interface SessionStats {
  durationS: number
  distanceM: number | null
  avgSpeedKmh: number | null
  maxSpeedKmh: number | null
  avgCadenceRpm: number | null
  maxCadenceRpm: number | null
}

export function computeSessionStats(
  measurements: MeasurementForStats[],
  startedAt: string,
  endedAt: string
): SessionStats {
  const durationS = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000

  const speeds: number[] = []
  const cadences: number[] = []
  let totalDistanceM = 0
  let hasAnyWheelData = false

  for (const m of measurements) {
    if (
      m.hasWheelData &&
      m.wheelRevsDiff !== null && m.wheelRevsDiff > 0 &&
      m.wheelTimeDiff !== null && m.wheelTimeDiff > 0
    ) {
      hasAnyWheelData = true
      const distM = m.wheelRevsDiff * WHEEL_CIRCUMFERENCE_M
      totalDistanceM += distM
      const timeS = m.wheelTimeDiff / 1024
      speeds.push((distM / timeS) * 3.6)
    }

    if (
      m.hasCrankData &&
      m.crankRevsDiff !== null && m.crankRevsDiff > 0 &&
      m.crankTimeDiff !== null && m.crankTimeDiff > 0
    ) {
      cadences.push((m.crankRevsDiff / (m.crankTimeDiff / 1024)) * 60)
    }
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

  return {
    durationS,
    distanceM: hasAnyWheelData ? totalDistanceM : null,
    avgSpeedKmh: speeds.length > 0 ? avg(speeds) : null,
    maxSpeedKmh: speeds.length > 0 ? Math.max(...speeds) : null,
    avgCadenceRpm: cadences.length > 0 ? avg(cadences) : null,
    maxCadenceRpm: cadences.length > 0 ? Math.max(...cadences) : null,
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm test tests/main/db/session-stats.test.ts
```
Expected: `PASS` — 5 tests

**Step 5: Commit**

```bash
git add src/main/db/session-stats.ts tests/main/db/session-stats.test.ts
git commit -m "feat: add computeSessionStats pure function with tests"
```

---

## Task 2: Session DB queries

Add `startSession`, `endSession`, `getSessionHistory` to `src/main/db/queries.ts`. These wrap DB I/O and call `computeSessionStats`.

**Files:**
- Modify: `src/main/db/queries.ts`

**Step 1: Add imports to `src/main/db/queries.ts`**

At the top, add to the existing drizzle-orm import line:
```ts
import { eq, desc, and, gte, lte, isNotNull } from 'drizzle-orm'
```
Also add:
```ts
import { measurements, sessions } from './schema'
import { computeSessionStats } from './session-stats'
```
(The existing file only imports `measurements`; add `sessions` and `computeSessionStats`.)

**Step 2: Add the three functions at the end of `src/main/db/queries.ts`**

```ts
export function startSession(sensorId: string, startedAt: string): string {
  const db = getDb()
  const id = randomUUID()
  db.insert(sessions).values({ id, sensorId, startedAt }).run()
  return id
}

export function endSession(sessionId: string, endedAt: string): void {
  const db = getDb()

  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .all()[0]

  if (!session) return

  const sessionMeasurements = db
    .select()
    .from(measurements)
    .where(
      and(
        eq(measurements.sensorId, session.sensorId),
        gte(measurements.timestampUtc, session.startedAt),
        lte(measurements.timestampUtc, endedAt)
      )
    )
    .all()

  const stats = computeSessionStats(sessionMeasurements, session.startedAt, endedAt)

  db.update(sessions)
    .set({
      endedAt,
      durationS: Math.round(stats.durationS),
      distanceM: stats.distanceM,
      avgSpeedKmh: stats.avgSpeedKmh,
      maxSpeedKmh: stats.maxSpeedKmh,
      avgCadenceRpm: stats.avgCadenceRpm,
      maxCadenceRpm: stats.maxCadenceRpm,
    })
    .where(eq(sessions.id, sessionId))
    .run()
}

export function getSessionHistory(sensorId: string, limit = 20) {
  const db = getDb()
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.sensorId, sensorId), isNotNull(sessions.endedAt)))
    .orderBy(desc(sessions.startedAt))
    .limit(limit)
    .all()
}
```

**Step 3: Run all tests to make sure nothing broke**

```bash
pnpm test
```
Expected: all existing tests still pass (no new tests for DB I/O — the SQL operations are trusted to Drizzle and the stats logic is already tested)

**Step 4: Commit**

```bash
git add src/main/db/queries.ts
git commit -m "feat: add startSession, endSession, getSessionHistory queries"
```

---

## Task 3: IPC handlers for sessions

Wire the three session functions to IPC in the main process.

**Files:**
- Modify: `src/main/ipc/handlers.ts`

**Step 1: Add imports to `handlers.ts`**

Add `startSession`, `endSession`, `getSessionHistory` to the existing import from `'../db/queries'`:
```ts
import { insertMeasurement, InsertMeasurementInput, startSession, endSession, getSessionHistory } from '../db/queries'
```

**Step 2: Add three IPC handlers inside `registerIpcHandlers`, after the existing `ble:mock-set-speed` handler**

```ts
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
```

**Step 3: Run all tests**

```bash
pnpm test
```
Expected: all pass

**Step 4: Commit**

```bash
git add src/main/ipc/handlers.ts
git commit -m "feat: register session:start/end/get-history IPC handlers"
```

---

## Task 4: Preload exposure and TypeScript types

Expose session IPC to the renderer via `contextBridge` and add TypeScript types.

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

**Step 1: Add to `contextBridge.exposeInMainWorld` in `src/preload/index.ts`**

After the `mockSetSpeed` entry (before the closing `})`):
```ts
  sessionStart: (sensorId: string, startedAt: string): Promise<{ sessionId: string }> => {
    console.log(`[Preload] sessionStart sensorId=${sensorId}`)
    return ipcRenderer.invoke('session:start', { sensorId, startedAt })
  },

  sessionEnd: (sessionId: string, endedAt: string): Promise<void> => {
    console.log(`[Preload] sessionEnd sessionId=${sessionId}`)
    return ipcRenderer.invoke('session:end', { sessionId, endedAt })
  },

  getSessionHistory: (sensorId: string): Promise<SessionRecord[]> => {
    return ipcRenderer.invoke('session:get-history', { sensorId })
  },
```

Note: `SessionRecord` will be defined in `env.d.ts` in the next step.

**Step 2: Update `src/renderer/src/env.d.ts`**

Add the `SessionRecord` interface and extend `window.deskbike`:
```ts
interface SessionRecord {
  id: string
  sensorId: string
  startedAt: string
  endedAt: string | null
  durationS: number | null
  distanceM: number | null
  avgSpeedKmh: number | null
  maxSpeedKmh: number | null
  avgCadenceRpm: number | null
  maxCadenceRpm: number | null
}
```

And inside `Window.deskbike`, add after `mockSetSpeed`:
```ts
    sessionStart: (sensorId: string, startedAt: string) => Promise<{ sessionId: string }>
    sessionEnd: (sessionId: string, endedAt: string) => Promise<void>
    getSessionHistory: (sensorId: string) => Promise<SessionRecord[]>
```

**Step 3: Run all tests**

```bash
pnpm test
```
Expected: all pass

**Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: expose session IPC and add SessionRecord type to preload"
```

---

## Task 5: App.tsx — session lifecycle

Add session start/end logic and inactivity timer to the renderer. No UI yet — just the state and side-effects.

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Step 1: Add imports**

At the top of `App.tsx`, add to the existing React import:
```ts
import { useEffect, useRef, useState, useCallback } from 'react'
```
Also add the CSC parser import:
```ts
import { computeDeltas } from './ble/csc-parser'
import type { CscRawFields } from './ble/csc-parser'
```

**Step 2: Add state and refs inside the `App` component, after the existing `useState` declarations**

```tsx
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([])
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null)
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const [liveSpeed, setLiveSpeed] = useState<number | null>(null)
  const [liveCadence, setLiveCadence] = useState<number | null>(null)
  const [sessionDistance, setSessionDistance] = useState(0)

  const sessionIdRef = useRef<string | null>(null)
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevCscRef = useRef<CscRawFields | null>(null)
  const prevTimestampRef = useRef<number | null>(null)
  const sessionDistanceRef = useRef(0)

  const INACTIVITY_MS = 2 * 60 * 1000
  const WHEEL_CIRCUMFERENCE_M = 2.105
```

**Step 3: Add `endActiveSession` helper after the state declarations**

```tsx
  const endActiveSession = useCallback(async () => {
    if (!sessionIdRef.current) return
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
```

**Step 4: Replace the data-handling block inside `handleConnect`**

The existing callback passed to `adapter.current.selectDevice` (lines 76–94 in the original) becomes:

```tsx
        async (data) => {
          const parsed = parseRawCsc(data)
          const now = Date.now()
          const timestampUtc = new Date(now).toISOString()

          // Start session on first packet
          if (!sessionIdRef.current) {
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
```

**Step 5: After `setStatus('connected')` in `handleConnect`, load session history**

```tsx
      setStatus('connected')
      setConnectedDeviceId(deviceId)
      const history = await window.deskbike.getSessionHistory(deviceId)
      setSessionHistory(history)
```

**Step 6: Update `handleDisconnect` to end the active session before disconnecting**

Replace the existing `handleDisconnect`:
```tsx
  async function handleDisconnect(): Promise<void> {
    console.log('[App] handleDisconnect')
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
```

**Step 7: Run the app to verify lifecycle works**

```bash
MOCK_BLE=1 pnpm dev
```

- Scan → connect to DeskBike-MOCK
- Wait 5 seconds for packets; check terminal for `[IPC] session:start`
- Disconnect; check terminal for `[IPC] session:end`
- Check DB: `sqlite3 ~/.config/deskbike-app/deskbike.sqlite "SELECT * FROM sessions;"`
- Expected: one row with non-null `ended_at`, `duration_s`, `distance_m`

**Step 8: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: session lifecycle — start on first packet, end on inactivity/disconnect"
```

---

## Task 6: Session history UI

Display the loaded session history and an active session bar in `App.tsx`.

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Step 1: Add a `formatDuration` helper at module level (above the `App` function)**

```tsx
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`
}
```

**Step 2: Add elapsed time state and counter**

After the existing state declarations, add:
```tsx
  const [elapsedS, setElapsedS] = useState(0)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
```

And a `useEffect` to tick the elapsed time counter:
```tsx
  useEffect(() => {
    if (sessionId && sessionStartedAt) {
      elapsedIntervalRef.current = setInterval(() => {
        setElapsedS(Math.floor((Date.now() - new Date(sessionStartedAt).getTime()) / 1000))
      }, 1000)
    } else {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
      setElapsedS(0)
    }
    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    }
  }, [sessionId, sessionStartedAt])
```

**Step 3: Add session history panel to JSX**

After the `{lastHex && ...}` block in the JSX, add:

```tsx
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
```

**Step 4: Manual verification**

```bash
MOCK_BLE=1 pnpm dev
```

1. Scan → connect to DeskBike-MOCK
2. Active session bar should appear within 1 second (first data packet)
3. Elapsed time ticks; distance and speed appear after second packet
4. Disconnect → session ends
5. Reconnect → session history table shows the previous session

**Step 5: Run all tests**

```bash
pnpm test
```
Expected: all pass (no regression)

**Step 6: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: show active session bar and session history after connecting"
```

---

## Verification

After all tasks:

```bash
pnpm test
```
Expected: at least 5 new tests (session-stats) + all original tests pass.

Inspect the DB after a session:
```bash
sqlite3 ~/.config/deskbike-app/deskbike.sqlite \
  "SELECT sensor_id, started_at, ended_at, duration_s, round(distance_m,1), round(avg_speed_kmh,1) FROM sessions ORDER BY started_at DESC LIMIT 5;"
```

Data persists in dev mode: the SQLite file is at `~/.config/deskbike-app/deskbike.sqlite` regardless of `pnpm dev` vs installed app — `app.getPath('userData')` resolves to the same location in both contexts.
