// src/renderer/src/App.tsx

import { useEffect, useRef, useState } from 'react'
import { createBleAdapter } from './ble/adapter'
import type { BleAdapter, DeviceInfo } from './ble/adapter'
import { parseRawCsc } from './ble/csc-parser'
import { useDevLog } from './useDevLog'

export default function App() {
  const logs = useDevLog()
  const logEndRef = useRef<HTMLDivElement>(null)
  const adapter = useRef<BleAdapter | null>(null)
  const [status, setStatus] = useState('idle')
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [bleAvailable, setBleAvailable] = useState<boolean | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [packetCount, setPacketCount] = useState(0)
  const [lastHex, setLastHex] = useState<string | null>(null)

  // Auto-scroll log panel to bottom on new entries
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    const isMock = window.deskbike.isMock
    const hasNavigatorBluetooth = typeof navigator.bluetooth !== 'undefined'
    console.log('[App] mount — isMock:', isMock, 'navigator.bluetooth:', hasNavigatorBluetooth)
    setBleAvailable(isMock || hasNavigatorBluetooth)

    if (hasNavigatorBluetooth) {
      navigator.bluetooth.getAvailability()
        .then((available) => console.log('[App] navigator.bluetooth.getAvailability():', available))
        .catch((err) => console.warn('[App] getAvailability failed:', err?.message ?? err))
    }

    try {
      adapter.current = createBleAdapter()
      console.log('[App] BleAdapter created:', adapter.current.constructor.name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[App] createBleAdapter failed:', err)
      setErrorDetail(`createBleAdapter: ${msg}`)
      setStatus('error')
    }
  }, [])

  function handleScan(): void {
    console.log('[App] handleScan')
    if (!adapter.current) {
      setErrorDetail('adapter not initialised')
      setStatus('error')
      return
    }
    setDevices([])
    setErrorDetail(null)
    setStatus('scanning')
    try {
      adapter.current.startScan((device) => {
        console.log('[App] device found:', device)
        setDevices((prev) => prev.find((d) => d.id === device.id) ? prev : [...prev, device])
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[App] startScan failed:', err)
      setErrorDetail(`startScan: ${msg}`)
      setStatus('error')
    }
  }

  async function handleConnect(deviceId: string): Promise<void> {
    console.log(`[App] handleConnect: ${deviceId}`)
    setStatus('connecting')
    setErrorDetail(null)
    try {
      await adapter.current!.selectDevice(
        deviceId,
        (data) => {
          const parsed = parseRawCsc(data)
          const timestampUtc = new Date().toISOString()
          const hex = Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' ')
          console.log(`[App] data packet: ${hex}`)
          console.log(`[App] parsed: wheel=${parsed.hasWheelData} crank=${parsed.hasCrankData} wheelRevs=${parsed.wheelRevs} crankRevs=${parsed.crankRevs}`)
          setPacketCount((n) => n + 1)
          setLastHex(hex)
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
        () => {
          console.log('[App] disconnected (remote)')
          setStatus('disconnected')
        }
      )
      console.log('[App] connected successfully')
      setStatus('connected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[App] connect failed:', err)
      setErrorDetail(`connect: ${msg}`)
      setStatus('error')
    }
  }

  async function handleDisconnect(): Promise<void> {
    console.log('[App] handleDisconnect')
    if (!adapter.current) return
    await adapter.current.disconnect()
    setStatus('disconnected')
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>DeskBike — diagnostic view</h2>

      <p>
        Mode: <strong>{window.deskbike.isMock ? 'MOCK' : 'Web Bluetooth'}</strong>
        {' | '}
        navigator.bluetooth: <strong>{bleAvailable === null ? '…' : bleAvailable ? 'available' : 'MISSING'}</strong>
      </p>

      <p>Status: <strong>{status}</strong></p>
      {errorDetail && (
        <p style={{ color: 'red' }}>Error: {errorDetail}</p>
      )}

      <button onClick={handleScan} disabled={status === 'scanning' || status === 'connected'}>Scan</button>
      {' '}
      <button onClick={handleDisconnect} disabled={status !== 'connected'}>Disconnect</button>

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

      <div style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 4 }}>Log ({logs.length})</h3>
        <div style={{
          height: 220,
          overflowY: 'auto',
          background: '#111',
          color: '#eee',
          fontSize: 11,
          padding: '6px 8px',
          borderRadius: 4,
        }}>
          {logs.map((e, i) => (
            <div key={i} style={{
              color: e.level === 'error' ? '#f77' : e.level === 'warn' ? '#fa0' : '#cfc',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {e.ts} {e.message}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  )
}
