// src/preload/index.ts

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('deskbike', {
  // True when MOCK_BLE=1 — renderer uses MockAdapter instead of WebBluetoothAdapter
  isMock: process.env['MOCK_BLE'] === '1',

  // Main → Renderer: Electron found BLE devices (fires as scan progresses)
  onDevicesFound: (cb: (devices: Array<{ deviceId: string; deviceName: string }>) => void) => {
    ipcRenderer.on('ble:devices-found', (_e, v) => cb(v))
  },

  // Renderer → Main: tell Electron which device the user selected
  selectBleDevice: (deviceId: string) => ipcRenderer.invoke('ble:select-device', deviceId),

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
  }) => ipcRenderer.invoke('ble:save-measurement', data),
})
