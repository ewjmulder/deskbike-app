# useCscMetrics Hook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract all live CSC data calculations (speed, cadence, distance) into a single `useCscMetrics` hook with a rolling time-window for smooth speed output.

**Architecture:** A new `useCscMetrics(options?)` hook maintains an internal rolling buffer of recent BLE packets. Consumers call `processPacket(data)` on each received packet and read back `metrics.speedKmh / cadenceRpm / distanceM`. The hook exports pure computation helpers (`computeSpeedFromWindow`, `computeCadenceFromWindow`) that can be tested in the node environment without React. Both `DiagnosticTab` and `WidgetView` drop their duplicated calculation code and use the hook instead.

**Tech Stack:** TypeScript, React (`useRef`, `useState`, `useCallback`), Vitest (node environment)

---

### Task 1: Create `useCscMetrics.ts` — pure helpers + hook skeleton

**Files:**
- Create: `src/renderer/src/ble/useCscMetrics.ts`
- Create: `tests/ble/useCscMetrics.test.ts`

Reference: `src/renderer/src/ble/csc-parser.ts` for `CscRawFields` shape and rollover conventions.

---

**Step 1: Write failing tests for `computeSpeedFromWindow`**

Create `tests/ble/useCscMetrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  computeSpeedFromWindow,
  computeCadenceFromWindow,
  type PacketRecord,
} from '../../src/renderer/src/ble/useCscMetrics'

// Helper: build a minimal PacketRecord
function rec(
  timestamp: number,
  wheelRevs: number | null,
  wheelTime: number | null,
  crankRevs: number | null,
  crankTime: number | null
): PacketRecord {
  return {
    timestamp,
    parsed: {
      hasWheelData: wheelRevs !== null,
      hasCrankData: crankRevs !== null,
      wheelRevs,
      wheelTime,
      crankRevs,
      crankTime,
    },
  }
}

const WHEEL_CIRC = 2.105

describe('computeSpeedFromWindow', () => {
  it('returns null with fewer than 2 records', () => {
    expect(computeSpeedFromWindow([])).toBeNull()
    expect(computeSpeedFromWindow([rec(0, 100, 1024, null, null)])).toBeNull()
  })

  it('computes speed correctly from two records', () => {
    // 2 wheel revs in 1024 ticks (= 1 second at 1024 ticks/s)
    // distance = 2 * 2.105 = 4.21 m, time = 1 s, speed = 4.21 * 3.6 = 15.156 km/h
    const records = [
      rec(0,    100, 1000, null, null),
      rec(1000, 102, 2024, null, null),
    ]
    const speed = computeSpeedFromWindow(records)
    expect(speed).not.toBeNull()
    expect(speed!).toBeCloseTo((2 * WHEEL_CIRC / (1024 / 1024)) * 3.6, 2)
  })

  it('handles uint32 wheelRevs rollover', () => {
    const records = [
      rec(0,    0xffffffff, 1000, null, null),
      rec(1000, 1,          2024, null, null),
    ]
    const speed = computeSpeedFromWindow(records)
    // revsDiff = 2 (rollover-corrected)
    expect(speed).not.toBeNull()
    expect(speed!).toBeCloseTo((2 * WHEEL_CIRC / (1024 / 1024)) * 3.6, 2)
  })

  it('handles uint16 wheelTime rollover', () => {
    const records = [
      rec(0,    100, 0xffff, null, null),
      rec(1000, 102, 511,    null, null),
    ]
    // timeDiff = (511 - 0xffff) & 0xffff = 512
    const speed = computeSpeedFromWindow(records)
    expect(speed).not.toBeNull()
    expect(speed!).toBeCloseTo((2 * WHEEL_CIRC / (512 / 1024)) * 3.6, 2)
  })

  it('returns null when oldest record has no wheel data', () => {
    const records = [
      rec(0,    null, null, null, null),
      rec(1000, 102,  2024, null, null),
    ]
    expect(computeSpeedFromWindow(records)).toBeNull()
  })

  it('returns null when wheelRevsDiff is 0', () => {
    const records = [
      rec(0,    100, 1000, null, null),
      rec(1000, 100, 2024, null, null),
    ]
    expect(computeSpeedFromWindow(records)).toBeNull()
  })
})

describe('computeCadenceFromWindow', () => {
  it('returns null with fewer than 2 records', () => {
    expect(computeCadenceFromWindow([])).toBeNull()
  })

  it('computes cadence correctly', () => {
    // 1 crank rev in 1024 ticks (= 1 s) → 60 RPM
    const records = [
      rec(0,    null, null, 50, 1000),
      rec(1000, null, null, 51, 2024),
    ]
    const cadence = computeCadenceFromWindow(records)
    expect(cadence).not.toBeNull()
    expect(cadence!).toBeCloseTo(60, 1)
  })

  it('handles uint16 crankRevs rollover', () => {
    const records = [
      rec(0,    null, null, 0xffff, 1000),
      rec(1000, null, null, 1,      2024),
    ]
    // revsDiff = 2
    const cadence = computeCadenceFromWindow(records)
    expect(cadence).not.toBeNull()
    expect(cadence!).toBeCloseTo(120, 1)
  })

  it('returns null when oldest record has no crank data', () => {
    const records = [
      rec(0,    null, null, null, null),
      rec(1000, null, null, 51,   2024),
    ]
    expect(computeCadenceFromWindow(records)).toBeNull()
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
cd /home/erik/repos/bytecraft/digital/deskbike-app
pnpm test -- tests/ble/useCscMetrics.test.ts
```

