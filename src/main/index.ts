// src/main/index.ts

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { initDb } from './db/index'
import { registerIpcHandlers } from './ipc/handlers'
import { BleHelper } from './ble/helper'

const helper = new BleHelper()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Forward renderer console output to terminal
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
  const isMock = process.env['MOCK_BLE'] === '1'
  console.log(`[Main] app ready — MOCK_BLE=${isMock ? '1' : 'unset'}`)
  initDb()

  const win = createWindow()

  if (!isMock) {
    helper.start()
  }

  registerIpcHandlers(win.webContents, helper)
  console.log('[Main] window created')
})

app.on('window-all-closed', () => {
  helper.stop()
  if (process.platform !== 'darwin') app.quit()
})
