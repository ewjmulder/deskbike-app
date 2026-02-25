import { ipcMain, BrowserWindow } from 'electron'
import { startScan, stopScan } from '../ble/scanner'
import { connect, disconnect } from '../ble/connection'
import { insertMeasurement } from '../db/queries'

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle('ble:scan', () => {
    startScan((device) => {
      win.webContents.send('ble:device-found', device)
    })
    win.webContents.send('ble:status', { state: 'scanning' })
  })

  ipcMain.handle('ble:connect', async (_e, deviceId: string) => {
    stopScan()

    await connect(
      deviceId,
      (sensorId, rawData) => {
        const timestampUtc = new Date().toISOString()
        insertMeasurement({ sensorId, timestampUtc, rawData })
        win.webContents.send('ble:data', { sensorId, timestampUtc, rawData: Array.from(rawData) })
      },
      (_sensorId) => {
        win.webContents.send('ble:status', { state: 'disconnected' })
      }
    )

    win.webContents.send('ble:status', { state: 'connected', deviceId })
  })

  ipcMain.handle('ble:disconnect', async (_e, deviceId: string) => {
    await disconnect(deviceId)
    win.webContents.send('ble:status', { state: 'disconnected' })
  })
}
