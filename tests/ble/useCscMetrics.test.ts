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

  it('returns null when newest record has no wheel data', () => {
    const records = [
      rec(0,    100, 1000, null, null),
      rec(1000, null, null, null, null),
    ]
    expect(computeSpeedFromWindow(records)).toBeNull()
  })
})

describe('computeCadenceFromWindow', () => {
  it('returns null with fewer than 2 records', () => {
    expect(computeCadenceFromWindow([])).toBeNull()
    expect(computeCadenceFromWindow([rec(0, null, null, 50, 1000)])).toBeNull()
  })

  it('returns null when crankTimeDiff is 0', () => {
    const records = [
      rec(0,    null, null, 50, 1000),
      rec(1000, null, null, 51, 1000),  // same crankTime
    ]
    expect(computeCadenceFromWindow(records)).toBeNull()
  })

  it('returns null when crankRevsDiff is 0', () => {
    const records = [
      rec(0,    null, null, 50, 1000),
      rec(1000, null, null, 50, 2024),
    ]
    expect(computeCadenceFromWindow(records)).toBeNull()
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

  it('returns null when newest record has no crank data', () => {
    const records = [
      rec(0,    null, null, 50, 1000),
      rec(1000, null, null, null, null),
    ]
    expect(computeCadenceFromWindow(records)).toBeNull()
  })
})
