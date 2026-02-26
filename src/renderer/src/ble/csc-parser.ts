// src/renderer/src/ble/csc-parser.ts

export interface CscRawFields {
  hasWheelData: boolean
  hasCrankData: boolean
  wheelRevs: number | null   // cumulative uint32
  wheelTime: number | null   // last event time, uint16, 1/1024s units
  crankRevs: number | null   // cumulative uint16
  crankTime: number | null   // last event time, uint16, 1/1024s units
}

export interface CscDeltas {
  timeDiffMs: number
  wheelRevsDiff: number | null
  wheelTimeDiff: number | null
  crankRevsDiff: number | null
  crankTimeDiff: number | null
}

export function parseRawCsc(data: Uint8Array): CscRawFields {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const flags = data[0]
  let idx = 1

  const hasWheelData = (flags & 0x01) !== 0
  const hasCrankData = (flags & 0x02) !== 0

  let wheelRevs: number | null = null
  let wheelTime: number | null = null
  let crankRevs: number | null = null
  let crankTime: number | null = null

  if (hasWheelData) {
    wheelRevs = view.getUint32(idx, true)
    idx += 4
    wheelTime = view.getUint16(idx, true)
    idx += 2
  }

  if (hasCrankData) {
    crankRevs = view.getUint16(idx, true)
    idx += 2
    crankTime = view.getUint16(idx, true)
    idx += 2
  }

  return { hasWheelData, hasCrankData, wheelRevs, wheelTime, crankRevs, crankTime }
}

export function computeDeltas(
  current: CscRawFields,
  previous: CscRawFields,
  timeDiffMs: number
): CscDeltas {
  let wheelRevsDiff: number | null = null
  let wheelTimeDiff: number | null = null
  let crankRevsDiff: number | null = null
  let crankTimeDiff: number | null = null

  if (
    current.hasWheelData && previous.hasWheelData &&
    current.wheelRevs !== null && previous.wheelRevs !== null &&
    current.wheelTime !== null && previous.wheelTime !== null
  ) {
    wheelRevsDiff = (current.wheelRevs - previous.wheelRevs) >>> 0
    wheelTimeDiff = (current.wheelTime - previous.wheelTime) & 0xffff
  }

  if (
    current.hasCrankData && previous.hasCrankData &&
    current.crankRevs !== null && previous.crankRevs !== null &&
    current.crankTime !== null && previous.crankTime !== null
  ) {
    crankRevsDiff = (current.crankRevs - previous.crankRevs) & 0xffff
    crankTimeDiff = (current.crankTime - previous.crankTime) & 0xffff
  }

  return { timeDiffMs, wheelRevsDiff, wheelTimeDiff, crankRevsDiff, crankTimeDiff }
}
