// src/renderer/src/App.tsx

import { useState } from 'react'
import DiagnosticTab from './DiagnosticTab'
import HistoryTab from './HistoryTab'

type Tab = 'live' | 'history'

const TAB_LABELS: Record<Tab, string> = {
  live: 'Live',
  history: 'History',
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('live')

  return (
    <div style={{ fontFamily: 'monospace' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #333',
        padding: '0 24px',
      }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #4f4' : '2px solid transparent',
              color: activeTab === tab ? '#eee' : '#888',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 13,
              padding: '8px 16px',
              marginBottom: -1,
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'live' ? <DiagnosticTab /> : <HistoryTab />}
    </div>
  )
}
