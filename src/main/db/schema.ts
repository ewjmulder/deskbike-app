import { sqliteTable, text, integer, real, blob, index } from 'drizzle-orm/sqlite-core'

export const measurements = sqliteTable(
  'measurements',
  {
    id: text('id').primaryKey(),
    sensorId: text('sensor_id').notNull(),
    timestampUtc: text('timestamp_utc').notNull(),
    rawData: blob('raw_data', { mode: 'buffer' }).notNull(),

    // Layer 2: CSC spec decoding
    hasWheelData: integer('has_wheel_data', { mode: 'boolean' }).notNull(),
    hasCrankData: integer('has_crank_data', { mode: 'boolean' }).notNull(),
    wheelRevs: integer('wheel_revs'),
    wheelTime: integer('wheel_time'),
    crankRevs: integer('crank_revs'),
    crankTime: integer('crank_time'),

    // Layer 3: Deltas relative to previous measurement from same sensor
    timeDiffMs: integer('time_diff_ms'),
    wheelRevsDiff: integer('wheel_revs_diff'),
    wheelTimeDiff: integer('wheel_time_diff'),
    crankRevsDiff: integer('crank_revs_diff'),
    crankTimeDiff: integer('crank_time_diff')
  },
  (table) => [index('idx_measurements_sensor_ts').on(table.sensorId, table.timestampUtc)]
)

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  sensorId: text('sensor_id').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  distanceM: real('distance_m'),
  durationS: integer('duration_s'),
  avgSpeedKmh: real('avg_speed_kmh'),
  avgCadenceRpm: real('avg_cadence_rpm'),
  maxSpeedKmh: real('max_speed_kmh'),
  maxCadenceRpm: real('max_cadence_rpm')
})

export const computedMetrics = sqliteTable('computed_metrics', {
  measurementId: text('measurement_id').primaryKey().references(() => measurements.id),
  sessionId: text('session_id').references(() => sessions.id),
  wheelCircumferenceM: real('wheel_circumference_m'),
  speedKmh: real('speed_kmh'),
  cadenceRpm: real('cadence_rpm'),
  distanceM: real('distance_m')
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const achievements = sqliteTable('achievements', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  unlockedAt: text('unlocked_at').notNull(),
  metadata: text('metadata')
})
