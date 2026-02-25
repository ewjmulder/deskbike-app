interface Window {
  deskbike: {
    startScan: () => Promise<void>
    connect: (deviceId: string) => Promise<void>
    disconnect: () => Promise<void>
    onBleStatus: (cb: (status: { state: string; deviceName?: string }) => void) => void
    onBleData: (cb: (data: { sensorId: string; timestampUtc: string; rawData: number[] }) => void) => void
    onDeviceFound: (cb: (device: { id: string; name: string; address: string }) => void) => void
  }
}
