import { peripherals } from './scanner'

const CSC_SERVICE_UUID = '1816'
const CSC_MEASUREMENT_UUID = '2a5b'

export type DataHandler = (sensorId: string, data: Buffer) => void
export type DisconnectHandler = (sensorId: string) => void

export async function connect(
  deviceId: string,
  onData: DataHandler,
  onDisconnect: DisconnectHandler
): Promise<void> {
  const peripheral = peripherals.get(deviceId)
  if (!peripheral) throw new Error(`Device ${deviceId} not found. Scan first.`)

  await peripheral.connectAsync()

  peripheral.once('disconnect', () => onDisconnect(deviceId))

  const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
    [CSC_SERVICE_UUID],
    [CSC_MEASUREMENT_UUID]
  )

  const cscChar = characteristics.find((c) => c.uuid === CSC_MEASUREMENT_UUID)
  if (!cscChar) throw new Error('CSC Measurement characteristic not found on device')

  cscChar.on('data', (data: Buffer) => onData(deviceId, data))
  await cscChar.subscribeAsync()
}

export async function disconnect(deviceId: string): Promise<void> {
  const peripheral = peripherals.get(deviceId)
  if (peripheral) {
    await peripheral.disconnectAsync()
  }
}
