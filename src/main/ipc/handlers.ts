import { ipcMain, BrowserWindow } from 'electron'
import { insertMeasurement } from '../db/queries'
import type { DiscoveredDevice } from '../ble/scanner'
import type { DataHandler, DisconnectHandler } from '../ble/connection'

const MOCK = process.env.MOCK_BLE === '1'

const { startScan, stopScan }: {
  startScan: (onFound: (device: DiscoveredDevice) => void) => void
  stopScan: () => void
} = MOCK ? require('../ble/mock') : require('../ble/scanner')

const { connect, disconnect }: {
  connect: (deviceId: string, onData: DataHandler, onDisconnect: DisconnectHandler) => Promise<void>
  disconnect: (deviceId: string) => Promise<void>
} = MOCK ? require('../ble/mock') : require('../ble/connection')

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
