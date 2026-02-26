// src/renderer/src/ble/adapter.ts

export interface DeviceInfo {
  id: string
  name: string
}

export type DataHandler = (data: Uint8Array) => void
export type DisconnectHandler = () => void
export type DeviceFoundHandler = (device: DeviceInfo) => void

export interface BleAdapter {
  /** Start scanning. Calls onFound for each discovered device. */
  startScan(onFound: DeviceFoundHandler): void
  /** Select a device (ends scan) and connect to it. */
  selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void>
  disconnect(): Promise<void>
}

export function createBleAdapter(): BleAdapter {
  if (window.deskbike.isMock) {
    // Dynamic import to keep mock out of production bundle
    return new (require('./mock').MockAdapter)()
  }
  return new (require('./web-bluetooth').WebBluetoothAdapter)()
}
