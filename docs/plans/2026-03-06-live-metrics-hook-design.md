# Design: useCscMetrics hook — centralized live data calculations

**Status:** Approved — ready for implementation
**Date:** 2026-03-06

## Problem

The calculation pipeline from raw BLE bytes to km/h, RPM and accumulated distance
is duplicated between `DiagnosticTab.tsx` and `WidgetView.tsx`. Both files:

- call `parseRawCsc` and `computeDeltas`
- maintain their own `prevCscRef` / `prevTimestampRef` refs
- apply the same speed and cadence formulas
- hardcode `WHEEL_CIRCUMFERENCE_M = 2.105`

Any formula change must be made in two places and can silently diverge.

## Goal

One module owns all live-data calculations. Consumers call it and get
`speedKmh`, `cadenceRpm`, `distanceM` back — no knowledge of CSC internals
needed. At runtime each window has its own instance; the code lives in one place.

## New file

`src/renderer/src/ble/useCscMetrics.ts`

## Interface

```ts
interface LiveMetrics {
  speedKmh: number | null    // null until enough history
  cadenceRpm: number | null
  distanceM: number          // accumulated since reset()
}

interface UseCscMetricsOptions {
  windowMs?: number          // rolling window size, default 5000 ms
}

function useCscMetrics(options?: UseCscMetricsOptions): {
  metrics: LiveMetrics
  processPacket: (data: Uint8Array) => void
  reset: () => void
}
```

## Calculation strategy

The hook maintains an internal buffer of `{ timestamp: number, parsed: CscRawFields }` records.

On each `processPacket(data)`:
1. Parse via existing `parseRawCsc(data)`
2. Append record to buffer
3. Drop records older than `windowMs`
4. Compute speed: `(wheelRevs_newest − wheelRevs_oldest) >>> 0` / time span in
   1/1024 s units × circumference × 3.6 — same rollover correction as `computeDeltas`
5. Compute cadence: analogous with crankRevs over the window
6. Accumulate `distanceM`: delta from the previous packet only (not window oldest)
   so no distance is lost when old records are evicted

Edge cases:
- Buffer has < 2 entries → `speedKmh = null`, `cadenceRpm = null`
- Packet has no wheel/crank data → corresponding metric stays `null`
- `reset()` clears buffer and resets `distanceM` to 0

## Changes to existing files

### DiagnosticTab.tsx

Remove:
- `prevCscRef`, `prevTimestampRef`, `sessionDistanceRef`
- `liveSpeed`, `liveCadence`, `sessionDistance` state
- Wheel/crank/distance calculation block inside data callback
- `WHEEL_CIRCUMFERENCE_M` constant

Add:
```ts
const { metrics, processPacket, reset } = useCscMetrics()
// data callback: processPacket(data)
// endActiveSession: reset()
// render: metrics.speedKmh, metrics.cadenceRpm, metrics.distanceM
```

### WidgetView.tsx

Remove:
- `prevCscRef`, `prevTimestampRef`, `distanceRef`
- Wheel/crank/distance calculation block inside onData callback
- `WHEEL_CIRCUMFERENCE_M` constant

Add:
```ts
const { metrics, processPacket, reset } = useCscMetrics()
// onData: processPacket(new Uint8Array(raw))
// onDisconnected: reset()
```

## Tests

New file: `tests/renderer/useCscMetrics.test.ts`

Cover:
- Speed and cadence computed correctly from two packets
- Rolling window evicts old records, speed reflects only recent data
- Rollover handling for wheelRevs (uint32) and crankRevs (uint16)
- `reset()` clears all state
- `null` returned before second packet arrives

Existing `csc-parser.test.ts` unchanged.

## Files touched

| File | Change |
|------|--------|
| `src/renderer/src/ble/useCscMetrics.ts` | **new** |
| `src/renderer/src/DiagnosticTab.tsx` | refactor (remove duplicate logic) |
| `src/renderer/src/components/widget/WidgetView.tsx` | refactor (remove duplicate logic) |
| `tests/renderer/useCscMetrics.test.ts` | **new** |
