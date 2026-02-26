import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MockAdapter } from '../../src/renderer/src/ble/mock'

describe('MockAdapter', () => {
  let adapter: MockAdapter

  beforeEach(() => {
    vi.useFakeTimers()
    adapter = new MockAdapter()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('startScan calls onFound immediately with a mock device', () => {
    const onFound = vi.fn()
    adapter.startScan(onFound)
    expect(onFound).toHaveBeenCalledOnce()
    expect(onFound).toHaveBeenCalledWith({ id: 'mock-0', name: 'DeskBike-MOCK' })
  })

  it('selectDevice emits a Uint8Array packet after 1000ms', async () => {
    const onData = vi.fn()

    await adapter.selectDevice('mock-0', onData, vi.fn())
    expect(onData).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(onData).toHaveBeenCalledOnce()

    const buf = onData.mock.calls[0][0]
    expect(buf).toBeInstanceOf(Uint8Array)
    expect(buf.length).toBe(11)
    expect(buf[0]).toBe(0x03) // flags: wheel + crank

    await adapter.disconnect()
  })

  it('selectDevice emits multiple packets over time', async () => {
    const onData = vi.fn()
    await adapter.selectDevice('mock-0', onData, vi.fn())

    vi.advanceTimersByTime(3000)
    expect(onData).toHaveBeenCalledTimes(3)

    await adapter.disconnect()
  })

  it('disconnect stops packet emission', async () => {
    const onData = vi.fn()

    await adapter.selectDevice('mock-0', onData, vi.fn())
    vi.advanceTimersByTime(1000)
    expect(onData).toHaveBeenCalledTimes(1)

    await adapter.disconnect()

    vi.advanceTimersByTime(2000)
    expect(onData).toHaveBeenCalledTimes(1) // no new packets after disconnect
  })
})
