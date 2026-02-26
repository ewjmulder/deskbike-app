// src/renderer/src/ble/adapter.ts

import { MockAdapter } from './mock'
import { WebBluetoothAdapter } from './web-bluetooth'

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
  const isMock = window.deskbike.isMock
  console.log(`[BLE] createBleAdapter: isMock=${isMock}`)
  if (isMock) {
    console.log('[BLE] using MockAdapter')
    return new MockAdapter()
  }
  console.log('[BLE] using WebBluetoothAdapter')
  return new WebBluetoothAdapter()
}
