# Session History Design

> **Status update (2026-02-27):** Implemented design.
> Session lifecycle and aggregation behavior described here are active in the codebase.
> Current source of truth: `src/renderer/src/DiagnosticTab.tsx`, `src/main/db/queries.ts`, `src/main/db/session-stats.ts`.


**Date:** 2026-02-27
**Status:** Approved

## Goal

Persist all incoming BLE measurement data per sensor, automatically detect cycling sessions, and show a session history overview after connecting to a sensor.

## Context

The SQLite database already stores every raw measurement via `saveMeasurement` IPC. The `sessions` table exists in the schema but is not yet populated. The `measurements` table already partitions by `sensor_id`.

Data persistence works identically in dev and production: `app.getPath('userData')` resolves to `~/.config/deskbike-app/` (Linux) in both modes.

## Approach: Renderer-driven sessions

Session lifecycle is managed by the renderer, which sees every data packet. The main process handles DB writes and statistics computation.

## Session Lifecycle

1. **Session start:** Triggered by the renderer on the first data packet after connecting. The renderer calls `session:start` IPC → main inserts a row in `sessions`, returns `sessionId`.
2. **Inactivity detection:** The renderer maintains a 2-minute inactivity timer, reset on every data packet. When the timer fires, the renderer calls `session:end`.
3. **Disconnect:** The renderer calls `session:end` immediately if a session is active, then disconnects.

## Statistics Computation

On `session:end`, the main process queries all measurements for the sensor within the session's time range and computes:

| Field | Formula |
|-------|---------|
| `durationS` | `endedAt − startedAt` in seconds |
| `distanceM` | Σ `wheel_revs_diff × WHEEL_CIRCUMFERENCE_M` |
| `avgSpeedKmh` | mean of per-packet speed: `(revs_diff × circ) / (time_diff_s) × 3.6` |
| `maxSpeedKmh` | max per-packet speed |
| `avgCadenceRpm` | mean of `(crank_revs_diff / (crank_time_diff / 1024)) × 60` |
| `maxCadenceRpm` | max per-packet cadence |

**Fixed wheel circumference:** `2.105 m` (700c/28" city bike). Stored as a constant; configurable later via the `settings` table.

Sessions without wheel data (crank only) store duration and cadence stats; distance and speed fields remain `null`.

## New DB Queries

File: `src/main/db/queries.ts`

- `startSession(sensorId: string, startedAt: string): string` — inserts session row, returns `id`
- `endSession(sessionId: string, endedAt: string): void` — queries measurements in time range, computes and writes stats
- `getSessionHistory(sensorId: string, limit?: number): Session[]` — returns sessions most-recent-first

## New IPC Channels

| Channel | Direction | Request | Response |
|---------|-----------|---------|----------|
| `session:start` | invoke | `{ sensorId, startedAt }` | `{ sessionId }` |
| `session:end` | invoke | `{ sessionId, endedAt }` | `void` |
| `session:get-history` | invoke | `{ sensorId }` | `Session[]` |

Registered in `src/main/ipc/handlers.ts`, exposed via `src/preload/index.ts`.

## Renderer Changes (App.tsx)

- On connect success: call `session:get-history` for the connected sensor and store in state.
- On first data packet: call `session:start`, store `sessionId` in state; start inactivity timer.
- On each subsequent packet: reset inactivity timer; update live stats (speed, cadence) in state.
- On inactivity timeout or disconnect: call `session:end` with current timestamp.

## UI

Added to the existing diagnostic view below the live data section:

- **Active session bar:** elapsed time, distance so far, current speed (updated from live data)
- **Session history table:** date/time, duration, distance, avg speed (columns hidden if no wheel data for that sensor)

No separate page or route is needed.

## No Schema Changes

The existing `sessions` table schema covers all required fields. No migration needed.
