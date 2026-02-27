# Project Bootstrap + BLE Data Pipeline

> **Status update (2026-02-27):** Historical bootstrap plan.
> It documents the original implementation path and includes noble-era content that is no longer current.
> Current source of truth: `docs/Architecture.md` and runtime code in `src/`.


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bootstrap the Electron + TypeScript project and implement the full pipeline: CSC BLE sensor (real or emulated) → CSC parser → SQLite `measurements` table, with a minimal React UI to verify live data is flowing.

**Architecture:** `electron-vite` compiles main (Node.js) and renderer (React) processes from a single config. The main process owns BLE via `@stoprocent/noble` and SQLite via `better-sqlite3` + Drizzle ORM. A standalone emulator script uses `@abandonware/bleno` to advertise a real CSC BLE peripheral at 15–20 km/h. The CSC parser is a pure TypeScript function, unit-tested with Vitest before being wired into the pipeline.

**Tech Stack:** Electron 33, TypeScript 5, React 18, electron-vite 3, pnpm, better-sqlite3, Drizzle ORM + drizzle-kit, @stoprocent/noble, @abandonware/bleno, Vitest

**Linux BLE note:** `@stoprocent/noble` (central) and `@abandonware/bleno` (peripheral) cannot share the same Bluetooth adapter simultaneously. Run the emulator on a second machine, a USB BT dongle (`BLENO_HCI_DEVICE_ID=1`), or a phone app (e.g. nRF Connect). Alternatively, test with the real deskbike sensor.

---

## Task 1: Initialize project scaffold

**Files:**
- Create: `package.json`
- Create: `.npmrc`
- Create: `.gitignore`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `drizzle.config.ts`
- Create: `vitest.config.ts`

**Step 1: Write `package.json`**

```json
{
  "name": "deskbike-app",
  "version": "0.1.0",
  "description": "Cross-platform desk bike statistics app",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "postinstall": "electron-rebuild -f -w better-sqlite3 -w @stoprocent/noble",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "emulator": "tsx scripts/emulator.ts"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "drizzle-kit": "^0.28.0",
    "electron": "^33.4.0",
    "electron-rebuild": "^3.2.9",
    "electron-vite": "^3.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vite": "^6.1.0",
    "vitest": "^2.1.9"
  },
  "dependencies": {
    "@abandonware/bleno": "^0.6.1",
    "@stoprocent/noble": "^1.9.1",
    "better-sqlite3": "^11.8.1",
    "drizzle-orm": "^0.36.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

**Step 2: Write `.npmrc`**

```
node-linker=node-modules
```

Required for native modules (`better-sqlite3`, `noble`) to resolve correctly with pnpm.

**Step 3: Write `.gitignore`**

```
node_modules/
out/
dist/
dist-electron/
.venv/
__pycache__/
*.py[cod]
*.sqlite
*.sqlite-journal
```

**Step 4: Write `electron.vite.config.ts`**

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
```

**Step 5: Write `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

**Step 6: Write `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ESNext",
    "module": "CommonJS",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "out"
  },
  "include": [
    "electron.vite.config.ts",
    "src/main/**/*",
    "src/preload/**/*",
    "scripts/**/*",
    "tests/**/*",
    "drizzle.config.ts",
    "vitest.config.ts"
  ]
}
```

**Step 7: Write `tsconfig.web.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "skipLibCheck": true
  },
  "include": ["src/renderer/**/*"]
}
```

**Step 8: Write `drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations',
  dialect: 'sqlite'
})
```

**Step 9: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
```

**Step 10: Create directory structure**

```bash
mkdir -p src/main/ble src/main/db/migrations src/main/ipc
mkdir -p src/preload
mkdir -p src/renderer/src
mkdir -p scripts
mkdir -p tests/ble
```

**Step 11: Install dependencies**

```bash
pnpm install
```

Expected: packages installed, `node_modules/` created, `electron-rebuild` runs and recompiles native modules.

**Step 12: Commit**

```bash
git add package.json .npmrc .gitignore electron.vite.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json drizzle.config.ts vitest.config.ts
git commit -m "chore: initialize electron-vite project scaffold"
```

---

## Task 2: Database schema

