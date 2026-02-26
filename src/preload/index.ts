// src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron'

const isMock = process.env['MOCK_BLE'] === '1'
console.log(`[Preload] init — isMock=${isMock}`)

contextBridge.exposeInMainWorld('deskbike', {
  // True when MOCK_BLE=1 — renderer uses MockAdapter instead of WebBluetoothAdapter
  isMock,

  // Main → Renderer: Electron found BLE devices (fires as scan progresses)
  onDevicesFound: (cb: (devices: Array<{ deviceId: string; deviceName: string }>) => void) => {
    console.log('[Preload] onDevicesFound listener registered')
    ipcRenderer.on('ble:devices-found', (_e, v) => {
      console.log(`[Preload] ble:devices-found: ${v.length} device(s)`)
      cb(v)
    })
  },

  // Renderer → Main: tell Electron which device the user selected
  selectBleDevice: (deviceId: string) => {
    console.log(`[Preload] selectBleDevice → ${deviceId}`)
    return ipcRenderer.invoke('ble:select-device', deviceId)
  },

  // Renderer → Main: persist a parsed measurement to the DB
  saveMeasurement: (data: {
    sensorId: string
    timestampUtc: string
    rawData: number[]
    hasWheelData: boolean
    hasCrankData: boolean
    wheelRevs: number | null
    wheelTime: number | null
    crankRevs: number | null
    crankTime: number | null
  }) => {
    console.log(`[Preload] saveMeasurement: ${data.sensorId} @ ${data.timestampUtc}`)
    return ipcRenderer.invoke('ble:save-measurement', data)
  },
})
