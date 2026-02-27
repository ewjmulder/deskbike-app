// src/main/ipc/handlers.ts

import { ipcMain } from 'electron'
import {
  insertMeasurement, InsertMeasurementInput,
  startSession, endSession, getSessionHistory,
  getSetting, setSetting,
  getSensorsWithSessions,
} from '../db/queries'
import type { IBleHelper } from '../ble/helper'
import type { WindowManager } from '../windows'

export function registerIpcHandlers(windowManager: WindowManager, helper: IBleHelper): void {
  console.log('[IPC] registerIpcHandlers')

  let pendingConnectResolve: (() => void) | null = null
  let pendingConnectReject: ((err: Error) => void) | null = null

  helper.setEventHandler((event) => {
    console.log(`[IPC] helper event: ${event.type}`)
    switch (event.type) {
      case 'device':
        windowManager.broadcast('ble:device-found', { id: event.id, name: event.name })
        break
      case 'connected':
        pendingConnectResolve?.()
        pendingConnectResolve = null
        pendingConnectReject = null
        break
      case 'data':
        windowManager.broadcast('ble:data', event.raw)
        break
      case 'disconnected':
        windowManager.broadcast('ble:disconnected')
        break
      case 'error':
        if (pendingConnectReject) {
          pendingConnectReject(new Error(event.message))
          pendingConnectResolve = null
          pendingConnectReject = null
        } else {
          windowManager.broadcast('ble:error', event.message)
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

  ipcMain.handle('ble:mock-set-speed', (_e, kmh: number) => {
    helper.setMockSpeedKmh?.(kmh)
  })

  ipcMain.handle('session:start', (_e, { sensorId, startedAt }: { sensorId: string; startedAt: string }) => {
    console.log(`[IPC] session:start sensorId=${sensorId}`)
    const sessionId = startSession(sensorId, startedAt)
    return { sessionId }
  })

  ipcMain.handle('session:end', (_e, { sessionId, endedAt }: { sessionId: string; endedAt: string }) => {
    console.log(`[IPC] session:end sessionId=${sessionId}`)
    endSession(sessionId, endedAt)
  })

  ipcMain.handle('session:get-history', (_e, { sensorId }: { sensorId: string }) => {
    console.log(`[IPC] session:get-history sensorId=${sensorId}`)
    return getSessionHistory(sensorId)
  })

  ipcMain.handle('session:get-sensors', () => {
    console.log('[IPC] session:get-sensors')
    return getSensorsWithSessions()
  })

  ipcMain.handle('settings:get', (_e, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    setSetting(key, value)
  })

  ipcMain.handle('widget:show', () => {
    console.log('[IPC] widget:show')
    windowManager.showWidget()
  })

  ipcMain.handle('widget:hide', () => {
    console.log('[IPC] widget:hide')
    windowManager.hideWidget()
  })

  ipcMain.handle('widget:toggle', () => {
    console.log('[IPC] widget:toggle')
    windowManager.toggleWidget()
  })
}
