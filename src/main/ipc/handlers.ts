// src/main/ipc/handlers.ts

import { ipcMain } from 'electron'
import { insertMeasurement } from '../db/queries'

let pendingBluetoothCallback: ((deviceId: string) => void) | null = null

export function setPendingBluetoothCallback(cb: ((deviceId: string) => void) | null): void {
  pendingBluetoothCallback = cb
}

export function registerIpcHandlers(): void {
  console.log('[IPC] registerIpcHandlers')

  // Called by renderer when user clicks a device in our scan UI
  ipcMain.handle('ble:select-device', (_e, deviceId: string) => {
    console.log(`[IPC] ble:select-device → ${deviceId}, pendingCallback=${pendingBluetoothCallback !== null}`)
    if (pendingBluetoothCallback) {
      pendingBluetoothCallback(deviceId)
      pendingBluetoothCallback = null
    } else {
      console.warn('[IPC] ble:select-device: no pending Bluetooth callback!')
    }
  })

  // Called by renderer with parsed measurement data for DB persistence
  ipcMain.handle('ble:save-measurement', (_e, data) => {
    console.log(`[IPC] ble:save-measurement: sensorId=${data.sensorId} wheel=${data.hasWheelData} crank=${data.hasCrankData}`)
    insertMeasurement(data)
  })
}
