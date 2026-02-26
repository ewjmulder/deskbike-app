// src/renderer/src/App.tsx

import { useEffect, useRef, useState } from 'react'
import { createBleAdapter } from './ble/adapter'
import type { BleAdapter, DeviceInfo } from './ble/adapter'
import { parseRawCsc } from './ble/csc-parser'

export default function App() {
  const adapter = useRef<BleAdapter | null>(null)
  const [status, setStatus] = useState('idle')
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [packetCount, setPacketCount] = useState(0)
  const [lastHex, setLastHex] = useState<string | null>(null)

  useEffect(() => {
    adapter.current = createBleAdapter()
  }, [])

  function handleScan(): void {
    setDevices([])
    setStatus('scanning')
    adapter.current!.startScan((device) => {
      setDevices((prev) => prev.find((d) => d.id === device.id) ? prev : [...prev, device])
    })
  }

  async function handleConnect(deviceId: string): Promise<void> {
    setStatus('connecting')
    try {
      await adapter.current!.selectDevice(
        deviceId,
        (data) => {
          const parsed = parseRawCsc(data)
          const timestampUtc = new Date().toISOString()
          setPacketCount((n) => n + 1)
          setLastHex(Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' '))
          window.deskbike.saveMeasurement({
            sensorId: deviceId,
            timestampUtc,
            rawData: Array.from(data),
            hasWheelData: parsed.hasWheelData,
            hasCrankData: parsed.hasCrankData,
            wheelRevs: parsed.wheelRevs,
            wheelTime: parsed.wheelTime,
            crankRevs: parsed.crankRevs,
            crankTime: parsed.crankTime,
          })
        },
        () => setStatus('disconnected')
      )
      setStatus('connected')
    } catch (err) {
      console.error('[BLE] connect failed:', err)
      setStatus('error')
    }
  }

  async function handleDisconnect(): Promise<void> {
    await adapter.current!.disconnect()
    setStatus('disconnected')
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>DeskBike — diagnostic view</h2>
      <p>Status: <strong>{status}</strong></p>

      <button onClick={handleScan}>Scan</button>
      {' '}
      <button onClick={handleDisconnect}>Disconnect</button>

      {devices.length > 0 && (
        <div>
          <h3>Devices found:</h3>
          <ul>
            {devices.map((d) => (
              <li key={d.id}>
                {d.name} ({d.id}){' '}
                <button onClick={() => handleConnect(d.id)}>Connect</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastHex && (
        <div>
          <h3>Live data (packet #{packetCount})</h3>
          <p>Raw bytes: <code>{lastHex}</code></p>
        </div>
      )}
    </div>
  )
}
