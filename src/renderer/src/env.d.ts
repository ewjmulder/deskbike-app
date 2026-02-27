// src/renderer/src/env.d.ts

interface BtDevice {
  id: string
  name: string
}

interface MeasurementData {
  sensorId: string
  timestampUtc: string
  rawData: number[]
  hasWheelData: boolean
  hasCrankData: boolean
  wheelRevs: number | null
  wheelTime: number | null
  crankRevs: number | null
  crankTime: number | null
}

interface SessionRecord {
  id: string
  sensorId: string
  startedAt: string
  endedAt: string | null
  durationS: number | null
  distanceM: number | null
  avgSpeedKmh: number | null
  maxSpeedKmh: number | null
  avgCadenceRpm: number | null
  maxCadenceRpm: number | null
}

interface Window {
  deskbike: {
    isMock: boolean
    scanStart: () => Promise<void>
    connect: (deviceId: string) => Promise<void>
    disconnect: () => Promise<void>
    saveMeasurement: (data: MeasurementData) => Promise<void>
    onDeviceFound: (cb: (device: BtDevice) => void) => void
    onData: (cb: (raw: number[]) => void) => void
    onDisconnected: (cb: () => void) => void
    onBleError: (cb: (message: string) => void) => void
    mockSetSpeed: (kmh: number) => Promise<void>
    sessionStart: (sensorId: string, startedAt: string) => Promise<{ sessionId: string }>
    sessionEnd: (sessionId: string, endedAt: string) => Promise<void>
    getSessionHistory: (sensorId: string) => Promise<SessionRecord[]>
    getSensors: () => Promise<string[]>
  }
}
