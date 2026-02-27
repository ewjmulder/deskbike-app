// src/renderer/src/ble/ipc-adapter.ts

import type { BleAdapter, DeviceFoundHandler, DataHandler, DisconnectHandler } from './adapter'

export class IpcBleAdapter implements BleAdapter {
  startScan(onFound: DeviceFoundHandler): void {
    console.log('[IpcBleAdapter] startScan')
    window.deskbike.onDeviceFound((device) => {
      console.log(`[IpcBleAdapter] device found: ${device.name} (${device.id})`)
      onFound({ id: device.id, name: device.name })
    })
    window.deskbike.scanStart()
  }

  async selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void> {
    console.log(`[IpcBleAdapter] selectDevice: ${deviceId}`)
    window.deskbike.onData((raw) => onData(new Uint8Array(raw)))
    window.deskbike.onDisconnected(onDisconnect)
    await window.deskbike.connect(deviceId)
    console.log('[IpcBleAdapter] connected')
  }

  async disconnect(): Promise<void> {
    console.log('[IpcBleAdapter] disconnect')
    await window.deskbike.disconnect()
  }
}