**Files:**
- Create: `src/main/db/schema.ts`

**Step 1: Write the full Drizzle schema**

```typescript
// src/main/db/schema.ts
import { sqliteTable, text, integer, real, blob, index } from 'drizzle-orm/sqlite-core'

export const measurements = sqliteTable(
  'measurements',
  {
    id: text('id').primaryKey(),
    sensorId: text('sensor_id').notNull(),
    timestampUtc: text('timestamp_utc').notNull(),
    rawData: blob('raw_data', { mode: 'buffer' }).notNull(),

    // Layer 2: CSC spec decoding
    hasWheelData: integer('has_wheel_data', { mode: 'boolean' }).notNull(),
    hasCrankData: integer('has_crank_data', { mode: 'boolean' }).notNull(),
    wheelRevs: integer('wheel_revs'),
    wheelTime: integer('wheel_time'),
    crankRevs: integer('crank_revs'),
    crankTime: integer('crank_time'),

    // Layer 3: Deltas relative to previous measurement from same sensor
    timeDiffMs: integer('time_diff_ms'),
    wheelRevsDiff: integer('wheel_revs_diff'),
    wheelTimeDiff: integer('wheel_time_diff'),
    crankRevsDiff: integer('crank_revs_diff'),
    crankTimeDiff: integer('crank_time_diff')
  },
  (table) => [index('idx_measurements_sensor_ts').on(table.sensorId, table.timestampUtc)]
)

export const computedMetrics = sqliteTable('computed_metrics', {
  measurementId: text('measurement_id').primaryKey().references(() => measurements.id),
  sessionId: text('session_id').references(() => sessions.id),
  wheelCircumferenceM: real('wheel_circumference_m'),
  speedKmh: real('speed_kmh'),
  cadenceRpm: real('cadence_rpm'),
  distanceM: real('distance_m')
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  sensorId: text('sensor_id').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  distanceM: real('distance_m'),
  durationS: integer('duration_s'),
  avgSpeedKmh: real('avg_speed_kmh'),
  avgCadenceRpm: real('avg_cadence_rpm'),
  maxSpeedKmh: real('max_speed_kmh'),
  maxCadenceRpm: real('max_cadence_rpm')
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const achievements = sqliteTable('achievements', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  unlockedAt: text('unlocked_at').notNull(),
  metadata: text('metadata')
})
```

**Step 2: Generate migration**

```bash
pnpm db:generate
```

Expected: `src/main/db/migrations/0000_*.sql` created with CREATE TABLE statements for all five tables.

**Step 3: Commit**

```bash
git add src/main/db/schema.ts src/main/db/migrations/
git commit -m "feat: add drizzle schema for all database tables"
```

---

## Task 3: CSC parser — tests first

