// src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron'

const isMock = process.env['MOCK_BLE'] === '1'
console.log(`[Preload] init — isMock=${isMock}`)

contextBridge.exposeInMainWorld('deskbike', {
  isMock,

  // Renderer → Main: start BLE scan
  scanStart: () => {
    console.log('[Preload] scanStart')
    return ipcRenderer.invoke('ble:scan-start')
  },

  // Renderer → Main: connect to device (resolves when connected)
  connect: (deviceId: string) => {
    console.log(`[Preload] connect → ${deviceId}`)
    return ipcRenderer.invoke('ble:connect', deviceId)
  },

  // Renderer → Main: disconnect
  disconnect: () => {
    console.log('[Preload] disconnect')
    return ipcRenderer.invoke('ble:disconnect')
  },

  // Renderer → Main: persist measurement to DB
  saveMeasurement: (data: object) => {
    console.log('[Preload] saveMeasurement')
    return ipcRenderer.invoke('ble:save-measurement', data)
  },

  // Main → Renderer: BLE device found during scan
  onDeviceFound: (cb: (device: { id: string; name: string }) => void) => {
    ipcRenderer.on('ble:device-found', (_e, device) => {
      console.log(`[Preload] ble:device-found: ${device.name} (${device.id})`)
      cb(device)
    })
  },

  // Main → Renderer: raw CSC packet received
  onData: (cb: (raw: number[]) => void) => {
    ipcRenderer.on('ble:data', (_e, raw) => cb(raw))
  },

  // Main → Renderer: device disconnected
  onDisconnected: (cb: () => void) => {
    ipcRenderer.on('ble:disconnected', () => {
      console.log('[Preload] ble:disconnected')
      cb()
    })
  },

  // Main → Renderer: BLE error
  onBleError: (cb: (message: string) => void) => {
    ipcRenderer.on('ble:error', (_e, message) => {
      console.warn(`[Preload] ble:error: ${message}`)
      cb(message)
    })
  },
})
