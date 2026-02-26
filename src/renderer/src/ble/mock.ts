// src/renderer/src/ble/mock.ts

import type { BleAdapter, DeviceFoundHandler, DataHandler, DisconnectHandler } from './adapter'

const MOCK_DEVICE_ID = 'mock-0'
const INTERVAL_MS = 1000
const WHEEL_CIRCUMFERENCE_M = 2.1

let wheelRevs = 0.0
let wheelTimeTicks = 0.0
let crankRevs = 0.0
let crankTimeTicks = 0.0

function buildPacket(): Uint8Array {
  const dt = INTERVAL_MS / 1000
  const phase = ((Date.now() % 60_000) / 60_000) * 2 * Math.PI

  const speedKmh = 17.5 + 2.5 * Math.sin(phase)   // 15–20 km/h
  const cadenceRpm = 70 + 5 * Math.cos(phase)      // 65–75 RPM

  wheelRevs += (speedKmh / 3.6 / WHEEL_CIRCUMFERENCE_M) * dt
  wheelTimeTicks += dt * 1024
  crankRevs += (cadenceRpm / 60) * dt
  crankTimeTicks += dt * 1024

  const buf = new Uint8Array(11)
  const view = new DataView(buf.buffer)
  view.setUint8(0, 0x03)
  view.setUint32(1, Math.round(wheelRevs) >>> 0, true)
  view.setUint16(5, Math.round(wheelTimeTicks) & 0xffff, true)
  view.setUint16(7, Math.round(crankRevs) & 0xffff, true)
  view.setUint16(9, Math.round(crankTimeTicks) & 0xffff, true)

  console.log(`[MockAdapter] packet: speed=${speedKmh.toFixed(1)}km/h cadence=${cadenceRpm.toFixed(1)}rpm wheelRevs=${Math.round(wheelRevs)} crankRevs=${Math.round(crankRevs)}`)
  return buf
}

export class MockAdapter implements BleAdapter {
  private timer: ReturnType<typeof setInterval> | null = null

  startScan(onFound: DeviceFoundHandler): void {
    console.log('[MockAdapter] startScan → emitting DeskBike-MOCK immediately')
    onFound({ id: MOCK_DEVICE_ID, name: 'DeskBike-MOCK' })
  }

  async selectDevice(
    deviceId: string,
    onData: DataHandler,
    _onDisconnect: DisconnectHandler
  ): Promise<void> {
    console.log(`[MockAdapter] selectDevice: ${deviceId} — starting packet interval (${INTERVAL_MS}ms)`)
    this.timer = setInterval(() => onData(buildPacket()), INTERVAL_MS)
  }

  async disconnect(): Promise<void> {
    console.log('[MockAdapter] disconnect')
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