Expected: FAIL — `computeSpeedFromWindow` / `computeCadenceFromWindow` not found.

---

**Step 3: Implement `useCscMetrics.ts`**

Create `src/renderer/src/ble/useCscMetrics.ts`:

```ts
// src/renderer/src/ble/useCscMetrics.ts

import { useCallback, useRef, useState } from 'react'
import { parseRawCsc, type CscRawFields } from './csc-parser'

const WHEEL_CIRCUMFERENCE_M = 2.105
const DEFAULT_WINDOW_MS = 5000

export interface LiveMetrics {
  speedKmh: number | null
  cadenceRpm: number | null
  distanceM: number
}

export interface UseCscMetricsOptions {
  windowMs?: number
}

export interface PacketRecord {
  timestamp: number
  parsed: CscRawFields
}

export function computeSpeedFromWindow(records: PacketRecord[]): number | null {
  if (records.length < 2) return null
  const oldest = records[0]
  const newest = records[records.length - 1]
  if (!oldest.parsed.hasWheelData || !newest.parsed.hasWheelData) return null
  if (oldest.parsed.wheelRevs === null || newest.parsed.wheelRevs === null) return null
  if (oldest.parsed.wheelTime === null || newest.parsed.wheelTime === null) return null

  const revsDiff = (newest.parsed.wheelRevs - oldest.parsed.wheelRevs) >>> 0
  const timeDiff = (newest.parsed.wheelTime - oldest.parsed.wheelTime) & 0xffff
  if (revsDiff === 0 || timeDiff === 0) return null

  return (revsDiff * WHEEL_CIRCUMFERENCE_M / (timeDiff / 1024)) * 3.6
}

export function computeCadenceFromWindow(records: PacketRecord[]): number | null {
  if (records.length < 2) return null
  const oldest = records[0]
  const newest = records[records.length - 1]
  if (!oldest.parsed.hasCrankData || !newest.parsed.hasCrankData) return null
  if (oldest.parsed.crankRevs === null || newest.parsed.crankRevs === null) return null
  if (oldest.parsed.crankTime === null || newest.parsed.crankTime === null) return null

  const revsDiff = (newest.parsed.crankRevs - oldest.parsed.crankRevs) & 0xffff
  const timeDiff = (newest.parsed.crankTime - oldest.parsed.crankTime) & 0xffff
  if (revsDiff === 0 || timeDiff === 0) return null

  return (revsDiff / (timeDiff / 1024)) * 60
}

export function useCscMetrics(options?: UseCscMetricsOptions): {
  metrics: LiveMetrics
  processPacket: (data: Uint8Array) => CscRawFields
  reset: () => void
} {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS
  const bufferRef = useRef<PacketRecord[]>([])
  const prevParsedRef = useRef<CscRawFields | null>(null)
  const distanceRef = useRef(0)
  const [metrics, setMetrics] = useState<LiveMetrics>({
    speedKmh: null,
    cadenceRpm: null,
    distanceM: 0,
  })

  const processPacket = useCallback(
    (data: Uint8Array): CscRawFields => {
      const now = Date.now()
      const parsed = parseRawCsc(data)

      // Accumulate distance per packet (delta vs previous packet only)
      if (prevParsedRef.current) {
        const prev = prevParsedRef.current
        if (
          parsed.hasWheelData &&
          prev.hasWheelData &&
          parsed.wheelRevs !== null &&
          prev.wheelRevs !== null
        ) {
          const revsDiff = (parsed.wheelRevs - prev.wheelRevs) >>> 0
          if (revsDiff > 0) distanceRef.current += revsDiff * WHEEL_CIRCUMFERENCE_M
        }
      }
      prevParsedRef.current = parsed

      // Update rolling window and evict old records
      bufferRef.current.push({ timestamp: now, parsed })
      const cutoff = now - windowMs
      let i = 0
      while (i < bufferRef.current.length && bufferRef.current[i].timestamp < cutoff) i++
      if (i > 0) bufferRef.current = bufferRef.current.slice(i)

      setMetrics({
        speedKmh: computeSpeedFromWindow(bufferRef.current),
        cadenceRpm: computeCadenceFromWindow(bufferRef.current),
        distanceM: distanceRef.current,
      })

      return parsed
    },
    [windowMs]
  )

  const reset = useCallback(() => {
    bufferRef.current = []
    prevParsedRef.current = null
    distanceRef.current = 0
    setMetrics({ speedKmh: null, cadenceRpm: null, distanceM: 0 })
  }, [])

  return { metrics, processPacket, reset }
}
```

