# DeskBike App — Architecture

## Overview

A cross-platform desktop application that connects to BLE Cycling Speed & Cadence (CSC) sensors and provides real-time statistics, session tracking, and gamified challenges for desk bike users. Targets Windows, macOS, and Linux.

## Tech Stack

| Layer         | Technology                          |
| ------------- | ----------------------------------- |
| Runtime       | Electron                            |
| Language      | TypeScript                          |
| Frontend      | React + Vite                        |
| Styling       | Tailwind CSS                        |
| Charts        | Recharts (React-native, built on D3)|
| BLE           | Node.js `noble` (via `@stoprocent/noble`) |
| Database      | SQLite via `better-sqlite3`         |
| ORM           | Drizzle ORM                         |
| State         | Zustand                             |
| Build/Package | electron-builder                    |
| Auto-update   | electron-updater                    |

### Key Technology Decisions

**BLE: `@stoprocent/noble` over Web Bluetooth**
Web Bluetooth in Chromium has restrictions (requires user gesture for each connection, no background scanning). `@stoprocent/noble` runs in the Node.js main process, giving full control over scanning, connecting, and subscribing to notifications without browser sandbox limitations. It supports all three target platforms (BlueZ on Linux, CoreBluetooth on macOS, WinRT on Windows).

**Database: SQLite over IndexedDB**
Session data needs to persist reliably, support complex queries (aggregations for stats), and eventually export/sync. SQLite via the main process is more capable than renderer-side IndexedDB and makes future cloud sync straightforward (SQLite file as source of truth).

**Drizzle ORM over raw SQL**
Type-safe queries with zero runtime overhead. Schema defined in TypeScript, migrations auto-generated. Lightweight compared to alternatives like Prisma.

**Recharts over Chart.js**
Better React integration (declarative, component-based). Renders to SVG, so charts are crisp at any DPI. Built on D3 for flexibility.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Electron App                       │
│                                                      │
│  ┌──────────────┐          ┌──────────────────────┐  │
│  │ Main Process │◄── IPC ──►│  Renderer Process    │  │
│  │  (Node.js)   │          │  (Chromium)           │  │
│  │              │          │                        │  │
│  │  ┌────────┐  │          │  ┌──────────────────┐ │  │
│  │  │  BLE   │  │          │  │   React App       │ │  │
│  │  │ noble  │  │          │  │                    │ │  │
│  │  └────┬───┘  │          │  │  ┌─────────────┐  │ │  │
│  │       │      │          │  │  │ Widget View │  │ │  │
│  │  ┌────┴───┐  │          │  │  │ (compact)   │  │ │  │
│  │  │ SQLite │  │          │  │  └─────────────┘  │ │  │
│  │  │drizzle │  │          │  │                    │ │  │
│  │  └────────┘  │          │  │  ┌─────────────┐  │ │  │
│  │              │          │  │  │  Dashboard  │  │ │  │
│  │  ┌────────┐  │          │  │  │  (full)     │  │ │  │
│  │  │ Tray   │  │          │  │  └─────────────┘  │ │  │
│  │  │ Icon   │  │          │  │                    │ │  │
│  │  └────────┘  │          │  └──────────────────┘ │  │
│  └──────────────┘          └──────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Main Process (Node.js)

Handles everything that requires native access:

- **BLE Service** — Scans for CSC devices, manages connections, subscribes to notifications, parses CSC measurement data (wheel revolutions, crank revolutions, timestamps). Emits parsed data over IPC.
- **Database Service** — SQLite connection via `better-sqlite3` + Drizzle ORM. Handles all reads/writes. Exposes query methods via IPC handlers.
- **Window Manager** — Creates and manages the widget window (small, always-on-top) and dashboard window (full-size). Handles toggling between views.
- **Tray Icon** — System tray presence with quick actions (show/hide widget, open dashboard, connect/disconnect, quit).
- **Session Manager** — Tracks ride sessions (start, stop, pause detection via inactivity timeout). Persists session data to SQLite.

### Renderer Process (React)

Single React app with two view modes, routed internally:

- **Widget View** — Compact overlay (~300x200px, always-on-top). Shows live speed, cadence, distance, and session duration. Minimal chrome. Click to expand to dashboard.
- **Dashboard View** — Full window with:
  - Live stats panel (current session)
  - Session history list
  - Charts (speed/cadence over time, daily/weekly distance)
  - Challenges & achievements
  - Settings (wheel circumference, sensor pairing, display preferences)

### IPC Contract

Communication between main and renderer uses Electron's `contextBridge` + `ipcRenderer`/`ipcMain`. The renderer never accesses Node.js APIs directly.

```typescript
// Main → Renderer (events)
'ble:status'          → { state: 'scanning' | 'connected' | 'disconnected', deviceName?: string }
'ble:data'            → { speed?: number, cadence?: number, distance: number, timestamp: number }
'session:updated'     → { sessionId: string, duration: number, distance: number }

// Renderer → Main (invoke/handle)
'ble:scan'            → void                    // Start scanning for CSC devices
'ble:connect'         → { deviceId: string }     // Connect to specific device
'ble:disconnect'      → void                    // Disconnect current device
'session:start'       → SessionRecord           // Start a new session
'session:stop'        → SessionRecord           // Stop current session
'session:list'        → SessionRecord[]          // Get session history
'stats:summary'       → StatsSummary             // Get aggregated statistics
'settings:get'        → Settings                 // Get user settings
'settings:set'        → { key: string, value }   // Update a setting
```

