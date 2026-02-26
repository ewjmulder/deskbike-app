import noble from '@stoprocent/noble'

export interface DiscoveredDevice {
  id: string
  name: string
  address: string
}

const CSC_SERVICE_UUID = '1816'

export const peripherals = new Map<string, noble.Peripheral>()

noble.on('stateChange', (state: string) => {
  console.log(`[BLE] noble state: ${state}`)
  if (state === 'poweredOn') {
    console.log('[BLE] noble poweredOn — ready to scan')
  }
})

export function startScan(onFound: (device: DiscoveredDevice) => void): void {
  const nobleState = (noble as any).state as string
  console.log(`[BLE] startScan called, noble state: ${nobleState}`)

  noble.removeAllListeners('discover')
  noble.on('discover', (peripheral: noble.Peripheral) => {
    const uuids = peripheral.advertisement.serviceUuids ?? []
    const name = peripheral.advertisement.localName ?? '(no name)'
    console.log(`[BLE] discovered: ${name} | addr: ${peripheral.address} | uuids: ${JSON.stringify(uuids)}`)

    if (
      !uuids.includes(CSC_SERVICE_UUID) &&
      !uuids.includes(`0000${CSC_SERVICE_UUID}-0000-1000-8000-00805f9b34fb`)
    ) {
      console.log(`[BLE] skipping ${name} — no CSC UUID match`)
      return
    }

    peripherals.set(peripheral.id, peripheral)

    onFound({
      id: peripheral.id,
      name: peripheral.advertisement.localName ?? peripheral.id,
      address: peripheral.address
    })
  })

  if (nobleState === 'poweredOn') {
    console.log('[BLE] already poweredOn — starting scan now')
    noble.startScanning([CSC_SERVICE_UUID], false)
  } else {
    console.log('[BLE] not yet poweredOn — will start scan on stateChange')
    noble.once('stateChange', (state: string) => {
      if (state === 'poweredOn') {
        console.log('[BLE] stateChange poweredOn — starting scan')
        noble.startScanning([CSC_SERVICE_UUID], false)
      }
    })
  }
}

export function stopScan(): void {
  noble.stopScanning()
}