**Files:**
- Create: `tests/ble/csc-parser.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/ble/csc-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseRawCsc, computeDeltas } from '../../src/main/ble/csc-parser'

describe('parseRawCsc', () => {
  it('parses wheel-only data', () => {
    // flags=0x01 | wheel_revs=100 (uint32 LE) | wheel_time=1024 (uint16 LE)
    const data = Buffer.from([0x01, 0x64, 0x00, 0x00, 0x00, 0x00, 0x04])
    const result = parseRawCsc(data)
    expect(result.hasWheelData).toBe(true)
    expect(result.hasCrankData).toBe(false)
    expect(result.wheelRevs).toBe(100)
    expect(result.wheelTime).toBe(1024)
    expect(result.crankRevs).toBeNull()
    expect(result.crankTime).toBeNull()
  })

  it('parses crank-only data', () => {
    // flags=0x02 | crank_revs=50 (uint16 LE) | crank_time=512 (uint16 LE)
    const data = Buffer.from([0x02, 0x32, 0x00, 0x00, 0x02])
    const result = parseRawCsc(data)
    expect(result.hasWheelData).toBe(false)
    expect(result.hasCrankData).toBe(true)
    expect(result.wheelRevs).toBeNull()
    expect(result.crankRevs).toBe(50)
    expect(result.crankTime).toBe(512)
  })

  it('parses both wheel and crank data', () => {
    // flags=0x03 | wheel_revs=200 | wheel_time=2048 | crank_revs=70 | crank_time=1024
    const data = Buffer.from([
      0x03,
      0xc8, 0x00, 0x00, 0x00, // wheel_revs = 200
      0x00, 0x08,             // wheel_time = 2048
      0x46, 0x00,             // crank_revs = 70
      0x00, 0x04              // crank_time = 1024
    ])
    const result = parseRawCsc(data)
    expect(result.hasWheelData).toBe(true)
    expect(result.hasCrankData).toBe(true)
    expect(result.wheelRevs).toBe(200)
    expect(result.wheelTime).toBe(2048)
    expect(result.crankRevs).toBe(70)
    expect(result.crankTime).toBe(1024)
  })
})

describe('computeDeltas', () => {
  const noData = { hasWheelData: false, hasCrankData: false, wheelRevs: null, wheelTime: null, crankRevs: null, crankTime: null }

  it('computes wheel and crank deltas', () => {
    const prev = { hasWheelData: true, hasCrankData: true, wheelRevs: 100, wheelTime: 1000, crankRevs: 50, crankTime: 500 }
    const curr = { hasWheelData: true, hasCrankData: true, wheelRevs: 102, wheelTime: 2048, crankRevs: 51, crankTime: 1524 }
    const d = computeDeltas(curr, prev, 1000)
    expect(d.timeDiffMs).toBe(1000)
    expect(d.wheelRevsDiff).toBe(2)
    expect(d.wheelTimeDiff).toBe(1048)
    expect(d.crankRevsDiff).toBe(1)
    expect(d.crankTimeDiff).toBe(1024)
  })

  it('handles uint32 wheel revs rollover', () => {
    const prev = { ...noData, hasWheelData: true, wheelRevs: 0xffffffff, wheelTime: 100 }
    const curr = { ...noData, hasWheelData: true, wheelRevs: 1, wheelTime: 200 }
    const d = computeDeltas(curr, prev, 500)
    expect(d.wheelRevsDiff).toBe(2)
  })

  it('handles uint16 wheel time rollover', () => {
    const prev = { ...noData, hasWheelData: true, wheelRevs: 100, wheelTime: 0xffff }
    const curr = { ...noData, hasWheelData: true, wheelRevs: 102, wheelTime: 511 }
    const d = computeDeltas(curr, prev, 500)
    expect(d.wheelTimeDiff).toBe(512)
  })

  it('handles uint16 crank revs rollover', () => {
    const prev = { ...noData, hasCrankData: true, crankRevs: 0xffff, crankTime: 100 }
    const curr = { ...noData, hasCrankData: true, crankRevs: 1, crankTime: 200 }
    const d = computeDeltas(curr, prev, 500)
    expect(d.crankRevsDiff).toBe(2)
  })

  it('returns null deltas when previous has no wheel data', () => {
    const prev = { ...noData }
    const curr = { ...noData, hasWheelData: true, wheelRevs: 100, wheelTime: 1024 }
    const d = computeDeltas(curr, prev, 1000)
    expect(d.wheelRevsDiff).toBeNull()
    expect(d.wheelTimeDiff).toBeNull()
  })

  it('returns null deltas when current has no crank data', () => {
    const prev = { ...noData, hasCrankData: true, crankRevs: 50, crankTime: 500 }
    const curr = { ...noData }
    const d = computeDeltas(curr, prev, 1000)
    expect(d.crankRevsDiff).toBeNull()
    expect(d.crankTimeDiff).toBeNull()
  })
})
```

**Step 2: Run tests to confirm they fail**

```bash
pnpm test
```

Expected: FAIL — `Cannot find module '../../src/main/ble/csc-parser'`

---

## Task 4: CSC parser — implementation

**Files:**
- Create: `src/main/ble/csc-parser.ts`

**Step 1: Write the implementation**

