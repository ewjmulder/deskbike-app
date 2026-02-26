// src/renderer/src/env.d.ts

interface BtDevice {
  deviceId: string
  deviceName: string
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
    onDevicesFound: (cb: (devices: BtDevice[]) => void) => void
    selectBleDevice: (deviceId: string) => Promise<void>
    saveMeasurement: (data: MeasurementData) => Promise<void>
  }
}
