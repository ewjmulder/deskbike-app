// src/renderer/src/components/widget/WidgetView.tsx

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCscMetrics } from '../../ble/useCscMetrics'

function fmt2(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatDuration(s: number): string {
  return `${fmt2(Math.floor(s / 3600))}:${fmt2(Math.floor((s % 3600) / 60))}:${fmt2(Math.floor(s % 60))}`
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

export default function WidgetView(): React.JSX.Element {
  const [connected, setConnected] = useState(false)
  const { metrics, processPacket, reset: resetMetrics } = useCscMetrics()
  const [elapsedS, setElapsedS] = useState(0)

  const connectedRef = useRef(false)
  const sessionStartRef = useRef<number | null>(null)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startElapsed = useCallback(() => {
    if (elapsedIntervalRef.current) return
    sessionStartRef.current = Date.now()
    elapsedIntervalRef.current = setInterval(() => {
      if (sessionStartRef.current) {
        setElapsedS(Math.floor((Date.now() - sessionStartRef.current!) / 1000))
      }
    }, 1000)
  }, [])

  const reset = useCallback(() => {
    if (elapsedIntervalRef.current) { clearInterval(elapsedIntervalRef.current); elapsedIntervalRef.current = null }
    sessionStartRef.current = null
    connectedRef.current = false
    setConnected(false)
    resetMetrics()
    setElapsedS(0)
  }, [resetMetrics])

  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow
    const prevBodyMargin = document.body.style.margin
    const prevBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'

    window.deskbike.onData((raw) => {
      processPacket(new Uint8Array(raw))

      if (!connectedRef.current) {
        connectedRef.current = true
        setConnected(true)
        startElapsed()
      }
    })

    window.deskbike.onDisconnected(reset)
    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
      document.documentElement.style.overflow = prevHtmlOverflow
      document.body.style.margin = prevBodyMargin
      document.body.style.overflow = prevBodyOverflow
    }
  }, [startElapsed, reset, processPacket])

  return (
    <div style={{
      width: '100%', height: '100vh',
      background: 'rgba(15, 15, 20, 0.88)', color: '#fff',
      fontFamily: 'monospace', userSelect: 'none',
      WebkitAppRegion: 'drag',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      padding: '10px 14px', boxSizing: 'border-box',
      borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
    } as React.CSSProperties}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#888', letterSpacing: 1 }}>
          {connected ? '● LIVE' : '○ —'}
        </span>
        <button
          onClick={() => window.deskbike.widgetToggle()}
          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: '0 2px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Toggle dashboard"
        >⤢</button>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 42, fontWeight: 'bold', lineHeight: 1 }}>
          {metrics.speedKmh !== null ? metrics.speedKmh.toFixed(1) : '—'}
        </span>
        <span style={{ fontSize: 12, color: '#888', alignSelf: 'flex-end', paddingBottom: 6 }}>km/h</span>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#ccc', marginTop: 4 }}>
        <span>{metrics.cadenceRpm !== null ? `${Math.round(metrics.cadenceRpm)} RPM` : '— RPM'}</span>
        <span>{formatDistance(metrics.distanceM)}</span>
        <span style={{ marginLeft: 'auto', color: '#666' }}>{formatDuration(elapsedS)}</span>
      </div>
    </div>
  )
}
