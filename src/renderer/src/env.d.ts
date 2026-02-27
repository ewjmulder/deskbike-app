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
  }
}
