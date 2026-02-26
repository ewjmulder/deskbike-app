// src/main/ipc/handlers.ts

import { ipcMain } from 'electron'
import { insertMeasurement } from '../db/queries'

let pendingBluetoothCallback: ((deviceId: string) => void) | null = null

export function setPendingBluetoothCallback(cb: ((deviceId: string) => void) | null): void {
  pendingBluetoothCallback = cb
}

export function registerIpcHandlers(): void {
  // Called by renderer when user clicks a device in our scan UI
  ipcMain.handle('ble:select-device', (_e, deviceId: string) => {
    if (pendingBluetoothCallback) {
      pendingBluetoothCallback(deviceId)
      pendingBluetoothCallback = null
    }
  })

  // Called by renderer with parsed measurement data for DB persistence
  ipcMain.handle('ble:save-measurement', (_e, data) => {
    insertMeasurement(data)
  })
}