## Data Model

The data model follows an event store pattern with clear separation between immutable raw data and regenerable interpretations.

### Layer 1-3: `measurements` (immutable)

Every BLE CSC notification is stored as-is. This table is append-only and never modified.

```
measurements
├── id                TEXT    PK    — UUID
├── sensor_id         TEXT    NOT NULL — BLE device address or identifier
├── timestamp_utc     TEXT    NOT NULL — ISO 8601, e.g. "2026-02-14T14:30:00.123Z"
├── raw_data          BLOB   NOT NULL — Original BLE notification bytes
│
│   -- Layer 2: CSC spec decoding (deterministic parse of raw_data)
├── has_wheel_data    INT    NOT NULL — 0 or 1 (flags & 0x01)
├── has_crank_data    INT    NOT NULL — 0 or 1 (flags & 0x02)
├── wheel_revs        INT             — Cumulative wheel revolutions (uint32), NULL if !has_wheel_data
├── wheel_time        INT             — Last wheel event time in 1/1024s (uint16), NULL if !has_wheel_data
├── crank_revs        INT             — Cumulative crank revolutions (uint16), NULL if !has_crank_data
├── crank_time        INT             — Last crank event time in 1/1024s (uint16), NULL if !has_crank_data
│
│   -- Layer 3: Deltas relative to previous measurement from same sensor
├── time_diff_ms      INT             — Wall clock ms since previous measurement
├── wheel_revs_diff   INT             — Delta wheel revs (rollover-corrected, masked uint32)
├── wheel_time_diff   INT             — Delta wheel event time (rollover-corrected, masked uint16)
├── crank_revs_diff   INT             — Delta crank revs (rollover-corrected, masked uint16)
├── crank_time_diff   INT             — Delta crank event time (rollover-corrected, masked uint16)
│
├── INDEX idx_measurements_sensor_ts (sensor_id, timestamp_utc)
```

**Notes:**
- `raw_data` is the full BLE notification byte array. This is the ultimate fallback — if parsing logic changes, everything can be reprocessed from this field.
- Layer 2 fields are a lossless decode of `raw_data` per the CSC spec. They exist for query convenience; they could be recomputed from `raw_data`.
- Layer 3 deltas are computed at insert time by looking at the previous row for the same `sensor_id`. They are deterministic given the sequence. NULL for the first measurement of a sensor or after a reconnect.
- `timestamp_utc` is ISO 8601 string for human readability and timezone safety. SQLite handles ISO 8601 natively in date/time functions.
- No sensor-specific assumptions: the schema works for any CSC sensor regardless of whether it reports wheel data, crank data, or both.

### Layer 4: `computed_metrics` (regenerable)

Interpreted values that depend on user configuration (e.g. wheel circumference) or session context. This entire table can be dropped and regenerated from `measurements` + `settings`.

```
computed_metrics
├── measurement_id    TEXT    PK FK → measurements.id
├── session_id        TEXT    FK → sessions.id, NULL if not yet assigned
├── wheel_circumference_m  REAL  — The circumference used for this computation
├── speed_kmh         REAL        — Derived: (wheel_revs_diff * circumference) / (wheel_time_diff / 1024) * 3.6
├── cadence_rpm       REAL        — Derived: (crank_revs_diff / (crank_time_diff / 1024)) * 60
├── distance_m        REAL        — Derived: wheel_revs_diff * circumference
```

**Notes:**
- 1:1 relationship with `measurements`, but different lifecycle: measurements are immutable, computed_metrics are regenerable.
- `wheel_circumference_m` is stored per row so you can see which value was used, and detect when recalculation is needed after a calibration change.
- `session_id` links to the sessions table. Session boundary detection (based on time gaps, manual start/stop, etc.) is an interpretation concern, so it lives here rather than in measurements.

### Sessions and supporting tables

```
sessions
├── id                TEXT    PK    — UUID
├── sensor_id         TEXT    NOT NULL
├── started_at        TEXT    NOT NULL — ISO 8601 UTC
├── ended_at          TEXT            — ISO 8601 UTC, NULL if active
├── distance_m        REAL            — Sum of computed_metrics.distance_m
├── duration_s        INT             — Wall clock seconds
├── avg_speed_kmh     REAL
├── avg_cadence_rpm   REAL
├── max_speed_kmh     REAL
├── max_cadence_rpm   REAL

settings
├── key               TEXT    PK
├── value             TEXT          — JSON-encoded value

achievements
├── id                TEXT    PK
├── type              TEXT    NOT NULL
├── unlocked_at       TEXT    NOT NULL — ISO 8601 UTC
├── metadata          TEXT          — JSON
```

