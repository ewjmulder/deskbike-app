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