**Step 4: Run tests — all should pass**

```bash
pnpm test -- tests/ble/useCscMetrics.test.ts
```

Expected: All tests PASS.

**Step 5: Run full test suite — no regressions**

```bash
pnpm test
```

Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add src/renderer/src/ble/useCscMetrics.ts tests/ble/useCscMetrics.test.ts
git commit -m "feat(renderer): add useCscMetrics hook with rolling window speed smoothing"
```

---

### Task 2: Refactor `DiagnosticTab.tsx`

**Files:**
- Modify: `src/renderer/src/DiagnosticTab.tsx`

Reference the existing file carefully — only touch the calculation-related code. Do not change session logic, IPC calls, or UI layout.

---

**Step 1: Add the hook import, remove old imports and state**

In `DiagnosticTab.tsx`:

1. **Add** import at top (after existing imports):
   ```ts
   import { useCscMetrics } from './ble/useCscMetrics'
   ```

2. **Change** the csc-parser import — remove `computeDeltas` and `CscRawFields` since they are no longer used directly:
   ```ts
   // Before:
   import { parseRawCsc, computeDeltas, type CscRawFields } from './ble/csc-parser'
   // After:
   import { parseRawCsc } from './ble/csc-parser'
   ```
   Note: `parseRawCsc` is still needed for the `saveMeasurement` call — wait, actually `processPacket` returns `CscRawFields`, so `parseRawCsc` is no longer needed either. Remove the entire csc-parser import.
   ```ts
   // Remove entirely:
   import { parseRawCsc, computeDeltas, type CscRawFields } from './ble/csc-parser'
   ```

3. **Remove** these state declarations (around lines 25-27):
   ```ts
   const [liveSpeed, setLiveSpeed] = useState<number | null>(null)
   const [liveCadence, setLiveCadence] = useState<number | null>(null)
   const [sessionDistance, setSessionDistance] = useState(0)
   ```

4. **Remove** these ref declarations (around lines 34-36):
   ```ts
   const prevCscRef = useRef<CscRawFields | null>(null)
   const prevTimestampRef = useRef<number | null>(null)
   const sessionDistanceRef = useRef(0)
   ```

5. **Remove** the `WHEEL_CIRCUMFERENCE_M` constant (around line 41):
   ```ts
   const WHEEL_CIRCUMFERENCE_M = 2.105
   ```

6. **Add** hook call at the top of the component body (after the existing `useState`/`useRef` declarations):
   ```ts
   const { metrics, processPacket, reset: resetMetrics } = useCscMetrics()
   ```

**Step 2: Update the data callback — replace calculation block**

Find the block inside `handleConnect`'s `selectDevice` data callback (around lines 213-231):

```ts
// REMOVE this entire block:
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
```

Also change the top of the data callback where `parsed` is computed:
```ts
// Before (two lines):
const parsed = parseRawCsc(data)
const now = Date.now()

