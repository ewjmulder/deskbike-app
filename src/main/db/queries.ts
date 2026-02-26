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