```typescript
// src/main/ble/csc-parser.ts

export interface CscRawFields {
  hasWheelData: boolean
  hasCrankData: boolean
  wheelRevs: number | null   // cumulative uint32
  wheelTime: number | null   // last event time, uint16, 1/1024s units
  crankRevs: number | null   // cumulative uint16
  crankTime: number | null   // last event time, uint16, 1/1024s units
}

export interface CscDeltas {
  timeDiffMs: number
  wheelRevsDiff: number | null
  wheelTimeDiff: number | null
  crankRevsDiff: number | null
  crankTimeDiff: number | null
}

export function parseRawCsc(data: Buffer): CscRawFields {
  const flags = data[0]
  let idx = 1

  const hasWheelData = (flags & 0x01) !== 0
  const hasCrankData = (flags & 0x02) !== 0

  let wheelRevs: number | null = null
  let wheelTime: number | null = null
  let crankRevs: number | null = null
  let crankTime: number | null = null

  if (hasWheelData) {
    wheelRevs = data.readUInt32LE(idx)
    idx += 4
    wheelTime = data.readUInt16LE(idx)
    idx += 2
  }

  if (hasCrankData) {
    crankRevs = data.readUInt16LE(idx)
    idx += 2
    crankTime = data.readUInt16LE(idx)
    idx += 2
  }

  return { hasWheelData, hasCrankData, wheelRevs, wheelTime, crankRevs, crankTime }
}

export function computeDeltas(
  current: CscRawFields,
  previous: CscRawFields,
  timeDiffMs: number
): CscDeltas {
  let wheelRevsDiff: number | null = null
  let wheelTimeDiff: number | null = null
  let crankRevsDiff: number | null = null
  let crankTimeDiff: number | null = null

  if (
    current.hasWheelData &&
    previous.hasWheelData &&
    current.wheelRevs !== null &&
    previous.wheelRevs !== null &&
    current.wheelTime !== null &&
    previous.wheelTime !== null
  ) {
    // >>> 0 converts to Uint32, correctly handling rollover from 0xFFFFFFFF → 0
    wheelRevsDiff = (current.wheelRevs - previous.wheelRevs) >>> 0
    // & 0xFFFF masks to Uint16, correctly handling rollover from 0xFFFF → 0
    wheelTimeDiff = (current.wheelTime - previous.wheelTime) & 0xffff
  }

  if (
    current.hasCrankData &&
    previous.hasCrankData &&
    current.crankRevs !== null &&
    previous.crankRevs !== null &&
    current.crankTime !== null &&
    previous.crankTime !== null
  ) {
    crankRevsDiff = (current.crankRevs - previous.crankRevs) & 0xffff
    crankTimeDiff = (current.crankTime - previous.crankTime) & 0xffff
  }

  return { timeDiffMs, wheelRevsDiff, wheelTimeDiff, crankRevsDiff, crankTimeDiff }
}
```

**Step 2: Run tests to confirm they pass**

```bash
pnpm test
```

Expected: All 8 tests PASS.

**Step 3: Commit**

```bash
git add src/main/ble/csc-parser.ts tests/ble/csc-parser.test.ts
git commit -m "feat: add CSC parser with rollover-safe delta computation (TDD)"
```

---

## Task 5: Database service

**Files:**
- Create: `src/main/db/index.ts`
- Create: `src/main/db/queries.ts`

**Step 1: Write `src/main/db/index.ts`**

Opens the SQLite database at the Electron user data path and runs all pending migrations.

```typescript
// src/main/db/index.ts
import Database from 'better-sqlite3'
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { join } from 'path'
import { app } from 'electron'
import * as schema from './schema'

let _db: BetterSQLite3Database<typeof schema> | null = null

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.')
  return _db
}

export function initDb(): void {
  const dbPath = join(app.getPath('userData'), 'deskbike.sqlite')
  const sqlite = new Database(dbPath)

  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  _db = drizzle(sqlite, { schema })

  migrate(_db, { migrationsFolder: join(__dirname, 'migrations') })
}
```

**Step 2: Write `src/main/db/queries.ts`**

