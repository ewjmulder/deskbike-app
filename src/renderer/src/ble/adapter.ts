// src/renderer/src/ble/adapter.ts

import { IpcBleAdapter } from './ipc-adapter'

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
  /** Select a device (ends scan) and connect to it. Resolves when connected. */
  selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void>
  disconnect(): Promise<void>
}

export function createBleAdapter(): BleAdapter {
  return new IpcBleAdapter()
}
