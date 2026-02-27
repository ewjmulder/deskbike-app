// tests/ble/ipc-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IpcBleAdapter } from '../../src/renderer/src/ble/ipc-adapter'

const mockDeskbike = {
  isMock: false,
  scanStart: vi.fn().mockResolvedValue(undefined),
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  saveMeasurement: vi.fn().mockResolvedValue(undefined),
  onDeviceFound: vi.fn(),
  onData: vi.fn(),
  onDisconnected: vi.fn(),
  onBleError: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  // @ts-expect-error — mock global
  global.window = { deskbike: mockDeskbike }
})

describe('IpcBleAdapter', () => {
  it('startScan registers onDeviceFound and calls scanStart', () => {
    const adapter = new IpcBleAdapter()
    const onFound = vi.fn()
    adapter.startScan(onFound)
    expect(mockDeskbike.onDeviceFound).toHaveBeenCalledOnce()
    expect(mockDeskbike.scanStart).toHaveBeenCalledOnce()
  })

  it('selectDevice registers onData, onDisconnected and calls connect', async () => {
    const adapter = new IpcBleAdapter()
    const onData = vi.fn()
    const onDisconnect = vi.fn()
    await adapter.selectDevice('AA:BB', onData, onDisconnect)
    expect(mockDeskbike.onData).toHaveBeenCalledOnce()
    expect(mockDeskbike.onDisconnected).toHaveBeenCalledOnce()
    expect(mockDeskbike.connect).toHaveBeenCalledWith('AA:BB')
  })

  it('disconnect calls window.deskbike.disconnect', async () => {
    const adapter = new IpcBleAdapter()
    await adapter.disconnect()
    expect(mockDeskbike.disconnect).toHaveBeenCalledOnce()
  })

  it('onData callback receives Uint8Array converted from raw number array', async () => {
    const adapter = new IpcBleAdapter()
    const onData = vi.fn()
    await adapter.selectDevice('AA:BB', onData, vi.fn())

    // Simulate main pushing ble:data — the registered onData callback is called with number[]
    const rawCallback = mockDeskbike.onData.mock.calls[0][0]
    rawCallback([3, 10, 0, 0, 0, 200, 4, 35, 0, 100, 4])

    expect(onData).toHaveBeenCalledWith(new Uint8Array([3, 10, 0, 0, 0, 200, 4, 35, 0, 100, 4]))
  })
})
