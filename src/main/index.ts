// src/main/index.ts

import { app } from 'electron'
import { initDb } from './db/index'
import { registerIpcHandlers } from './ipc/handlers'
import type { IBleHelper } from './ble/helper'
import { BleHelper } from './ble/helper'
import { MockBleHelper } from './ble/mock-helper'
import { WindowManager } from './windows'
import { TrayManager } from './tray'

let helper: IBleHelper
let tray: TrayManager

app.whenReady().then(() => {
  const isMock = process.env['MOCK_BLE'] === '1'
  console.log(`[Main] app ready — MOCK_BLE=${isMock ? '1' : 'unset'}`)
  initDb()

  helper = isMock ? new MockBleHelper() : new BleHelper()
  const windowManager = new WindowManager()

  windowManager.createDashboard()
  windowManager.createWidget()

  helper.start()
  registerIpcHandlers(windowManager, helper)

  tray = new TrayManager(windowManager)
  tray.init()

  console.log('[Main] windows + tray ready')

  app.on('activate', () => {
    if (!windowManager.getDashboard()) {
      windowManager.createDashboard()
    }
  })
}).catch((err) => {
  console.error('[Main] fatal startup error:', err)
  app.quit()
})

app.on('window-all-closed', () => {
  helper?.stop()
  tray?.destroy()
  if (process.platform !== 'darwin') app.quit()
})