```typescript
// src/main/db/queries.ts
import { eq, desc } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { getDb } from './index'
import { measurements } from './schema'
import { parseRawCsc, computeDeltas, CscRawFields } from '../ble/csc-parser'

export interface InsertMeasurementInput {
  sensorId: string
  timestampUtc: string  // ISO 8601
  rawData: Buffer
}

export function insertMeasurement(input: InsertMeasurementInput): void {
  const db = getDb()

  const parsed = parseRawCsc(input.rawData)

  // Fetch the previous measurement for this sensor to compute deltas
  const prev = db
    .select()
    .from(measurements)
    .where(eq(measurements.sensorId, input.sensorId))
    .orderBy(desc(measurements.timestampUtc))
    .limit(1)
    .all()[0]

  const prevFields: CscRawFields | null = prev
    ? {
        hasWheelData: prev.hasWheelData,
        hasCrankData: prev.hasCrankData,
        wheelRevs: prev.wheelRevs,
        wheelTime: prev.wheelTime,
        crankRevs: prev.crankRevs,
        crankTime: prev.crankTime
      }
    : null

  const timeDiffMs = prev
    ? new Date(input.timestampUtc).getTime() - new Date(prev.timestampUtc).getTime()
    : null

  const deltas =
    prevFields && timeDiffMs !== null
      ? computeDeltas(parsed, prevFields, timeDiffMs)
      : null

  db.insert(measurements)
    .values({
      id: randomUUID(),
      sensorId: input.sensorId,
      timestampUtc: input.timestampUtc,
      rawData: input.rawData,
      hasWheelData: parsed.hasWheelData,
      hasCrankData: parsed.hasCrankData,
      wheelRevs: parsed.wheelRevs,
      wheelTime: parsed.wheelTime,
      crankRevs: parsed.crankRevs,
      crankTime: parsed.crankTime,
      timeDiffMs: deltas?.timeDiffMs ?? null,
      wheelRevsDiff: deltas?.wheelRevsDiff ?? null,
      wheelTimeDiff: deltas?.wheelTimeDiff ?? null,
      crankRevsDiff: deltas?.crankRevsDiff ?? null,
      crankTimeDiff: deltas?.crankTimeDiff ?? null
    })
    .run()
}

export function getRecentMeasurements(sensorId: string, limit = 100) {
  const db = getDb()
  return db
    .select()
    .from(measurements)
    .where(eq(measurements.sensorId, sensorId))
    .orderBy(desc(measurements.timestampUtc))
    .limit(limit)
    .all()
}
```

**Step 3: Commit**

```bash
git add src/main/db/index.ts src/main/db/queries.ts
git commit -m "feat: add database service with measurement insert and delta computation"
```

---

## Task 6: BLE service

**Files:**
- Create: `src/main/ble/scanner.ts`
- Create: `src/main/ble/connection.ts`

**Step 1: Write `src/main/ble/scanner.ts`**

```typescript
// src/main/ble/scanner.ts
import noble from '@stoprocent/noble'

export interface DiscoveredDevice {
  id: string
  name: string
  address: string
}

const CSC_SERVICE_UUID = '1816'

const discovered = new Map<string, ReturnType<typeof noble.discover extends (...args: any[]) => infer R ? never : any>>()

// Store raw peripherals for use by connection.ts
export const peripherals = new Map<string, noble.Peripheral>()

export function startScan(onFound: (device: DiscoveredDevice) => void): void {
  noble.on('discover', (peripheral: noble.Peripheral) => {
    const uuids = peripheral.advertisement.serviceUuids ?? []
    if (!uuids.includes(CSC_SERVICE_UUID) && !uuids.includes(`0000${CSC_SERVICE_UUID}-0000-1000-8000-00805f9b34fb`)) return

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

  // If already powered on
  if ((noble as any).state === 'poweredOn') {
    noble.startScanning([CSC_SERVICE_UUID], false)
  }
}

export function stopScan(): void {
  noble.stopScanning()
}
```

**Step 2: Write `src/main/ble/connection.ts`**

```typescript
// src/main/ble/connection.ts
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
```

**Step 3: Commit**

```bash
git add src/main/ble/scanner.ts src/main/ble/connection.ts
git commit -m "feat: add BLE scanner and connection service for CSC devices"
```

---

## Task 7: Electron main entry + IPC

**Files:**
- Create: `src/main/index.ts`
- Create: `src/main/ipc/handlers.ts`
- Create: `src/preload/index.ts`

