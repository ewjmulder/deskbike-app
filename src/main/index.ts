// src/main/index.ts

import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { initDb } from './db/index'
import { registerIpcHandlers, setPendingBluetoothCallback } from './ipc/handlers'

// Required for navigator.bluetooth to be defined in the renderer
app.commandLine.appendSwitch('enable-experimental-web-platform-features')

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

  // Grant bluetooth permission so requestDevice() is not blocked by permissions policy
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'bluetooth') {
      console.log('[Main] bluetooth permission granted')
      callback(true)
    } else {
      callback(false)
    }
  })

  // Intercept Electron's Bluetooth device picker so our renderer UI acts as the picker
  session.defaultSession.on('select-bluetooth-device', (event, deviceList, callback) => {
    console.log(`[Main] select-bluetooth-device: ${deviceList.length} device(s)`, deviceList.map((d) => d.deviceName || d.deviceId))
    event.preventDefault()
    setPendingBluetoothCallback(callback)
    win.webContents.send('ble:devices-found', deviceList)
  })

  // Forward renderer console output to the main process terminal
  const levels = ['V', 'I', 'W', 'E']
  win.webContents.on('console-message', (_e, level, message) => {
    const prefix = `[renderer:${levels[level] ?? '?'}]`
    if (level >= 2) {
      console.error(prefix, message)
    } else {
      console.log(prefix, message)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  console.log(`[Main] app ready — MOCK_BLE=${process.env['MOCK_BLE'] ?? 'unset'}`)
  initDb()
  registerIpcHandlers()
  createWindow()
  console.log('[Main] window created')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
