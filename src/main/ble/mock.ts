import type { DiscoveredDevice } from './scanner'
import type { DataHandler, DisconnectHandler } from './connection'

const MOCK_DEVICE: DiscoveredDevice = {
  id: 'mock-0',
  name: 'DeskBike-MOCK',
  address: '00:00:00:00:00:00'
}

const INTERVAL_MS = 1000
const WHEEL_CIRCUMFERENCE_M = 2.1

let wheelRevs = 0.0
let wheelTimeTicks = 0.0
let crankRevs = 0.0
let crankTimeTicks = 0.0

function buildPacket(): Buffer {
  const dt = INTERVAL_MS / 1000
  const phase = ((Date.now() % 60_000) / 60_000) * 2 * Math.PI

  const speedKmh = 17.5 + 2.5 * Math.sin(phase)   // 15–20 km/h
  const cadenceRpm = 70 + 5 * Math.cos(phase)      // 65–75 RPM

  wheelRevs += (speedKmh / 3.6 / WHEEL_CIRCUMFERENCE_M) * dt
  wheelTimeTicks += dt * 1024

  crankRevs += (cadenceRpm / 60) * dt
  crankTimeTicks += dt * 1024

  const buf = Buffer.alloc(11)
  buf.writeUInt8(0x03, 0)
  buf.writeUInt32LE(Math.round(wheelRevs) >>> 0, 1)
  buf.writeUInt16LE(Math.round(wheelTimeTicks) & 0xffff, 5)
  buf.writeUInt16LE(Math.round(crankRevs) & 0xffff, 7)
  buf.writeUInt16LE(Math.round(crankTimeTicks) & 0xffff, 9)

  return buf
}

const timers = new Map<string, ReturnType<typeof setInterval>>()
const disconnectHandlers = new Map<string, DisconnectHandler>()

export function startScan(onFound: (device: DiscoveredDevice) => void): void {
  onFound(MOCK_DEVICE)
}

export function stopScan(): void {
  // no-op
}

export async function connect(
  deviceId: string,
  onData: DataHandler,
  onDisconnect: DisconnectHandler
): Promise<void> {
  disconnectHandlers.set(deviceId, onDisconnect)
  const timer = setInterval(() => {
    onData(deviceId, buildPacket())
  }, INTERVAL_MS)
  timers.set(deviceId, timer)
}

export async function disconnect(deviceId: string): Promise<void> {
  const timer = timers.get(deviceId)
  if (timer) {
    clearInterval(timer)
    timers.delete(deviceId)
  }
  const onDisconnect = disconnectHandlers.get(deviceId)
  if (onDisconnect) {
    disconnectHandlers.delete(deviceId)
    onDisconnect(deviceId)
  }
}
