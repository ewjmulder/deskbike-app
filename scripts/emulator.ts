// scripts/emulator.ts
// Run with: pnpm emulator
// On Linux: requires a separate Bluetooth adapter from the main app.
// Uses @abandonware/bleno to advertise as a real CSC BLE peripheral.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bleno = require('@abandonware/bleno')

const DEVICE_NAME = 'DeskBike-EMU'
const CSC_SERVICE_UUID = '1816'
const CSC_MEASUREMENT_UUID = '2a5b'
const CSC_FEATURE_UUID = '2a5c'

const WHEEL_CIRCUMFERENCE_M = 2.1
const INTERVAL_MS = 1000

// Floating-point accumulators — sent as truncated integers per the CSC spec
let wheelRevs = 0.0
let wheelTimeTicks = 0.0  // 1/1024s units
let crankRevs = 0.0
let crankTimeTicks = 0.0  // 1/1024s units

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
  buf.writeUInt8(0x03, 0)                                    // flags: wheel + crank
  buf.writeUInt32LE(Math.round(wheelRevs) >>> 0, 1)          // uint32 cumulative
  buf.writeUInt16LE(Math.round(wheelTimeTicks) & 0xffff, 5)  // uint16, rolls naturally
  buf.writeUInt16LE(Math.round(crankRevs) & 0xffff, 7)       // uint16 cumulative
  buf.writeUInt16LE(Math.round(crankTimeTicks) & 0xffff, 9)  // uint16, rolls naturally

  return buf
}

class CscMeasurementCharacteristic extends bleno.Characteristic {
  private _timer: ReturnType<typeof setInterval> | null = null
  private _notify: ((data: Buffer) => void) | null = null

  constructor() {
    super({ uuid: CSC_MEASUREMENT_UUID, properties: ['notify'] })
  }

  onSubscribe(_maxSize: number, callback: (data: Buffer) => void) {
    console.log('Client subscribed to CSC Measurement')
    this._notify = callback
    this._timer = setInterval(() => {
      const packet = buildPacket()
      const phase = ((Date.now() % 60_000) / 60_000) * 2 * Math.PI
      const speedKmh = 17.5 + 2.5 * Math.sin(phase)
      console.log(`  -> ${packet.toString('hex')}  (~${speedKmh.toFixed(1)} km/h)`)
      this._notify?.(packet)
    }, INTERVAL_MS)
  }

  onUnsubscribe() {
    console.log('Client unsubscribed')
    if (this._timer) clearInterval(this._timer)
    this._notify = null
  }
}

class CscFeatureCharacteristic extends bleno.Characteristic {
  constructor() {
    super({
      uuid: CSC_FEATURE_UUID,
      properties: ['read'],
      value: Buffer.from([0x03, 0x00])  // bit0=wheel rev supported, bit1=crank rev supported
    })
  }
}

class CscService extends bleno.PrimaryService {
  constructor() {
    super({
      uuid: CSC_SERVICE_UUID,
      characteristics: [
        new CscMeasurementCharacteristic(),
        new CscFeatureCharacteristic()
      ]
    })
  }
}

bleno.on('stateChange', (state: string) => {
  console.log(`Bluetooth state: ${state}`)
  if (state === 'poweredOn') {
    bleno.startAdvertising(DEVICE_NAME, [CSC_SERVICE_UUID])
  } else {
    bleno.stopAdvertising()
  }
})

bleno.on('advertisingStart', (err: Error | null) => {
  if (err) {
    console.error('Failed to start advertising:', err)
    return
  }
  console.log(`Advertising as "${DEVICE_NAME}" with CSC service (UUID ${CSC_SERVICE_UUID})`)
  bleno.setServices([new CscService()])
})

bleno.on('advertisingStop', () => console.log('Advertising stopped'))

process.on('SIGINT', () => {
  console.log('\nStopping emulator...')
  bleno.stopAdvertising()
  process.exit(0)
})
