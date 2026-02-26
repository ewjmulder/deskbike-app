// src/renderer/src/ble/web-bluetooth.ts

import type { BleAdapter, DeviceFoundHandler, DataHandler, DisconnectHandler } from './adapter'

const CSC_SERVICE = 0x1816
const CSC_MEASUREMENT_CHAR = 0x2a5b

export class WebBluetoothAdapter implements BleAdapter {
  private pendingDevice: Promise<BluetoothDevice> | null = null
  private currentDevice: BluetoothDevice | null = null

  startScan(onFound: DeviceFoundHandler): void {
    // Forward devices from main (select-bluetooth-device session event)
    window.deskbike.onDevicesFound((devices) => {
      for (const d of devices) {
        onFound({ id: d.deviceId, name: d.deviceName || d.deviceId })
      }
    })

    // requestDevice() starts BLE scanning and "hangs" until selectDevice() is called.
    // Must be called synchronously inside a user gesture handler (button click).
    this.pendingDevice = navigator.bluetooth.requestDevice({
      filters: [{ services: [CSC_SERVICE] }]
    })
  }

  async selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void> {
    if (!this.pendingDevice) throw new Error('Call startScan() before selectDevice()')

    // Signal main to call the stored select-bluetooth-device callback.
    // This resolves the pending requestDevice() promise.
    await window.deskbike.selectBleDevice(deviceId)

    const device = await this.pendingDevice
    this.pendingDevice = null
    this.currentDevice = device

    device.addEventListener('gattserverdisconnected', () => {
      this.currentDevice = null
      onDisconnect()
    })

    const server = await device.gatt!.connect()
    const service = await server.getPrimaryService(CSC_SERVICE)
    const characteristic = await service.getCharacteristic(CSC_MEASUREMENT_CHAR)

    characteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic
      const dv = target.value!
      onData(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))
    })

    await characteristic.startNotifications()
  }

  async disconnect(): Promise<void> {
    if (this.currentDevice?.gatt?.connected) {
      this.currentDevice.gatt.disconnect()
    }
    this.currentDevice = null
    this.pendingDevice = null
  }
}
