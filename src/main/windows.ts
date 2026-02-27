// src/main/windows.ts

import { BrowserWindow } from 'electron'
import { join } from 'path'
import { getSetting, setSetting } from './db/queries'

type WindowBounds = { x: number; y: number; width: number; height: number }

export class WindowManager {
  private dashboard: BrowserWindow | null = null
  private widget: BrowserWindow | null = null

  private loadUrl(win: BrowserWindow, query?: string): void {
    const base = process.env['ELECTRON_RENDERER_URL']
    if (base) {
      win.loadURL(query ? `${base}?${query}` : base)
    } else {
      win.loadFile(
        join(__dirname, '../renderer/index.html'),
        query ? { query: Object.fromEntries(new URLSearchParams(query)) } : undefined
      )
    }
  }

  createDashboard(): BrowserWindow {
    const win = new BrowserWindow({
      width: 900,
      height: 600,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const levels = ['V', 'I', 'W', 'E']
    win.webContents.on('console-message', (_e, level, message) => {
      const prefix = `[renderer:${levels[level] ?? '?'}]`
      if (level >= 2) console.error(prefix, message)
      else console.log(prefix, message)
    })

    this.loadUrl(win)
    this.dashboard = win
    win.on('closed', () => { this.dashboard = null })
    return win
  }

  createWidget(): BrowserWindow {
    const savedBounds = getSetting<WindowBounds>('widget.bounds')
    const alwaysOnTop = getSetting<boolean>('widget.alwaysOnTop') ?? true

    const win = new BrowserWindow({
      width: savedBounds?.width ?? 280,
      height: savedBounds?.height ?? 160,
      x: savedBounds?.x,
      y: savedBounds?.y,
      minWidth: 200,
      minHeight: 100,
      maxWidth: 420,
      maxHeight: 260,
      frame: false,
      transparent: true,
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    if (alwaysOnTop) {
      if (process.platform === 'darwin') {
        win.setAlwaysOnTop(true, 'floating')
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        win.setWindowButtonVisibility(false)
      } else {
        win.setAlwaysOnTop(true)
        if (process.platform === 'linux') {
          win.setVisibleOnAllWorkspaces(true)
        }
      }
    }

    const opacity = getSetting<number>('widget.opacity') ?? 0.9
    win.setOpacity(opacity)

    // Persist bounds on move/resize
    const saveBounds = (): void => { setSetting('widget.bounds', win.getBounds()) }
    win.on('moved', saveBounds)
    win.on('resized', saveBounds)

    const levels = ['V', 'I', 'W', 'E']
    win.webContents.on('console-message', (_e, level, message) => {
      const prefix = `[widget:${levels[level] ?? '?'}]`
      if (level >= 2) console.error(prefix, message)
      else console.log(prefix, message)
    })

    this.loadUrl(win, 'view=widget')
    this.widget = win
    win.on('closed', () => { this.widget = null })
    return win
  }

  showWidget(): void {
    if (!this.widget || this.widget.isDestroyed()) {
      this.createWidget()
    } else {
      this.widget.show()
    }
  }

  hideWidget(): void { this.widget?.hide() }

  toggleWidget(): void {
    if (!this.widget || this.widget.isDestroyed() || !this.widget.isVisible()) {
      this.showWidget()
    } else {
      this.hideWidget()
    }
  }

  getDashboard(): BrowserWindow | null { return this.dashboard }
  getWidget(): BrowserWindow | null { return this.widget }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const win of [this.dashboard, this.widget]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    }
  }

  setWidgetAlwaysOnTop(value: boolean): void {
    if (!this.widget || this.widget.isDestroyed()) return
    if (value) {
      if (process.platform === 'darwin') {
        this.widget.setAlwaysOnTop(true, 'floating')
      } else {
        this.widget.setAlwaysOnTop(true)
      }
    } else {
      this.widget.setAlwaysOnTop(false)
    }
    setSetting('widget.alwaysOnTop', value)
  }

  setWidgetOpacity(value: number): void {
    if (!this.widget || this.widget.isDestroyed()) return
    this.widget.setOpacity(Math.min(1, Math.max(0.1, value)))
    setSetting('widget.opacity', value)
  }
}
