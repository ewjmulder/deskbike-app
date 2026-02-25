import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('deskbike', {
  // Renderer → Main (invoke)
  startScan: () => ipcRenderer.invoke('ble:scan'),
  connect: (deviceId: string) => ipcRenderer.invoke('ble:connect', deviceId),
  disconnect: () => ipcRenderer.invoke('ble:disconnect'),

  // Main → Renderer (event subscriptions)
  onBleStatus: (cb: (status: { state: string; deviceName?: string }) => void) => {
    ipcRenderer.on('ble:status', (_e, v) => cb(v))
  },
  onBleData: (cb: (data: { sensorId: string; timestampUtc: string; rawData: number[] }) => void) => {
    ipcRenderer.on('ble:data', (_e, v) => cb(v))
  },
  onDeviceFound: (cb: (device: { id: string; name: string; address: string }) => void) => {
    ipcRenderer.on('ble:device-found', (_e, v) => cb(v))
  }
})
