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
  let totalWheelTimeTicks = 0
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
      totalWheelTimeTicks += m.wheelTimeDiff
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
    avgSpeedKmh: totalWheelTimeTicks > 0 ? (totalDistanceM / (totalWheelTimeTicks / 1024)) * 3.6 : null,
    maxSpeedKmh: speeds.length > 0 ? Math.max(...speeds) : null,
    avgCadenceRpm: cadences.length > 0 ? avg(cadences) : null,
    maxCadenceRpm: cadences.length > 0 ? Math.max(...cadences) : null,
  }
}
