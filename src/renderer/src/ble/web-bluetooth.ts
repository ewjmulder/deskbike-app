// src/renderer/src/ble/web-bluetooth.ts

import type { BleAdapter, DeviceFoundHandler, DataHandler, DisconnectHandler } from './adapter'

const CSC_SERVICE = 0x1816
const CSC_MEASUREMENT_CHAR = 0x2a5b

export class WebBluetoothAdapter implements BleAdapter {
  private pendingDevice: Promise<BluetoothDevice> | null = null
  private currentDevice: BluetoothDevice | null = null

  startScan(onFound: DeviceFoundHandler): void {
    console.log('[WebBluetooth] startScan — registering onDevicesFound listener')
    // Forward devices from main (select-bluetooth-device session event)
    window.deskbike.onDevicesFound((devices) => {
      console.log(`[WebBluetooth] onDevicesFound: ${devices.length} device(s)`, devices)
      for (const d of devices) {
        onFound({ id: d.deviceId, name: d.deviceName || d.deviceId })
      }
    })

    // requestDevice() starts BLE scanning and "hangs" until selectDevice() is called.
    // Must be called synchronously inside a user gesture handler (button click).
    console.log('[WebBluetooth] calling navigator.bluetooth.requestDevice (CSC service 0x1816)')
    this.pendingDevice = navigator.bluetooth.requestDevice({
      filters: [{ services: [CSC_SERVICE] }]
    })
    this.pendingDevice
      .then((d) => console.log(`[WebBluetooth] requestDevice resolved: ${d.name ?? d.id}`))
      .catch((err) => {
        const name = err?.name ?? 'unknown'
        const message = err?.message ?? String(err)
        console.warn(`[WebBluetooth] requestDevice rejected — ${name}: ${message}`)
      })
  }

  async selectDevice(
    deviceId: string,
    onData: DataHandler,
    onDisconnect: DisconnectHandler
  ): Promise<void> {
    console.log(`[WebBluetooth] selectDevice: ${deviceId}`)
    if (!this.pendingDevice) throw new Error('Call startScan() before selectDevice()')

    // Signal main to call the stored select-bluetooth-device callback.
    // This resolves the pending requestDevice() promise.
    console.log('[WebBluetooth] → IPC ble:select-device')
    await window.deskbike.selectBleDevice(deviceId)

    console.log('[WebBluetooth] awaiting requestDevice promise...')
    const device = await this.pendingDevice
    console.log(`[WebBluetooth] got BluetoothDevice: ${device.name ?? device.id}`)
    this.pendingDevice = null
    this.currentDevice = device

    device.addEventListener('gattserverdisconnected', () => {
      console.log('[WebBluetooth] gattserverdisconnected')
      this.currentDevice = null
      onDisconnect()
    })

    console.log('[WebBluetooth] connecting to GATT server...')
    const server = await device.gatt!.connect()
    console.log('[WebBluetooth] GATT connected')

    console.log('[WebBluetooth] getting primary service 0x1816...')
    const service = await server.getPrimaryService(CSC_SERVICE)
    console.log('[WebBluetooth] got CSC service')

    console.log('[WebBluetooth] getting characteristic 0x2a5b...')
    const characteristic = await service.getCharacteristic(CSC_MEASUREMENT_CHAR)
    console.log('[WebBluetooth] got CSC measurement characteristic')

    characteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic
      const dv = target.value!
      const data = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)
      const hex = Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' ')
      console.log(`[WebBluetooth] packet: ${hex}`)
      onData(data)
    })

    console.log('[WebBluetooth] starting notifications...')
    await characteristic.startNotifications()
    console.log('[WebBluetooth] notifications active — waiting for CSC packets')
  }

  async disconnect(): Promise<void> {
    console.log('[WebBluetooth] disconnect')
    if (this.currentDevice?.gatt?.connected) {
      this.currentDevice.gatt.disconnect()
    }
    this.currentDevice = null
    this.pendingDevice = null
  }
}
