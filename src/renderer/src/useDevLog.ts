// src/renderer/src/useDevLog.ts
// Captures console.log/warn/error calls and returns them as a reactive list.

import { useEffect, useRef, useState } from 'react'

export interface LogEntry {
  level: 'log' | 'warn' | 'error'
  message: string
  ts: string
}

const MAX_ENTRIES = 200

export function useDevLog(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const originalRef = useRef<{ log: typeof console.log; warn: typeof console.warn; error: typeof console.error } | null>(null)

  useEffect(() => {
    const original = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    }
    originalRef.current = original

    function capture(level: LogEntry['level'], args: unknown[]) {
      const message = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      const ts = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
      setEntries((prev) => {
        const next = [...prev, { level, message, ts }]
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
      })
    }

    console.log = (...args) => { original.log(...args); capture('log', args) }
    console.warn = (...args) => { original.warn(...args); capture('warn', args) }
    console.error = (...args) => { original.error(...args); capture('error', args) }

    return () => {
      console.log = original.log
      console.warn = original.warn
      console.error = original.error
    }
  }, [])

  return entries
}