// After (one line — processPacket parses internally and returns CscRawFields):
const now = Date.now()
const parsed = processPacket(data)
```

Wait — `now` is also used for `timestampUtc`. The order should be:
```ts
const now = Date.now()
const timestampUtc = new Date(now).toISOString()
const parsed = processPacket(data)
```

**Step 3: Update `endActiveSession` — call `resetMetrics()`**

At the end of `endActiveSession`, after resetting `setSessionId(null)` etc., add:
```ts
resetMetrics()
```

Also remove these lines from `endActiveSession` (they reset the old state that no longer exists):
```ts
setLiveSpeed(null)
setLiveCadence(null)
setSessionDistance(0)
sessionDistanceRef.current = 0
prevCscRef.current = null
prevTimestampRef.current = null
```

**Step 4: Update the render — replace old state refs with `metrics`**

In the JSX (around the active session bar):
```tsx
// Before:
{liveSpeed !== null && <span>{liveSpeed.toFixed(1)} km/h</span>}
{liveCadence !== null && <span>{Math.round(liveCadence)} RPM</span>}
{sessionDistance > 0 && <span>{formatDistance(sessionDistance)}</span>}

// After:
{metrics.speedKmh !== null && <span>{metrics.speedKmh.toFixed(1)} km/h</span>}
{metrics.cadenceRpm !== null && <span>{Math.round(metrics.cadenceRpm)} RPM</span>}
{metrics.distanceM > 0 && <span>{formatDistance(metrics.distanceM)}</span>}
```

**Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass. If TypeScript compile errors appear, fix them before continuing.

**Step 6: Commit**

```bash
git add src/renderer/src/DiagnosticTab.tsx
git commit -m "refactor(DiagnosticTab): use useCscMetrics hook, remove duplicated calculation logic"
```

---

### Task 3: Refactor `WidgetView.tsx`

**Files:**
- Modify: `src/renderer/src/components/widget/WidgetView.tsx`

---

**Step 1: Replace state and refs**

In `WidgetView.tsx`:

1. **Add** import at top:
   ```ts
   import { useCscMetrics } from '../../ble/useCscMetrics'
   ```

2. **Remove** import:
   ```ts
   import { parseRawCsc, computeDeltas, type CscRawFields } from '../../ble/csc-parser'
   ```

3. **Remove** the local `Metrics` interface and `metrics` state:
   ```ts
   // Remove:
   interface Metrics {
     speedKmh: number | null
     cadenceRpm: number | null
     distanceM: number
     elapsedS: number
   }
   const [metrics, setMetrics] = useState<Metrics>(...)
   ```

4. **Remove** these refs:
   ```ts
   // Remove:
   const prevCscRef = useRef<CscRawFields | null>(null)
   const prevTimestampRef = useRef<number | null>(null)
   const distanceRef = useRef(0)
   ```

5. **Remove** `WHEEL_CIRCUMFERENCE_M` constant.

6. **Add** at component top:
   ```ts
   const { metrics, processPacket, reset: resetMetrics } = useCscMetrics()
   const [elapsedS, setElapsedS] = useState(0)
   ```

**Step 2: Update `startElapsed` callback**

```ts
// Before:
setMetrics((m) => ({ ...m, elapsedS: Math.floor((Date.now() - sessionStartRef.current!) / 1000) }))

// After:
setElapsedS(Math.floor((Date.now() - sessionStartRef.current!) / 1000))
```

**Step 3: Update `reset` callback**

```ts
// Before (inside reset useCallback):
setMetrics({ speedKmh: null, cadenceRpm: null, distanceM: 0, elapsedS: 0 })

