// src/renderer/src/HistoryTab.tsx

import { useEffect, useState } from 'react'
import { formatDuration, formatDistance } from './format'

function sessionLabel(s: SessionRecord): string {
  const date = new Date(s.startedAt).toLocaleString()
  const parts: string[] = [date]
  if (s.distanceM !== null) parts.push(formatDistance(s.distanceM))
  if (s.durationS !== null) parts.push(formatDuration(s.durationS))
  return parts.join(' — ')
}

export default function HistoryTab() {
  const [sensors, setSensors] = useState<string[]>([])
  const [selectedSensor, setSelectedSensor] = useState<string>('')
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null)

  useEffect(() => {
    window.deskbike.getSensors().then((list) => {
      setSensors(list)
      if (list.length > 0) setSelectedSensor(list[0])
    })
  }, [])

  useEffect(() => {
    if (!selectedSensor) return
    window.deskbike.getSessionHistory(selectedSensor).then((history) => {
      setSessions(history)
      setSelectedSession(null)
    })
  }, [selectedSensor])

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>Session history</h2>

      {sensors.length === 0 ? (
        <p style={{ color: '#888' }}>No sessions recorded yet.</p>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>SENSOR</label>
            <select
              value={selectedSensor}
              onChange={(e) => setSelectedSensor(e.target.value)}
              style={{ fontFamily: 'monospace', padding: '4px 8px', background: '#111', color: '#eee', border: '1px solid #444' }}
            >
              {sensors.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>

          {sessions.length === 0 ? (
            <p style={{ color: '#888' }}>No completed sessions for this sensor.</p>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>SESSION</label>
              <select
                value={selectedSession?.id ?? ''}
                onChange={(e) => {
                  const s = sessions.find((x) => x.id === e.target.value) ?? null
                  setSelectedSession(s)
                }}
                style={{
                  fontFamily: 'monospace',
                  padding: '4px 8px',
                  background: '#111',
                  color: '#eee',
                  border: '1px solid #444',
                  width: '100%',
                  maxWidth: 520,
                }}
              >
                <option value=''>— pick a session —</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
                ))}
              </select>
            </div>
          )}

          {selectedSession && (
            <div style={{
              marginTop: 8,
              padding: '12px 16px',
              background: '#111',
              border: '1px solid #333',
              borderRadius: 6,
              maxWidth: 400,
            }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>SESSION DETAIL</div>
              <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Started</td>
                    <td>{new Date(selectedSession.startedAt).toLocaleString()}</td>
                  </tr>
                  {selectedSession.durationS !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Duration</td>
                      <td>{formatDuration(selectedSession.durationS)}</td>
                    </tr>
                  )}
                  {selectedSession.distanceM !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Distance</td>
                      <td>{formatDistance(selectedSession.distanceM)}</td>
                    </tr>
                  )}
                  {selectedSession.avgSpeedKmh !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Avg speed</td>
                      <td>{selectedSession.avgSpeedKmh.toFixed(1)} km/h</td>
                    </tr>
                  )}
                  {selectedSession.maxSpeedKmh !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Max speed</td>
                      <td>{selectedSession.maxSpeedKmh.toFixed(1)} km/h</td>
                    </tr>
                  )}
                  {selectedSession.avgCadenceRpm !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Avg cadence</td>
                      <td>{Math.round(selectedSession.avgCadenceRpm)} RPM</td>
                    </tr>
                  )}
                  {selectedSession.maxCadenceRpm !== null && (
                    <tr>
                      <td style={{ color: '#888', padding: '3px 20px 3px 0' }}>Max cadence</td>
                      <td>{Math.round(selectedSession.maxCadenceRpm)} RPM</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
