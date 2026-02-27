// tests/main/ble/helper.test.ts
import { describe, it, expect } from 'vitest'
import { parseHelperLine } from '../../../src/main/ble/helper'

describe('parseHelperLine', () => {
  it('parses device event', () => {
    const event = parseHelperLine('{"type": "device", "id": "AA:BB", "name": "Bike"}')
    expect(event).toEqual({ type: 'device', id: 'AA:BB', name: 'Bike' })
  })

  it('parses data event', () => {
    const event = parseHelperLine('{"type": "data", "raw": [3, 10, 0]}')
    expect(event).toEqual({ type: 'data', raw: [3, 10, 0] })
  })

  it('returns null for invalid JSON', () => {
    expect(parseHelperLine('not json')).toBeNull()
  })

  it('returns null for empty line', () => {
    expect(parseHelperLine('')).toBeNull()
  })
})
