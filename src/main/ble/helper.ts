// src/main/ble/helper.ts

import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export type HelperEvent =
  | { type: 'device'; id: string; name: string }
  | { type: 'connected' }
  | { type: 'data'; raw: number[] }
  | { type: 'disconnected' }
  | { type: 'error'; message: string }

export type HelperEventHandler = (event: HelperEvent) => void

/** Parse one stdout line from the helper process. Returns null if invalid. */
export function parseHelperLine(line: string): HelperEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as HelperEvent
  } catch {
    return null
  }
}

export class BleHelper {
  private process: ChildProcess | null = null
  private onEvent: HelperEventHandler | null = null

  setEventHandler(handler: HelperEventHandler): void {
    this.onEvent = handler
  }

  start(): void {
    let helperBin: string
    let helperArgs: string[]

    if (app.isPackaged) {
      const ext = process.platform === 'win32' ? '.exe' : ''
      helperBin = join(process.resourcesPath, 'helpers', `ble_helper${ext}`)
      helperArgs = []
    } else {
      const helperPath = join(app.getAppPath(), 'src', 'helpers', 'ble_helper.py')
      const venvPython = join(app.getAppPath(), '.venv', 'bin', 'python3')
      helperBin = existsSync(venvPython) ? venvPython : 'python3'
      helperArgs = [helperPath]
    }

    console.log(`[BleHelper] spawning ${helperBin} ${helperArgs.join(' ')}`)
    this.process = spawn(helperBin, helperArgs)

    const rl = createInterface({ input: this.process.stdout! })
    rl.on('line', (line) => {
      console.log(`[BleHelper] stdout: ${line}`)
      const event = parseHelperLine(line)
      if (event) this.onEvent?.(event)
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      console.error('[BleHelper] stderr:', data.toString())
    })

    this.process.on('error', (err: NodeJS.ErrnoException) => {
      const hint = err.code === 'ENOENT'
        ? app.isPackaged
          ? ' (ble_helper binary missing — was the app built with pnpm dist?)'
          : ' (is python3 installed and on PATH?)'
        : ''
      console.error(`[BleHelper] spawn error:${hint}`, err)
      this.onEvent?.({ type: 'error', message: `Failed to start BLE helper: ${err.message}${hint}` })
      this.process = null
    })

    this.process.on('exit', (code) => {
      console.log(`[BleHelper] process exited with code ${code}`)
      this.onEvent?.({ type: 'error', message: `BLE helper process exited (code ${code})` })
      this.process = null
    })
  }

  send(cmd: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      console.warn('[BleHelper] send: no process stdin')
      return
    }
    const line = JSON.stringify(cmd) + '\n'
    console.log(`[BleHelper] stdin: ${line.trim()}`)
    try {
      this.process.stdin.write(line)
    } catch (err) {
      console.error('[BleHelper] failed to write to stdin:', err)
    }
  }

  stop(): void {
    this.process?.kill()
    this.process = null
  }
}
