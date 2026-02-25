import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Dynamic import lets us import the module after vi.useFakeTimers()
describe('mock BLE module', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('startScan calls onFound immediately with a mock device', async () => {
    const { startScan, stopScan } = await import('../../src/main/ble/mock')
    const onFound = vi.fn()
    startScan(onFound)
    expect(onFound).toHaveBeenCalledOnce()
    expect(onFound).toHaveBeenCalledWith({
      id: 'mock-0',
      name: 'DeskBike-MOCK',
      address: '00:00:00:00:00:00'
    })
    stopScan()
  })

  it('connect emits a Buffer packet after 1000ms', async () => {
    const { connect, disconnect } = await import('../../src/main/ble/mock')
    const onData = vi.fn()
    const onDisconnect = vi.fn()

    await connect('mock-0', onData, onDisconnect)
    expect(onData).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(onData).toHaveBeenCalledOnce()

    const [sensorId, buf] = onData.mock.calls[0]
    expect(sensorId).toBe('mock-0')
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBe(11)
    expect(buf[0]).toBe(0x03) // flags: wheel + crank

    await disconnect('mock-0')
  })

  it('connect emits multiple packets over time', async () => {
    const { connect, disconnect } = await import('../../src/main/ble/mock')
    const onData = vi.fn()
    await connect('mock-0', onData, vi.fn())

    vi.advanceTimersByTime(3000)
    expect(onData).toHaveBeenCalledTimes(3)

    await disconnect('mock-0')
  })

  it('disconnect stops packet emission and calls onDisconnect', async () => {
    const { connect, disconnect } = await import('../../src/main/ble/mock')
    const onData = vi.fn()
    const onDisconnect = vi.fn()

    await connect('mock-0', onData, onDisconnect)
    vi.advanceTimersByTime(1000)
    expect(onData).toHaveBeenCalledTimes(1)

    await disconnect('mock-0')
    expect(onDisconnect).toHaveBeenCalledWith('mock-0')

    vi.advanceTimersByTime(2000)
    expect(onData).toHaveBeenCalledTimes(1) // no new packets after disconnect
  })
})
