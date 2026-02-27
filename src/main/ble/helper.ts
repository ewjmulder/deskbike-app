// src/main/ble/helper.ts

import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
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
    const helperPath = app.isPackaged
      ? join(process.resourcesPath, 'helpers', 'ble_helper.py')
      : join(app.getAppPath(), 'src', 'helpers', 'ble_helper.py')

    console.log(`[BleHelper] spawning python3 ${helperPath}`)
    this.process = spawn('python3', [helperPath])

    const rl = createInterface({ input: this.process.stdout! })
    rl.on('line', (line) => {
      console.log(`[BleHelper] stdout: ${line}`)
      const event = parseHelperLine(line)
      if (event) this.onEvent?.(event)
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      console.error('[BleHelper] stderr:', data.toString())
    })

    this.process.on('exit', (code) => {
      console.log(`[BleHelper] process exited with code ${code}`)
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
    this.process.stdin.write(line)
  }

  stop(): void {
    this.process?.kill()
    this.process = null
  }
}
