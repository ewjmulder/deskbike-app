import { eq, desc } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { getDb } from './index'
import { measurements } from './schema'
import { parseRawCsc, computeDeltas, CscRawFields } from '../ble/csc-parser'

export interface InsertMeasurementInput {
  sensorId: string
  timestampUtc: string  // ISO 8601
  rawData: Buffer
}

export function insertMeasurement(input: InsertMeasurementInput): void {
  const db = getDb()
  const parsed = parseRawCsc(input.rawData)

  const prev = db
    .select()
    .from(measurements)
    .where(eq(measurements.sensorId, input.sensorId))
    .orderBy(desc(measurements.timestampUtc))
    .limit(1)
    .all()[0]

  const prevFields: CscRawFields | null = prev
    ? {
        hasWheelData: prev.hasWheelData,
        hasCrankData: prev.hasCrankData,
        wheelRevs: prev.wheelRevs,
        wheelTime: prev.wheelTime,
        crankRevs: prev.crankRevs,
        crankTime: prev.crankTime
      }
    : null

  const timeDiffMs = prev
    ? new Date(input.timestampUtc).getTime() - new Date(prev.timestampUtc).getTime()
    : null

  const deltas =
    prevFields && timeDiffMs !== null
      ? computeDeltas(parsed, prevFields, timeDiffMs)
      : null

  db.insert(measurements)
    .values({
      id: randomUUID(),
      sensorId: input.sensorId,
      timestampUtc: input.timestampUtc,
      rawData: input.rawData,
      hasWheelData: parsed.hasWheelData,
      hasCrankData: parsed.hasCrankData,
      wheelRevs: parsed.wheelRevs,
      wheelTime: parsed.wheelTime,
      crankRevs: parsed.crankRevs,
      crankTime: parsed.crankTime,
      timeDiffMs: deltas?.timeDiffMs ?? null,
      wheelRevsDiff: deltas?.wheelRevsDiff ?? null,
      wheelTimeDiff: deltas?.wheelTimeDiff ?? null,
      crankRevsDiff: deltas?.crankRevsDiff ?? null,
      crankTimeDiff: deltas?.crankTimeDiff ?? null
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
