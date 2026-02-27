// tests/main/ble/mock-helper.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MockBleHelper } from '../../../src/main/ble/mock-helper'
import type { HelperEvent } from '../../../src/main/ble/helper'

describe('MockBleHelper', () => {
  let helper: MockBleHelper
  let events: HelperEvent[]

  beforeEach(() => {
    vi.useFakeTimers()
    helper = new MockBleHelper()
    events = []
    helper.setEventHandler((e) => events.push(e))
    helper.start()
  })

  afterEach(() => {
    helper.stop()
    vi.useRealTimers()
  })

  it('scan emits a device event immediately', () => {
    helper.send({ cmd: 'scan' })
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'device', id: 'mock-0', name: 'DeskBike-MOCK' })
  })

  it('connect emits connected then data packets at 1s interval', () => {
    helper.send({ cmd: 'connect', device_id: 'mock-0' })

    // connected event fires synchronously
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('connected')

    // first data packet after 1 second
    vi.advanceTimersByTime(1000)
    expect(events).toHaveLength(2)
    expect(events[1].type).toBe('data')

    // three more seconds → three more packets
    vi.advanceTimersByTime(3000)
    expect(events).toHaveLength(5)
  })

  it('data packet is a valid 11-byte CSC packet with wheel+crank flags', () => {
    helper.send({ cmd: 'connect', device_id: 'mock-0' })
    vi.advanceTimersByTime(1000)

    const dataEvent = events[1]
    expect(dataEvent.type).toBe('data')
    if (dataEvent.type !== 'data') return

    expect(Array.isArray(dataEvent.raw)).toBe(true)
    expect(dataEvent.raw).toHaveLength(11)
    expect(dataEvent.raw[0]).toBe(0x03) // flags: wheel + crank present
  })

  it('disconnect stops packets and emits disconnected', () => {
    helper.send({ cmd: 'connect', device_id: 'mock-0' })
    vi.advanceTimersByTime(1000)
    expect(events).toHaveLength(2) // connected + 1 data

    helper.send({ cmd: 'disconnect' })
    const countAfterDisconnect = events.length

    vi.advanceTimersByTime(3000)
    // no more data packets, but disconnected event was added
    const disconnectedEvent = events.find((e) => e.type === 'disconnected')
    expect(disconnectedEvent).toBeDefined()
    expect(events.length).toBe(countAfterDisconnect) // no new events after disconnect
  })
})
