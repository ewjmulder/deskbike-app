// src/main/tray.ts

import { Tray, Menu, nativeImage, app } from 'electron'
import type { WindowManager } from './windows'

export class TrayManager {
  private tray: Tray | null = null
  private windowManager: WindowManager

  constructor(windowManager: WindowManager) {
    this.windowManager = windowManager
  }

  init(): void {
    const icon = nativeImage.createEmpty()
    this.tray = new Tray(icon)
    this.tray.setToolTip('DeskBike')
    this.rebuildMenu()
    this.tray.on('click', () => {
      this.windowManager.toggleWidget()
      this.rebuildMenu()
    })
  }

  private rebuildMenu(): void {
    if (!this.tray) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Show Widget',
        type: 'checkbox',
        checked: this.windowManager.getWidget()?.isVisible() ?? false,
        click: () => {
          this.windowManager.toggleWidget()
          this.rebuildMenu()
        },
      },
      {
        label: 'Open Dashboard',
        click: () => {
          const d = this.windowManager.getDashboard()
          if (d && !d.isDestroyed()) {
            d.show()
            d.focus()
          }
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])

    this.tray.setContextMenu(menu)
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
