import noble from '@stoprocent/noble'

export interface DiscoveredDevice {
  id: string
  name: string
  address: string
}

const CSC_SERVICE_UUID = '1816'

export const peripherals = new Map<string, noble.Peripheral>()

export function startScan(onFound: (device: DiscoveredDevice) => void): void {
  noble.on('discover', (peripheral: noble.Peripheral) => {
    const uuids = peripheral.advertisement.serviceUuids ?? []
    if (
      !uuids.includes(CSC_SERVICE_UUID) &&
      !uuids.includes(`0000${CSC_SERVICE_UUID}-0000-1000-8000-00805f9b34fb`)
    ) return

    peripherals.set(peripheral.id, peripheral)

    onFound({
      id: peripheral.id,
      name: peripheral.advertisement.localName ?? peripheral.id,
      address: peripheral.address
    })
  })

  noble.on('stateChange', (state: string) => {
    if (state === 'poweredOn') {
      noble.startScanning([CSC_SERVICE_UUID], false)
    }
  })

  // If noble is already powered on when startScan is called
  if ((noble as any).state === 'poweredOn') {
    noble.startScanning([CSC_SERVICE_UUID], false)
  }
}

export function stopScan(): void {
  noble.stopScanning()
}
