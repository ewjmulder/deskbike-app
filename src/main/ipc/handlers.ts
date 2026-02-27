// src/main/ipc/handlers.ts

import { ipcMain, WebContents } from 'electron'
import { insertMeasurement, InsertMeasurementInput } from '../db/queries'
import { BleHelper } from '../ble/helper'

export function registerIpcHandlers(webContents: WebContents, helper: BleHelper): void {
  console.log('[IPC] registerIpcHandlers')

  let pendingConnectResolve: (() => void) | null = null
  let pendingConnectReject: ((err: Error) => void) | null = null

  // Forward helper events to renderer
  helper.setEventHandler((event) => {
    console.log(`[IPC] helper event: ${event.type}`)
    switch (event.type) {
      case 'device':
        webContents.send('ble:device-found', { id: event.id, name: event.name })
        break
      case 'connected':
        pendingConnectResolve?.()
        pendingConnectResolve = null
        pendingConnectReject = null
        break
      case 'data':
        webContents.send('ble:data', event.raw)
        break
      case 'disconnected':
        webContents.send('ble:disconnected')
        break
      case 'error':
        if (pendingConnectReject) {
          pendingConnectReject(new Error(event.message))
          pendingConnectResolve = null
          pendingConnectReject = null
        } else {
          webContents.send('ble:error', event.message)
        }
        break
    }
  })

  ipcMain.handle('ble:scan-start', () => {
    console.log('[IPC] ble:scan-start')
    helper.send({ cmd: 'scan' })
  })

  ipcMain.handle('ble:connect', (_e, deviceId: string) => {
    console.log(`[IPC] ble:connect → ${deviceId}`)
    // Reject any in-flight connect promise before starting a new one
    pendingConnectReject?.(new Error('New connect request superseded previous one'))
    pendingConnectResolve = null
    pendingConnectReject = null
    return new Promise<void>((resolve, reject) => {
      pendingConnectResolve = resolve
      pendingConnectReject = reject
      helper.send({ cmd: 'connect', device_id: deviceId })
    })
  })

  ipcMain.handle('ble:disconnect', () => {
    console.log('[IPC] ble:disconnect')
    helper.send({ cmd: 'disconnect' })
  })

  ipcMain.handle('ble:save-measurement', (_e, data: InsertMeasurementInput) => {
    console.log(`[IPC] ble:save-measurement: sensorId=${data.sensorId}`)
    insertMeasurement(data)
  })
}