**Design notes:**
- `sessions` contains pre-computed aggregates for fast dashboard queries. All values are derivable from `computed_metrics` and can be regenerated.
- Session aggregates are updated in real-time during active sessions and finalized when a session ends.
- `settings` stores user preferences (wheel circumference, units, theme, etc.) as JSON values.
- All timestamps are ISO 8601 UTC strings throughout the entire schema for consistency.

## BLE: CSC Protocol Handling

The existing Python proof-of-concept in `deskbike.py` implements CSC parsing correctly. The same logic translates to TypeScript:

1. Subscribe to CSC Measurement characteristic (`0x2A5B`)
2. Parse flags byte to determine presence of wheel and crank data
3. Extract cumulative wheel revolutions (uint32) and last wheel event time (uint16, 1/1024s)
4. Extract cumulative crank revolutions (uint16) and last crank event time (uint16, 1/1024s)
5. Compute deltas between consecutive notifications to derive instantaneous speed and cadence
6. Handle uint16/uint32 rollovers with bitmask arithmetic

The CSC parser will be a pure function with no side effects, making it straightforward to unit test with known byte sequences from the existing Python output.

## Window Management

**Widget Window:**
- Size: ~300x200px, resizable with constraints
- Always-on-top (configurable)
- Frameless with custom drag region
- Transparent background option
- Positioned via user preference (remembers last position)
- Double-click or button to expand to dashboard

**Dashboard Window:**
- Size: 900x600px default, resizable
- Standard window chrome
- Can minimize to widget or to tray

**System Tray:**
- Always present when app is running
- Menu: Show Widget / Open Dashboard / separator / Connected: [device] / Connect... / separator / Quit
- Left-click: toggle widget
- Right-click: menu

## Project Structure

```
deskbike-app/
├── electron/                  # Main process code
│   ├── main.ts                # Entry point, window creation
│   ├── ble/
│   │   ├── scanner.ts         # Device discovery
│   │   ├── connection.ts      # Device connection management
│   │   └── csc-parser.ts      # CSC measurement parsing
│   ├── db/
│   │   ├── schema.ts          # Drizzle schema definitions
│   │   ├── migrations/        # Auto-generated migrations
│   │   └── queries.ts         # Database query functions
│   ├── ipc/
│   │   └── handlers.ts        # IPC handler registration
│   ├── session.ts             # Session lifecycle management
│   ├── tray.ts                # System tray setup
│   └── windows.ts             # Window creation and management
├── src/                       # Renderer process (React)
│   ├── main.tsx               # React entry point
│   ├── App.tsx                # Root component with routing
│   ├── components/
│   │   ├── widget/            # Widget view components
│   │   ├── dashboard/         # Dashboard view components
│   │   ├── charts/            # Chart components
│   │   └── common/            # Shared UI components
│   ├── hooks/
│   │   ├── useBle.ts          # BLE state and events
│   │   ├── useSession.ts      # Session state
│   │   └── useStats.ts        # Statistics queries
│   ├── stores/
│   │   └── appStore.ts        # Zustand store
│   └── lib/
│       ├── ipc.ts             # Type-safe IPC wrapper
│       └── types.ts           # Shared type definitions
├── docs/
│   └── Architecture.md        # This document
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
├── electron-builder.yml       # Build/packaging config
└── drizzle.config.ts          # Drizzle ORM config
```

## Distribution

### Build Targets

| Platform | Format              | Auto-update        |
| -------- | ------------------- | ------------------ |
| Windows  | NSIS installer (.exe) + portable | electron-updater (GitHub Releases) |
| macOS    | DMG + .app bundle   | electron-updater (GitHub Releases) |
| Linux    | AppImage + .deb     | electron-updater (GitHub Releases) |

### App Stores (future)

- **Microsoft Store**: MSIX package via electron-builder
- **Mac App Store**: MAS build via electron-builder (requires Apple Developer account, entitlements for Bluetooth)
- **Linux**: Snap / Flatpak (secondary priority)

### Code Signing

- **macOS**: Requires Apple Developer ID certificate for notarization (mandatory for Bluetooth access on modern macOS)
- **Windows**: Optional but recommended EV code signing certificate to avoid SmartScreen warnings

## Future Extensibility: Cloud Sync

The architecture supports a future cloud layer without structural changes:

1. SQLite remains the local source of truth
2. A sync service in the main process pushes session summaries to a REST API
3. Conflict resolution: last-write-wins on settings, append-only for sessions
4. The database schema already uses UUIDs for primary keys to support distributed creation

This is out of scope for v1 but the architecture does not block it.

## Platform-Specific Considerations

### BLE Permissions
- **macOS**: App needs Bluetooth entitlement. User will see a system permission prompt on first scan. Code signing is required for this to work.
- **Windows**: No special permissions needed. WinRT BLE API works out of the box.
- **Linux**: BlueZ must be installed (present on all major distros). User may need to be in the `bluetooth` group or the app needs `cap_net_raw` capability.

### Development Prerequisites
- Node.js 20+
- Platform-specific BLE build tools:
  - **Linux**: `sudo apt install bluetooth bluez libbluetooth-dev libudev-dev`
  - **macOS**: Xcode command line tools
  - **Windows**: windows-build-tools or Visual Studio Build Tools
