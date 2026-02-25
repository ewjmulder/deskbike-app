import { describe, it, expect } from 'vitest'
import { parseRawCsc, computeDeltas } from '../../src/main/ble/csc-parser'

describe('parseRawCsc', () => {
  it('parses wheel-only data', () => {
    // flags=0x01 | wheel_revs=100 (uint32 LE) | wheel_time=1024 (uint16 LE)
    const data = Buffer.from([0x01, 0x64, 0x00, 0x00, 0x00, 0x00, 0x04])
    const result = parseRawCsc(data)
    expect(result.hasWheelData).toBe(true)
    expect(result.hasCrankData).toBe(false)
    expect(result.wheelRevs).toBe(100)
    expect(result.wheelTime).toBe(1024)
    expect(result.crankRevs).toBeNull()
    expect(result.crankTime).toBeNull()
  })

  it('parses crank-only data', () => {
    // flags=0x02 | crank_revs=50 (uint16 LE) | crank_time=512 (uint16 LE)
    const data = Buffer.from([0x02, 0x32, 0x00, 0x00, 0x02])
    const result = parseRawCsc(data)
    expect(result.hasWheelData).toBe(false)
    expect(result.hasCrankData).toBe(true)
    expect(result.wheelRevs).toBeNull()
    expect(result.crankRevs).toBe(50)
    expect(result.crankTime).toBe(512)
  })

  it('parses both wheel and crank data', () => {
    // flags=0x03 | wheel_revs=200 | wheel_time=2048 | crank_revs=70 | crank_time=1024
    const data = Buffer.from([
      0x03,
      0xc8, 0x00, 0x00, 0x00, // wheel_revs = 200
      0x00, 0x08,             // wheel_time = 2048
      0x46, 0x00,             // crank_revs = 70
      0x00, 0x04              // crank_time = 1024
    ])
    const result = parseRawCsc(data)
    expect(result.hasWheelData).toBe(true)
    expect(result.hasCrankData).toBe(true)
    expect(result.wheelRevs).toBe(200)
    expect(result.wheelTime).toBe(2048)
    expect(result.crankRevs).toBe(70)
    expect(result.crankTime).toBe(1024)
  })
})

describe('computeDeltas', () => {
  const noData = { hasWheelData: false, hasCrankData: false, wheelRevs: null, wheelTime: null, crankRevs: null, crankTime: null }

  it('computes wheel and crank deltas', () => {
    const prev = { hasWheelData: true, hasCrankData: true, wheelRevs: 100, wheelTime: 1000, crankRevs: 50, crankTime: 500 }
    const curr = { hasWheelData: true, hasCrankData: true, wheelRevs: 102, wheelTime: 2048, crankRevs: 51, crankTime: 1524 }
    const d = computeDeltas(curr, prev, 1000)
    expect(d.timeDiffMs).toBe(1000)
    expect(d.wheelRevsDiff).toBe(2)
    expect(d.wheelTimeDiff).toBe(1048)
    expect(d.crankRevsDiff).toBe(1)
    expect(d.crankTimeDiff).toBe(1024)
  })

  it('handles uint32 wheel revs rollover', () => {
    const prev = { ...noData, hasWheelData: true, wheelRevs: 0xffffffff, wheelTime: 100 }
    const curr = { ...noData, hasWheelData: true, wheelRevs: 1, wheelTime: 200 }
    const d = computeDeltas(curr, prev, 500)
    expect(d.wheelRevsDiff).toBe(2)
  })

  it('handles uint16 wheel time rollover', () => {
    const prev = { ...noData, hasWheelData: true, wheelRevs: 100, wheelTime: 0xffff }
    const curr = { ...noData, hasWheelData: true, wheelRevs: 102, wheelTime: 511 }
    const d = computeDeltas(curr, prev, 500)
    expect(d.wheelTimeDiff).toBe(512)
  })

  it('handles uint16 crank revs rollover', () => {
    const prev = { ...noData, hasCrankData: true, crankRevs: 0xffff, crankTime: 100 }
    const curr = { ...noData, hasCrankData: true, crankRevs: 1, crankTime: 200 }
    const d = computeDeltas(curr, prev, 500)
    expect(d.crankRevsDiff).toBe(2)
  })

  it('returns null deltas when previous has no wheel data', () => {
    const prev = { ...noData }
    const curr = { ...noData, hasWheelData: true, wheelRevs: 100, wheelTime: 1024 }
    const d = computeDeltas(curr, prev, 1000)
    expect(d.wheelRevsDiff).toBeNull()
    expect(d.wheelTimeDiff).toBeNull()
  })

  it('returns null deltas when current has no crank data', () => {
    const prev = { ...noData, hasCrankData: true, crankRevs: 50, crankTime: 500 }
    const curr = { ...noData }
    const d = computeDeltas(curr, prev, 1000)
    expect(d.crankRevsDiff).toBeNull()
    expect(d.crankTimeDiff).toBeNull()
  })
})
