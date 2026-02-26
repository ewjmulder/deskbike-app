// src/main/index.ts

import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { initDb } from './db/index'
import { registerIpcHandlers, setPendingBluetoothCallback } from './ipc/handlers'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Intercept Electron's Bluetooth device picker so our renderer UI acts as the picker
  session.defaultSession.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault()
    setPendingBluetoothCallback(callback)
    win.webContents.send('ble:devices-found', deviceList)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  initDb()
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