**Step 1: Write `src/preload/index.ts`**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('deskbike', {
  // Renderer → Main
  startScan: () => ipcRenderer.invoke('ble:scan'),
  connect: (deviceId: string) => ipcRenderer.invoke('ble:connect', deviceId),
  disconnect: () => ipcRenderer.invoke('ble:disconnect'),

  // Main → Renderer (event subscriptions)
  onBleStatus: (cb: (status: { state: string; deviceName?: string }) => void) => {
    ipcRenderer.on('ble:status', (_e, v) => cb(v))
  },
  onBleData: (cb: (data: { wheelRevsDiff: number | null; crankRevsDiff: number | null; wheelTimeDiff: number | null; crankTimeDiff: number | null; timeDiffMs: number | null }) => void) => {
    ipcRenderer.on('ble:data', (_e, v) => cb(v))
  },
  onDeviceFound: (cb: (device: { id: string; name: string; address: string }) => void) => {
    ipcRenderer.on('ble:device-found', (_e, v) => cb(v))
  }
})
```

**Step 2: Write `src/main/ipc/handlers.ts`**

```typescript
// src/main/ipc/handlers.ts
import { ipcMain, BrowserWindow } from 'electron'
import { startScan, stopScan } from '../ble/scanner'
import { connect, disconnect } from '../ble/connection'
import { insertMeasurement } from '../db/queries'

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle('ble:scan', () => {
    startScan((device) => {
      win.webContents.send('ble:device-found', device)
    })
    win.webContents.send('ble:status', { state: 'scanning' })
  })

  ipcMain.handle('ble:connect', async (_e, deviceId: string) => {
    stopScan()

    await connect(
      deviceId,
      (sensorId, rawData) => {
        const timestampUtc = new Date().toISOString()

        // Persist to database
        insertMeasurement({ sensorId, timestampUtc, rawData })

        // Forward parsed delta fields to renderer for live display
        // (renderer doesn't need raw bytes)
        win.webContents.send('ble:data', { sensorId, timestampUtc, rawData: Array.from(rawData) })
      },
      (sensorId) => {
        win.webContents.send('ble:status', { state: 'disconnected' })
      }
    )

    win.webContents.send('ble:status', { state: 'connected', deviceId })
  })

  ipcMain.handle('ble:disconnect', async (_e, deviceId: string) => {
    await disconnect(deviceId)
    win.webContents.send('ble:status', { state: 'disconnected' })
  })
}
```

**Step 3: Write `src/main/index.ts`**

```typescript
// src/main/index.ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { initDb } from './db/index'
import { registerIpcHandlers } from './ipc/handlers'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  initDb()
  const win = createWindow()
  registerIpcHandlers(win)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

**Step 4: Commit**

```bash
git add src/main/index.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "feat: add electron main process, IPC handlers, and preload bridge"
```

---

## Task 8: Minimal renderer

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/env.d.ts`

**Step 1: Write `src/renderer/index.html`**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>DeskBike</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 2: Write `src/renderer/src/env.d.ts`**

```typescript
// src/renderer/src/env.d.ts
interface Window {
  deskbike: {
    startScan: () => Promise<void>
    connect: (deviceId: string) => Promise<void>
    disconnect: () => Promise<void>
    onBleStatus: (cb: (status: { state: string; deviceName?: string }) => void) => void
    onBleData: (cb: (data: { sensorId: string; timestampUtc: string; rawData: number[] }) => void) => void
    onDeviceFound: (cb: (device: { id: string; name: string; address: string }) => void) => void
  }
}
```

**Step 3: Write `src/renderer/src/main.tsx`**

```tsx
// src/renderer/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

**Step 4: Write `src/renderer/src/App.tsx`**

A minimal diagnostic UI — enough to verify data is flowing end-to-end.

