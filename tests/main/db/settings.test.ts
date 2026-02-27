import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

let testDb: ReturnType<typeof drizzle>

vi.mock('../../../src/main/db/index', () => ({
  getDb: () => testDb,
}))

import { getSetting, setSetting } from '../../../src/main/db/queries'

beforeEach(() => {
  const sqlite = new Database(':memory:')
  sqlite.prepare('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run()
  testDb = drizzle(sqlite)
})

describe('getSetting', () => {
  it('returns null for missing key', () => {
    expect(getSetting('nonexistent')).toBeNull()
  })

  it('returns parsed value for existing key', () => {
    setSetting('widget.opacity', 0.8)
    expect(getSetting<number>('widget.opacity')).toBe(0.8)
  })
})

describe('setSetting', () => {
  it('creates a new setting', () => {
    setSetting('widget.alwaysOnTop', true)
    expect(getSetting<boolean>('widget.alwaysOnTop')).toBe(true)
  })

  it('overwrites an existing setting', () => {
    setSetting('widget.opacity', 0.5)
    setSetting('widget.opacity', 1.0)
    expect(getSetting<number>('widget.opacity')).toBe(1.0)
  })

  it('handles object values', () => {
    const bounds = { x: 100, y: 200, width: 280, height: 160 }
    setSetting('widget.bounds', bounds)
    expect(getSetting<typeof bounds>('widget.bounds')).toEqual(bounds)
  })
})
