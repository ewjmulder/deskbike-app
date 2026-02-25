import { ipcMain, BrowserWindow } from 'electron'
import { insertMeasurement } from '../db/queries'
import {
  startScan as realStartScan,
  stopScan as realStopScan
} from '../ble/scanner'
import {
  connect as realConnect,
  disconnect as realDisconnect
} from '../ble/connection'
import {
  startScan as mockStartScan,
  stopScan as mockStopScan,
  connect as mockConnect,
  disconnect as mockDisconnect
} from '../ble/mock'

const MOCK = process.env.MOCK_BLE === '1'

console.log(`[BLE] mode: ${MOCK ? 'SOFTWARE MOCK (DeskBike-MOCK)' : 'real BLE scanner'}`)

const startScan = MOCK ? mockStartScan : realStartScan
const stopScan = MOCK ? mockStopScan : realStopScan
const connect = MOCK ? mockConnect : realConnect
const disconnect = MOCK ? mockDisconnect : realDisconnect

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