```tsx
// src/renderer/src/App.tsx
import { useEffect, useState } from 'react'

interface Device {
  id: string
  name: string
  address: string
}

interface LiveData {
  sensorId: string
  timestampUtc: string
  rawHex: string
  count: number
}

export default function App() {
  const [status, setStatus] = useState('idle')
  const [devices, setDevices] = useState<Device[]>([])
  const [live, setLive] = useState<LiveData | null>(null)
  const [packetCount, setPacketCount] = useState(0)

  useEffect(() => {
    window.deskbike.onBleStatus((s) => setStatus(s.state))
    window.deskbike.onDeviceFound((d) =>
      setDevices((prev) => (prev.find((x) => x.id === d.id) ? prev : [...prev, d]))
    )
    window.deskbike.onBleData((d) => {
      setPacketCount((n) => n + 1)
      setLive({
        sensorId: d.sensorId,
        timestampUtc: d.timestampUtc,
        rawHex: d.rawData.map((b) => b.toString(16).padStart(2, '0')).join(' '),
        count: packetCount + 1
      })
    })
  }, [])

  return (
    <div style={{ fontFamily: 'monospace', padding: 24 }}>
      <h2>DeskBike — diagnostic view</h2>
      <p>Status: <strong>{status}</strong></p>

      <button onClick={() => window.deskbike.startScan()}>Scan</button>
      {' '}
      <button onClick={() => window.deskbike.disconnect()}>Disconnect</button>

      {devices.length > 0 && (
        <div>
          <h3>Devices found:</h3>
          <ul>
            {devices.map((d) => (
              <li key={d.id}>
                {d.name} ({d.address}){' '}
                <button onClick={() => window.deskbike.connect(d.id)}>Connect</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {live && (
        <div>
          <h3>Live data (packet #{packetCount})</h3>
          <p>Sensor: {live.sensorId}</p>
          <p>Time: {live.timestampUtc}</p>
          <p>Raw bytes: <code>{live.rawHex}</code></p>
        </div>
      )}
    </div>
  )
}
```

**Step 5: Commit**

```bash
git add src/renderer/
git commit -m "feat: add minimal renderer UI for live BLE diagnostic view"
```

---

## Task 9: CSC emulator script

**Files:**
- Create: `scripts/emulator.ts`

The emulator advertises as a real BLE CSC peripheral. It simulates a rider going 15–20 km/h with a sine wave, and 65–75 RPM cadence.

**Step 1: Write `scripts/emulator.ts`**

```typescript
// scripts/emulator.ts
// Run with: pnpm emulator
// Requires a separate Bluetooth adapter from the main app on Linux.
// Uses @abandonware/bleno to advertise a real CSC BLE peripheral.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bleno = require('@abandonware/bleno')

const DEVICE_NAME = 'DeskBike-EMU'
const CSC_SERVICE_UUID = '1816'
const CSC_MEASUREMENT_UUID = '2a5b'
const CSC_FEATURE_UUID = '2a5c'

const WHEEL_CIRCUMFERENCE_M = 2.1
const INTERVAL_MS = 1000

// Simulation state — floating point accumulators
let wheelRevs = 0.0       // cumulative, wraps to uint32 on send
let wheelTimeTicks = 0.0  // 1/1024s units, wraps to uint16 on send
let crankRevs = 0.0       // cumulative, wraps to uint16 on send
let crankTimeTicks = 0.0  // 1/1024s units, wraps to uint16 on send

function buildPacket(): Buffer {
  const dt = INTERVAL_MS / 1000
  const phase = (Date.now() % 60_000) / 60_000 * 2 * Math.PI

  const speedKmh = 17.5 + 2.5 * Math.sin(phase)    // 15–20 km/h
  const cadenceRpm = 70 + 5 * Math.cos(phase)       // 65–75 RPM

  wheelRevs += (speedKmh / 3.6 / WHEEL_CIRCUMFERENCE_M) * dt
  wheelTimeTicks += dt * 1024

  crankRevs += (cadenceRpm / 60) * dt
  crankTimeTicks += dt * 1024

  const buf = Buffer.alloc(11)
  buf.writeUInt8(0x03, 0)                                   // flags: both wheel+crank
  buf.writeUInt32LE(Math.round(wheelRevs) >>> 0, 1)         // uint32
  buf.writeUInt16LE(Math.round(wheelTimeTicks) & 0xffff, 5) // uint16, rolls over naturally
  buf.writeUInt16LE(Math.round(crankRevs) & 0xffff, 7)      // uint16
  buf.writeUInt16LE(Math.round(crankTimeTicks) & 0xffff, 9) // uint16

  return buf
}

// CSC Measurement Characteristic — notify only
class CscMeasurementCharacteristic extends bleno.Characteristic {
  private _timer: ReturnType<typeof setInterval> | null = null
  private _notify: ((data: Buffer) => void) | null = null

  constructor() {
    super({ uuid: CSC_MEASUREMENT_UUID, properties: ['notify'] })
  }

  onSubscribe(_maxSize: number, callback: (data: Buffer) => void) {
    console.log('Client subscribed to CSC Measurement')
    this._notify = callback
    this._timer = setInterval(() => {
      const packet = buildPacket()
      const speedKmh = 17.5 + 2.5 * Math.sin((Date.now() % 60_000) / 60_000 * 2 * Math.PI)
      console.log(`  Sending: ${packet.toString('hex')}  (~${speedKmh.toFixed(1)} km/h)`)
      this._notify?.(packet)
    }, INTERVAL_MS)
  }

  onUnsubscribe() {
    console.log('Client unsubscribed')
    if (this._timer) clearInterval(this._timer)
    this._notify = null
  }
}

// CSC Feature Characteristic — read only, advertises wheel+crank support
class CscFeatureCharacteristic extends bleno.Characteristic {
  constructor() {
    super({
      uuid: CSC_FEATURE_UUID,
      properties: ['read'],
      value: Buffer.from([0x03, 0x00])  // bit0=wheel rev, bit1=crank rev
    })
  }
}

// CSC Primary Service
class CscService extends bleno.PrimaryService {
  constructor() {
    super({
      uuid: CSC_SERVICE_UUID,
      characteristics: [
        new CscMeasurementCharacteristic(),
        new CscFeatureCharacteristic()
      ]
    })
  }
}

// Main
bleno.on('stateChange', (state: string) => {
  console.log(`Bluetooth state: ${state}`)
  if (state === 'poweredOn') {
    bleno.startAdvertising(DEVICE_NAME, [CSC_SERVICE_UUID])
  } else {
    bleno.stopAdvertising()
  }
})

bleno.on('advertisingStart', (err: Error | null) => {
  if (err) {
    console.error('Failed to start advertising:', err)
    return
  }
  console.log(`Advertising as "${DEVICE_NAME}" with CSC service`)
  bleno.setServices([new CscService()])
})

bleno.on('advertisingStop', () => console.log('Advertising stopped'))

process.on('SIGINT', () => {
  console.log('\nStopping emulator...')
  bleno.stopAdvertising()
  process.exit(0)
})
```

