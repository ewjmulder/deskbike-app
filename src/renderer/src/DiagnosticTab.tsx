// src/renderer/src/DiagnosticTab.tsx

import { useCallback, useEffect, useRef, useState } from 'react'
import { createBleAdapter } from './ble/adapter'
import type { BleAdapter, DeviceInfo } from './ble/adapter'
import { parseRawCsc, computeDeltas, type CscRawFields } from './ble/csc-parser'
import { useDevLog } from './useDevLog'
import { formatDuration, formatDistance } from './format'

export default function DiagnosticTab() {
  const logs = useDevLog()
  const logEndRef = useRef<HTMLDivElement>(null)
  const adapter = useRef<BleAdapter | null>(null)
  const [status, setStatus] = useState('idle')
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [packetCount, setPacketCount] = useState(0)
  const [lastHex, setLastHex] = useState<string | null>(null)
  const [mockSpeedKmh, setMockSpeedKmh] = useState(17.5)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([])
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null)
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null)
  const [liveSpeed, setLiveSpeed] = useState<number | null>(null)
  const [liveCadence, setLiveCadence] = useState<number | null>(null)
  const [sessionDistance, setSessionDistance] = useState(0)
  const [elapsedS, setElapsedS] = useState(0)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const sessionStartPromiseRef = useRef<Promise<string> | null>(null)
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevCscRef = useRef<CscRawFields | null>(null)
  const prevTimestampRef = useRef<number | null>(null)
  const sessionDistanceRef = useRef(0)
  const connectedDeviceIdRef = useRef<string | null>(null)
  const isUnmountingRef = useRef(false)

  const INACTIVITY_MS = 2 * 60 * 1000
  const WHEEL_CIRCUMFERENCE_M = 2.105

  const MOCK_SPEED_MIN = 0
  const MOCK_SPEED_MAX = 40

  // Auto-scroll log panel to bottom on new entries
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    console.log('[DiagnosticTab] mount — isMock:', window.deskbike.isMock)
    try {
      adapter.current = createBleAdapter()
      console.log('[DiagnosticTab] BleAdapter created:', adapter.current.constructor.name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[DiagnosticTab] createBleAdapter failed:', err)
      setErrorDetail(`createBleAdapter: ${msg}`)
      setStatus('error')
      return
    }
    window.deskbike.onBleError((message) => {
      setErrorDetail(`BLE error: ${message}`)
      setStatus('error')
    })
  }, [])

  useEffect(() => {
    if (sessionId && sessionStartedAt) {
      elapsedIntervalRef.current = setInterval(() => {
        setElapsedS(Math.floor((Date.now() - new Date(sessionStartedAt).getTime()) / 1000))
      }, 1000)
    } else {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
      elapsedIntervalRef.current = null
      setElapsedS(0)
    }
    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    }
  }, [sessionId, sessionStartedAt])

  const endActiveSession = useCallback(async (
    { resetUi = true, refreshHistory = true }: { resetUi?: boolean; refreshHistory?: boolean } = {}
  ) => {
    let activeSessionId = sessionIdRef.current
    if (activeSessionId === 'pending' && sessionStartPromiseRef.current) {
      try {
        activeSessionId = await sessionStartPromiseRef.current
      } catch {
        activeSessionId = null
      }
    }
    if (!activeSessionId || activeSessionId === 'pending') return

    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }

    const endedAt = new Date().toISOString()
    await window.deskbike.sessionEnd(activeSessionId, endedAt)
    sessionIdRef.current = null
    sessionStartPromiseRef.current = null

    if (refreshHistory && connectedDeviceIdRef.current) {
      const history = await window.deskbike.getSessionHistory(connectedDeviceIdRef.current)
      if (!isUnmountingRef.current) setSessionHistory(history)
    }

    if (!resetUi || isUnmountingRef.current) return
    setSessionId(null)
    setSessionStartedAt(null)
    setLiveSpeed(null)
    setLiveCadence(null)
    setSessionDistance(0)
    sessionDistanceRef.current = 0
    prevCscRef.current = null
    prevTimestampRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      isUnmountingRef.current = true
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }

      void (async () => {
        try {
          await endActiveSession({ resetUi: false, refreshHistory: false })
        } catch (err) {
          console.error('[DiagnosticTab] unmount session end failed:', err)
        }
        try {
          await adapter.current?.disconnect()
        } catch (err) {
          console.error('[DiagnosticTab] unmount disconnect failed:', err)
        }
      })()
    }
  }, [endActiveSession])

  function handleScan(): void {
    console.log('[DiagnosticTab] handleScan')
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
        console.log('[DiagnosticTab] device found:', device)
        setDevices((prev) => prev.find((d) => d.id === device.id) ? prev : [...prev, device])
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[DiagnosticTab] startScan failed:', err)
      setErrorDetail(`startScan: ${msg}`)
      setStatus('error')
    }
  }

  async function handleConnect(deviceId: string): Promise<void> {
    console.log(`[DiagnosticTab] handleConnect: ${deviceId}`)
    setStatus('connecting')
    setErrorDetail(null)
    try {
      await adapter.current!.selectDevice(
        deviceId,
        async (data) => {
          const parsed = parseRawCsc(data)
          const now = Date.now()
          const timestampUtc = new Date(now).toISOString()

          // Start session on first packet (sentinel prevents re-entry on concurrent packets)
          if (!sessionIdRef.current) {
            sessionIdRef.current = 'pending'
            const startPromise = window.deskbike
              .sessionStart(deviceId, timestampUtc)
              .then(({ sessionId: sid }) => {
                sessionIdRef.current = sid
                if (!isUnmountingRef.current) {
                  setSessionId(sid)
                  setSessionStartedAt(timestampUtc)
                }
                return sid
              })
              .catch((err) => {
                sessionIdRef.current = null
                throw err
              })
              .finally(() => {
                if (sessionStartPromiseRef.current === startPromise) {
                  sessionStartPromiseRef.current = null
                }
              })
            sessionStartPromiseRef.current = startPromise
            await startPromise
          }

          // Reset inactivity timer
          if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
          inactivityTimerRef.current = setTimeout(async () => {
            await endActiveSession()
          }, INACTIVITY_MS)

          // Compute live speed/cadence from deltas
          if (prevCscRef.current && prevTimestampRef.current !== null) {
            const timeDiffMs = now - prevTimestampRef.current
            const deltas = computeDeltas(parsed, prevCscRef.current, timeDiffMs)

            if (deltas.wheelRevsDiff !== null && deltas.wheelRevsDiff > 0 &&
                deltas.wheelTimeDiff !== null && deltas.wheelTimeDiff > 0) {
              const distM = deltas.wheelRevsDiff * WHEEL_CIRCUMFERENCE_M
              const timeS = deltas.wheelTimeDiff / 1024
              setLiveSpeed((distM / timeS) * 3.6)
              sessionDistanceRef.current += distM
              setSessionDistance(sessionDistanceRef.current)
            }

            if (deltas.crankRevsDiff !== null && deltas.crankRevsDiff > 0 &&
                deltas.crankTimeDiff !== null && deltas.crankTimeDiff > 0) {
              setLiveCadence((deltas.crankRevsDiff / (deltas.crankTimeDiff / 1024)) * 60)
            }
          }
          prevCscRef.current = parsed
          prevTimestampRef.current = now

          // Existing hex display and save
          const hex = Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' ')
          console.log(`[DiagnosticTab] data packet: ${hex}`)
          console.log(`[DiagnosticTab] parsed: wheel=${parsed.hasWheelData} crank=${parsed.hasCrankData} wheelRevs=${parsed.wheelRevs} crankRevs=${parsed.crankRevs}`)
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
        async () => {
          console.log('[DiagnosticTab] disconnected (remote)')
          await endActiveSession()
          setStatus('disconnected')
          setConnectedDeviceId(null)
          connectedDeviceIdRef.current = null
        }
      )
      console.log('[DiagnosticTab] connected successfully')
      setStatus('connected')
      setConnectedDeviceId(deviceId)
      connectedDeviceIdRef.current = deviceId
      const history = await window.deskbike.getSessionHistory(deviceId)
      setSessionHistory(history)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[DiagnosticTab] connect failed:', err)
      setErrorDetail(`connect: ${msg}`)
      setStatus('error')
    }
  }

  async function handleDisconnect(): Promise<void> {
    console.log('[DiagnosticTab] handleDisconnect')
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
    await endActiveSession()
    if (!adapter.current) return
    await adapter.current.disconnect()
    setStatus('disconnected')
    setConnectedDeviceId(null)
    connectedDeviceIdRef.current = null
  }

  function handleMockSpeedChange(kmh: number): void {
    setMockSpeedKmh(kmh)
    window.deskbike.mockSetSpeed(kmh)
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, display: 'flex', gap: 32, alignItems: 'flex-start' }}>
      {/* Main content */}
      <div style={{ flex: 1 }}>
        <h2>DeskBike — diagnostic view</h2>

        <p>
          Mode: <strong>{window.deskbike.isMock ? 'MOCK' : 'Bleak (Python)'}</strong>
        </p>

        <p>Status: <strong>{status}</strong></p>
        {errorDetail && (
          <p style={{ color: 'red' }}>Error: {errorDetail}</p>
        )}

        <button onClick={handleScan} disabled={status === 'scanning' || status === 'connected'}>Scan</button>
        {' '}
        <button onClick={handleDisconnect} disabled={status !== 'connected'}>Disconnect</button>

        {devices.length > 0 && status !== 'connected' && (
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

        {/* Active session bar */}
        {sessionId && (
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: '#1a2a1a',
            border: '1px solid #3a5a3a',
            borderRadius: 6,
            display: 'flex',
            gap: 24,
            alignItems: 'center',
          }}>
            <span style={{ color: '#4f4', fontWeight: 'bold', fontSize: 12 }}>● ACTIVE SESSION</span>
            <span>{formatDuration(elapsedS)}</span>
            {sessionDistance > 0 && <span>{formatDistance(sessionDistance)}</span>}
            {liveSpeed !== null && <span>{liveSpeed.toFixed(1)} km/h</span>}
            {liveCadence !== null && <span>{Math.round(liveCadence)} RPM</span>}
          </div>
        )}

        {/* Session history */}
        {sessionHistory.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 6 }}>
              Session history — {connectedDeviceId}
            </h3>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #444' }}>
                  <th style={{ textAlign: 'left', padding: '4px 10px 4px 0' }}>Date</th>
                  <th style={{ textAlign: 'right', padding: '4px 10px' }}>Duration</th>
                  {sessionHistory.some((s) => s.distanceM !== null) && (
                    <th style={{ textAlign: 'right', padding: '4px 10px' }}>Distance</th>
                  )}
                  {sessionHistory.some((s) => s.avgSpeedKmh !== null) && (
                    <th style={{ textAlign: 'right', padding: '4px 10px' }}>Avg speed</th>
                  )}
                  {sessionHistory.some((s) => s.avgCadenceRpm !== null) && (
                    <th style={{ textAlign: 'right', padding: '4px 10px' }}>Avg cadence</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sessionHistory.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '4px 10px 4px 0' }}>
                      {new Date(s.startedAt).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', padding: '4px 10px' }}>
                      {s.durationS !== null ? formatDuration(s.durationS) : '—'}
                    </td>
                    {sessionHistory.some((x) => x.distanceM !== null) && (
                      <td style={{ textAlign: 'right', padding: '4px 10px' }}>
                        {s.distanceM !== null ? formatDistance(s.distanceM) : '—'}
                      </td>
                    )}
                    {sessionHistory.some((x) => x.avgSpeedKmh !== null) && (
                      <td style={{ textAlign: 'right', padding: '4px 10px' }}>
                        {s.avgSpeedKmh !== null ? `${s.avgSpeedKmh.toFixed(1)} km/h` : '—'}
                      </td>
                    )}
                    {sessionHistory.some((x) => x.avgCadenceRpm !== null) && (
                      <td style={{ textAlign: 'right', padding: '4px 10px' }}>
                        {s.avgCadenceRpm !== null ? `${Math.round(s.avgCadenceRpm)} RPM` : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
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

      {/* Mock speed slider — only shown in MOCK mode */}
      {window.deskbike.isMock && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          paddingTop: 8,
          userSelect: 'none',
        }}>
          <span style={{ fontSize: 12 }}>{MOCK_SPEED_MAX} km/h</span>
          <input
            type="range"
            min={MOCK_SPEED_MIN}
            max={MOCK_SPEED_MAX}
            step={0.5}
            value={mockSpeedKmh}
            onChange={(e) => handleMockSpeedChange(Number(e.target.value))}
            style={{
              writingMode: 'vertical-lr',
              direction: 'rtl',
              height: 240,
              cursor: 'pointer',
            }}
          />
          <span style={{ fontSize: 12 }}>{MOCK_SPEED_MIN} km/h</span>
          <strong style={{ marginTop: 4, fontSize: 14 }}>{mockSpeedKmh.toFixed(1)} km/h</strong>
          <span style={{ fontSize: 10, color: '#888' }}>mock speed</span>
        </div>
      )}
    </div>
  )
}
