import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../../src/main/db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>

vi.mock('../../../src/main/db/index', () => ({
  getDb: () => testDb,
}))

import { touchSession, closeOrphanedSessions, startSession } from '../../../src/main/db/queries'

function createSchema(sqlite: InstanceType<typeof Database>): void {
  sqlite.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      sensor_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      distance_m REAL,
      duration_s INTEGER,
      avg_speed_kmh REAL,
      avg_cadence_rpm REAL,
      max_speed_kmh REAL,
      max_cadence_rpm REAL
    );
    CREATE TABLE measurements (
      id TEXT PRIMARY KEY,
      sensor_id TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL,
      raw_data BLOB NOT NULL,
      has_wheel_data INTEGER NOT NULL,
      has_crank_data INTEGER NOT NULL,
      wheel_revs INTEGER,
      wheel_time INTEGER,
      crank_revs INTEGER,
      crank_time INTEGER,
      time_diff_ms INTEGER,
      wheel_revs_diff INTEGER,
      wheel_time_diff INTEGER,
      crank_revs_diff INTEGER,
      crank_time_diff INTEGER
    );
  `)
}

function insertMeasurement(sqlite: InstanceType<typeof Database>, opts: {
  id: string
  sensorId: string
  timestampUtc: string
  wheelRevsDiff?: number
  wheelTimeDiff?: number
}): void {
  sqlite.prepare(`
    INSERT INTO measurements
      (id, sensor_id, timestamp_utc, raw_data, has_wheel_data, has_crank_data,
       wheel_revs_diff, wheel_time_diff)
    VALUES (?, ?, ?, X'00', 1, 0, ?, ?)
  `).run(
    opts.id, opts.sensorId, opts.timestampUtc,
    opts.wheelRevsDiff ?? null, opts.wheelTimeDiff ?? null
  )
}

function getSession(sqlite: InstanceType<typeof Database>, id: string) {
  return sqlite.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown>
}

// Store the sqlite instance alongside the drizzle wrapper
let sqliteInstance: InstanceType<typeof Database>

beforeEach(() => {
  sqliteInstance = new Database(':memory:')
  createSchema(sqliteInstance)
  testDb = drizzle(sqliteInstance, { schema })
})

describe('touchSession', () => {
  it('sets ended_at on an open session', () => {
    const sessionId = startSession('sensor-1', '2026-01-01T10:00:00.000Z')
    touchSession(sessionId, '2026-01-01T10:05:00.000Z')
    const row = getSession(sqliteInstance, sessionId)
    expect(row.ended_at).toBe('2026-01-01T10:05:00.000Z')
  })

  it('updates ended_at when called multiple times', () => {
    const sessionId = startSession('sensor-1', '2026-01-01T10:00:00.000Z')
    touchSession(sessionId, '2026-01-01T10:01:00.000Z')
    touchSession(sessionId, '2026-01-01T10:02:00.000Z')
    const row = getSession(sqliteInstance, sessionId)
    expect(row.ended_at).toBe('2026-01-01T10:02:00.000Z')
  })

  it('does not affect other sessions', () => {
    const id1 = startSession('sensor-1', '2026-01-01T10:00:00.000Z')
    const id2 = startSession('sensor-1', '2026-01-01T11:00:00.000Z')
    touchSession(id1, '2026-01-01T10:30:00.000Z')
    expect(getSession(sqliteInstance, id2).ended_at).toBeNull()
  })
})

describe('closeOrphanedSessions', () => {
  it('does nothing when all sessions already have ended_at', () => {
    const sessionId = startSession('sensor-1', '2026-01-01T10:00:00.000Z')
    touchSession(sessionId, '2026-01-01T10:30:00.000Z')
    closeOrphanedSessions()
    expect(getSession(sqliteInstance, sessionId).ended_at).toBe('2026-01-01T10:30:00.000Z')
  })

  it('closes orphaned session using last measurement timestamp', () => {
    const sessionId = startSession('sensor-1', '2026-01-01T10:00:00.000Z')
    insertMeasurement(sqliteInstance, { id: 'm1', sensorId: 'sensor-1', timestampUtc: '2026-01-01T10:01:00.000Z' })
    insertMeasurement(sqliteInstance, { id: 'm2', sensorId: 'sensor-1', timestampUtc: '2026-01-01T10:05:00.000Z' })
    closeOrphanedSessions()
    expect(getSession(sqliteInstance, sessionId).ended_at).toBe('2026-01-01T10:05:00.000Z')
  })

  it('falls back to started_at when orphaned session has no measurements', () => {
    const sessionId = startSession('sensor-1', '2026-01-01T10:00:00.000Z')
    closeOrphanedSessions()
    expect(getSession(sqliteInstance, sessionId).ended_at).toBe('2026-01-01T10:00:00.000Z')
  })

  it('respects session boundaries: excludes measurements from later sessions', () => {
    const id1 = startSession('sensor-1', '2026-01-01T10:00:00.000Z')
    const id2 = startSession('sensor-1', '2026-01-01T11:00:00.000Z')
    insertMeasurement(sqliteInstance, { id: 'm1', sensorId: 'sensor-1', timestampUtc: '2026-01-01T10:30:00.000Z' })
    insertMeasurement(sqliteInstance, { id: 'm2', sensorId: 'sensor-1', timestampUtc: '2026-01-01T11:30:00.000Z' })
    closeOrphanedSessions()
    expect(getSession(sqliteInstance, id1).ended_at).toBe('2026-01-01T10:30:00.000Z')
    expect(getSession(sqliteInstance, id2).ended_at).toBe('2026-01-01T11:30:00.000Z')
  })

  it('computes distance and duration stats when closing', () => {
    const sessionId = startSession('sensor-1', '2026-01-01T10:00:00.000Z')
    // 2 revs in 1024 ticks (1 second) → 2 * 2.105 = 4.21 m
    insertMeasurement(sqliteInstance, {
      id: 'm1', sensorId: 'sensor-1', timestampUtc: '2026-01-01T10:00:01.000Z',
      wheelRevsDiff: 2, wheelTimeDiff: 1024,
    })
    closeOrphanedSessions()
    const row = getSession(sqliteInstance, sessionId)
    expect(row.ended_at).toBe('2026-01-01T10:00:01.000Z')
    expect(row.duration_s).toBeCloseTo(1, 0)
    expect(row.distance_m).toBeCloseTo(4.21, 1)
  })
})