**Step 2: Test the emulator in isolation**

On a machine/adapter separate from the one running the app:

```bash
pnpm emulator
```

Expected output:
```
Bluetooth state: poweredOn
Advertising as "DeskBike-EMU" with CSC service
```

Then click **Scan** in the app, find `DeskBike-EMU`, click **Connect**. Expected:
```
Client subscribed to CSC Measurement
  Sending: 03 xx xx xx xx xx xx xx xx xx xx  (~17.x km/h)
  Sending: ...
```

And in the app UI: packet count increments every second, raw hex bytes shown.

**Step 3: Commit**

```bash
git add scripts/emulator.ts
git commit -m "feat: add BLE CSC emulator simulating 15-20 km/h at 65-75 RPM"
```

---

## Task 10: Cleanup

**Files:**
- Delete: `deskbike.py`
- Delete: `requirements.txt`

**Step 1: Remove old Python files**

```bash
git rm deskbike.py requirements.txt
```

**Step 2: Commit**

```bash
git commit -m "chore: remove Python proof-of-concept (superseded by Electron app)"
```

---

## Verification

After all tasks are complete, run the full test suite and a dev build:

```bash
pnpm test        # All tests green
pnpm dev         # Electron app opens, UI shows "idle"
```

Then in a separate terminal (separate BT adapter on Linux):

```bash
pnpm emulator    # Starts advertising DeskBike-EMU
```

In the app: Scan → find DeskBike-EMU → Connect → verify packet counter increments and raw bytes appear. Check the SQLite database:

```bash
sqlite3 ~/.config/deskbike-app/deskbike.sqlite "SELECT id, sensor_id, timestamp_utc, has_wheel_data, wheel_revs, wheel_time, wheel_revs_diff, wheel_time_diff FROM measurements LIMIT 5;"
```

Expected: rows with correct `wheel_revs_diff` values (~2–3 per second at ~17 km/h) and `wheel_time_diff` ~1024 per second.
