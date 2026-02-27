// src/main/ble/mock-helper.ts
// Drop-in replacement for BleHelper when MOCK_BLE=1.
// Injects synthetic CSC packets at the same level as the Python helper process:
// main process → handlers.ts → IPC → renderer (IpcBleAdapter).

import type { IBleHelper, HelperEvent, HelperEventHandler } from './helper'

const MOCK_DEVICE_ID = 'mock-0'
const INTERVAL_MS = 1000
export const MOCK_WHEEL_CIRCUMFERENCE_M = 2.1

type PacketState = { wheelRevs: number; wheelTimeTicks: number; crankRevs: number; crankTimeTicks: number }

function buildPacket(state: PacketState, speedKmh: number): number[] {
  const dt = INTERVAL_MS / 1000
  const phase = ((Date.now() % 60_000) / 60_000) * 2 * Math.PI
  const cadenceRpm = 70 + 5 * Math.cos(phase)  // 65–75 RPM

  state.wheelRevs += (speedKmh / 3.6 / MOCK_WHEEL_CIRCUMFERENCE_M) * dt
  state.wheelTimeTicks += dt * 1024
  state.crankRevs += (cadenceRpm / 60) * dt
  state.crankTimeTicks += dt * 1024

  const buf = Buffer.alloc(11)
  buf.writeUInt8(0x03, 0)
  buf.writeUInt32LE((Math.round(state.wheelRevs) >>> 0) & 0xffffffff, 1)
  buf.writeUInt16LE(Math.round(state.wheelTimeTicks) & 0xffff, 5)
  buf.writeUInt16LE(Math.round(state.crankRevs) & 0xffff, 7)
  buf.writeUInt16LE(Math.round(state.crankTimeTicks) & 0xffff, 9)

  console.log(`[MockBleHelper] packet: speed=${speedKmh.toFixed(1)}km/h cadence=${cadenceRpm.toFixed(1)}rpm`)
  return Array.from(buf)
}

export class MockBleHelper implements IBleHelper {
  private onEvent: HelperEventHandler | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private packetState = { wheelRevs: 0, wheelTimeTicks: 0, crankRevs: 0, crankTimeTicks: 0 }
  private speedKmh = 17.5

  setEventHandler(handler: HelperEventHandler): void {
    this.onEvent = handler
  }

  start(): void {
    console.log('[MockBleHelper] started (MOCK_BLE=1)')
  }

  send(cmd: Record<string, unknown>): void {
    console.log(`[MockBleHelper] send: ${JSON.stringify(cmd)}`)
    switch (cmd.cmd) {
      case 'scan':
        this.emit({ type: 'device', id: MOCK_DEVICE_ID, name: 'DeskBike-MOCK' })
        break
      case 'connect':
        this.emit({ type: 'connected' })
        this.packetState = { wheelRevs: 0, wheelTimeTicks: 0, crankRevs: 0, crankTimeTicks: 0 }
        this.timer = setInterval(() => {
          this.emit({ type: 'data', raw: buildPacket(this.packetState, this.speedKmh) })
        }, INTERVAL_MS)
        break
      case 'disconnect':
        this.stopTimer()
        this.emit({ type: 'disconnected' })
        break
    }
  }

  setMockSpeedKmh(kmh: number): void {
    this.speedKmh = kmh
    console.log(`[MockBleHelper] speed set to ${kmh.toFixed(1)} km/h`)
  }

  stop(): void {
    this.stopTimer()
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private emit(event: HelperEvent): void {
    this.onEvent?.(event)
  }
}
