import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { initDb } from './db/index'
import { registerIpcHandlers } from './ipc/handlers'

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

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  initDb()
  const win = createWindow()
  registerIpcHandlers(win)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
