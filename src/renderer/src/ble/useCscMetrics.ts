// src/renderer/src/ble/useCscMetrics.ts

import { useCallback, useRef, useState } from 'react'
import { parseRawCsc, type CscRawFields } from './csc-parser'

const WHEEL_CIRCUMFERENCE_M = 2.105
const DEFAULT_WINDOW_MS = 5000

export interface LiveMetrics {
  speedKmh: number | null
  cadenceRpm: number | null
  distanceM: number
}

export interface UseCscMetricsOptions {
  windowMs?: number
}

export interface PacketRecord {
  timestamp: number
  parsed: CscRawFields
}

export function computeSpeedFromWindow(records: PacketRecord[]): number | null {
  if (records.length < 2) return null
  const oldest = records[0]
  const newest = records[records.length - 1]
  if (!oldest.parsed.hasWheelData || !newest.parsed.hasWheelData) return null
  if (oldest.parsed.wheelRevs === null || newest.parsed.wheelRevs === null) return null
  if (oldest.parsed.wheelTime === null || newest.parsed.wheelTime === null) return null

  const revsDiff = (newest.parsed.wheelRevs - oldest.parsed.wheelRevs) >>> 0
  const timeDiff = (newest.parsed.wheelTime - oldest.parsed.wheelTime) & 0xffff
  if (revsDiff === 0 || timeDiff === 0) return null

  return (revsDiff * WHEEL_CIRCUMFERENCE_M / (timeDiff / 1024)) * 3.6
}

export function computeCadenceFromWindow(records: PacketRecord[]): number | null {
  if (records.length < 2) return null
  const oldest = records[0]
  const newest = records[records.length - 1]
  if (!oldest.parsed.hasCrankData || !newest.parsed.hasCrankData) return null
  if (oldest.parsed.crankRevs === null || newest.parsed.crankRevs === null) return null
  if (oldest.parsed.crankTime === null || newest.parsed.crankTime === null) return null

  const revsDiff = (newest.parsed.crankRevs - oldest.parsed.crankRevs) & 0xffff
  const timeDiff = (newest.parsed.crankTime - oldest.parsed.crankTime) & 0xffff
  if (revsDiff === 0 || timeDiff === 0) return null

  return (revsDiff / (timeDiff / 1024)) * 60
}

export function useCscMetrics(options?: UseCscMetricsOptions): {
  metrics: LiveMetrics
  processPacket: (data: Uint8Array) => CscRawFields
  reset: () => void
} {
  const windowMsRef = useRef(options?.windowMs ?? DEFAULT_WINDOW_MS)
  const bufferRef = useRef<PacketRecord[]>([])
  const prevParsedRef = useRef<CscRawFields | null>(null)
  const distanceRef = useRef(0)
  const [metrics, setMetrics] = useState<LiveMetrics>({
    speedKmh: null,
    cadenceRpm: null,
    distanceM: 0,
  })

  const processPacket = useCallback(
    (data: Uint8Array): CscRawFields => {
      const now = Date.now()
      const parsed = parseRawCsc(data)

      // NOTE: reset() must be called before reconnecting to a new/restarted sensor.
      // Without reset(), a wheelRevs restart will be interpreted as a massive forward
      // jump (up to ~4 billion revs) due to the uint32 unsigned rollover correction.
      // Accumulate distance per packet (delta vs previous packet only)
      if (prevParsedRef.current) {
        const prev = prevParsedRef.current
        if (
          parsed.hasWheelData &&
          prev.hasWheelData &&
          parsed.wheelRevs !== null &&
          prev.wheelRevs !== null
        ) {
          const revsDiff = (parsed.wheelRevs - prev.wheelRevs) >>> 0
          if (revsDiff > 0) distanceRef.current += revsDiff * WHEEL_CIRCUMFERENCE_M
        }
      }
      prevParsedRef.current = parsed

      // Update rolling window and evict old records
      bufferRef.current.push({ timestamp: now, parsed })
      const cutoff = now - windowMsRef.current
      let i = 0
      while (i < bufferRef.current.length && bufferRef.current[i].timestamp < cutoff) i++
      if (i > 0) bufferRef.current = bufferRef.current.slice(i)

      setMetrics({
        speedKmh: computeSpeedFromWindow(bufferRef.current),
        cadenceRpm: computeCadenceFromWindow(bufferRef.current),
        distanceM: distanceRef.current,
      })

      return parsed
    },
    []
  )

  const reset = useCallback(() => {
    bufferRef.current = []
    prevParsedRef.current = null
    distanceRef.current = 0
    setMetrics({ speedKmh: null, cadenceRpm: null, distanceM: 0 })
  }, [])

  return { metrics, processPacket, reset }
}
