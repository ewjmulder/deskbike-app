import { useEffect, useState } from 'react'

interface Device {
  id: string
  name: string
  address: string
}

interface LiveData {
  sensorId: string
  timestampUtc: string
  rawHex: string
}

export default function App() {
  const [status, setStatus] = useState('idle')
  const [devices, setDevices] = useState<Device[]>([])
  const [live, setLive] = useState<LiveData | null>(null)
  const [packetCount, setPacketCount] = useState(0)

  useEffect(() => {
    window.deskbike.onBleStatus((s) => setStatus(s.state))
    window.deskbike.onDeviceFound((d) =>
      setDevices((prev) => (prev.find((x) => x.id === d.id) ? prev : [...prev, d]))
    )
    window.deskbike.onBleData((d) => {
      setPacketCount((n) => n + 1)
      setLive({
        sensorId: d.sensorId,
        timestampUtc: d.timestampUtc,
        rawHex: d.rawData.map((b) => b.toString(16).padStart(2, '0')).join(' ')
      })
    })
  }, [])

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>DeskBike — diagnostic view</h2>
      <p>Status: <strong>{status}</strong></p>

      <button onClick={() => window.deskbike.startScan()}>Scan</button>
      {' '}
      <button onClick={() => window.deskbike.disconnect()}>Disconnect</button>

      {devices.length > 0 && (
        <div>
          <h3>Devices found:</h3>
          <ul>
            {devices.map((d) => (
              <li key={d.id}>
                {d.name} ({d.address}){' '}
                <button onClick={() => window.deskbike.connect(d.id)}>Connect</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {live && (
        <div>
          <h3>Live data (packet #{packetCount})</h3>
          <p>Sensor: {live.sensorId}</p>
          <p>Time: {live.timestampUtc}</p>
          <p>Raw bytes: <code>{live.rawHex}</code></p>
        </div>
      )}
    </div>
  )
}