// After:
resetMetrics()
setElapsedS(0)
```

Also remove these lines from reset (no longer needed):
```ts
prevCscRef.current = null
prevTimestampRef.current = null
distanceRef.current = 0
```

**Step 4: Update the onData callback**

Replace the calculation block:

```ts
// Before:
window.deskbike.onData((raw) => {
  const now = Date.now()
  const parsed = parseRawCsc(new Uint8Array(raw))

  if (!connectedRef.current) {
    connectedRef.current = true
    setConnected(true)
    startElapsed()
  }

  if (prevCscRef.current && prevTimestampRef.current !== null) {
    const deltas = computeDeltas(parsed, prevCscRef.current, now - prevTimestampRef.current)
    let distanceDelta = 0
    let speedKmh: number | null = null
    let cadenceRpm: number | null = null
    if (deltas.wheelRevsDiff !== null && deltas.wheelRevsDiff > 0 &&
        deltas.wheelTimeDiff !== null && deltas.wheelTimeDiff > 0) {
      distanceDelta = deltas.wheelRevsDiff * WHEEL_CIRCUMFERENCE_M
      speedKmh = (distanceDelta / (deltas.wheelTimeDiff / 1024)) * 3.6
      distanceRef.current += distanceDelta
    }
    if (deltas.crankRevsDiff !== null && deltas.crankRevsDiff > 0 &&
        deltas.crankTimeDiff !== null && deltas.crankTimeDiff > 0) {
      cadenceRpm = (deltas.crankRevsDiff / (deltas.crankTimeDiff / 1024)) * 60
    }
    setMetrics((m) => ({
      ...m,
      ...(speedKmh !== null && { speedKmh }),
      ...(cadenceRpm !== null && { cadenceRpm }),
      distanceM: distanceRef.current,
    }))
  }
  prevCscRef.current = parsed
  prevTimestampRef.current = now
})

// After:
window.deskbike.onData((raw) => {
  processPacket(new Uint8Array(raw))

  if (!connectedRef.current) {
    connectedRef.current = true
    setConnected(true)
    startElapsed()
  }
})
```

**Step 5: Update the render — use `metrics` from hook + local `elapsedS`**

```tsx
// Before:
{metrics.speedKmh !== null ? metrics.speedKmh.toFixed(1) : '—'}
{metrics.cadenceRpm !== null ? `${Math.round(metrics.cadenceRpm)} RPM` : '— RPM'}
{formatDistance(metrics.distanceM)}
{formatDuration(metrics.elapsedS)}

// After (same, but elapsedS is now a local state variable, not from metrics):
{metrics.speedKmh !== null ? metrics.speedKmh.toFixed(1) : '—'}
{metrics.cadenceRpm !== null ? `${Math.round(metrics.cadenceRpm)} RPM` : '— RPM'}
{formatDistance(metrics.distanceM)}
{formatDuration(elapsedS)}
```

**Step 6: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add src/renderer/src/components/widget/WidgetView.tsx
git commit -m "refactor(WidgetView): use useCscMetrics hook, remove duplicated calculation logic"
```

---

### Task 4: Verify end-to-end in the app

**Step 1: Start the app in mock mode**

```bash
pnpm dev:mock
```

**Step 2: Manual smoke test**

1. Open the app → Live tab
2. Click Scan → connect to `DeskBike-MOCK`
3. Observe: speed and cadence appear in the active session bar, distance accumulates
4. Move the mock speed slider → speed updates smoothly (5-second window means it takes ~5s to fully converge to new speed)
5. Click the widget toggle (⤢) → widget window opens
6. Verify widget shows same approximate speed/cadence/distance

**Step 3: Stop the app**

`Ctrl+C`

---

### Rollover reference

The rollover corrections used throughout this plan match `csc-parser.ts` conventions:
- `wheelRevs` (uint32): `(newest - oldest) >>> 0`
- `wheelTime` (uint16): `(newest - oldest) & 0xffff`
- `crankRevs` (uint16): `(newest - oldest) & 0xffff`
- `crankTime` (uint16): `(newest - oldest) & 0xffff`
