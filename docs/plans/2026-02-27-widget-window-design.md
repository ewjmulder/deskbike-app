# Widget Window Design

> **Status update (2026-02-27):** Implemented design.
> Widget and window manager architecture are active and persisted via settings.
> Current source of truth: `src/main/windows.ts`, `src/main/tray.ts`, `src/renderer/src/components/widget/WidgetView.tsx`.


**Date:** 2026-02-27
**Status:** Approved

## Goal

Add a floating widget window that shows live cycling metrics (speed, cadence, distance, session duration) outside the main dashboard window. The widget is always-on-top and frameless by default, with user-configurable settings.

## Decisions

- **Separate BrowserWindow** alongside the dashboard (not a mode of the main window)
- **Same Vite bundle** as the dashboard, differentiated via `?view=widget` URL parameter — no separate build
- **Always-on-top by default**, configurable via settings
- **Frameless + transparent** with CSS drag region
- Target platforms: Linux Mint X11 (primary dev), Windows, macOS

## Architecture

### New files

```
src/main/windows.ts       — WindowManager class
src/main/tray.ts          — TrayManager class
```

### Modified files

```
src/main/index.ts         — use WindowManager instead of raw BrowserWindow
src/main/ipc/handlers.ts  — accept WindowManager, broadcast to all open windows
src/renderer/src/App.tsx  — detect ?view=widget, render WidgetView
src/renderer/src/components/widget/WidgetView.tsx  — new widget UI component
```

## Window Configuration

```typescript
// Widget BrowserWindow options
{
  width: 280, height: 160,
  minWidth: 200, minHeight: 100,
  maxWidth: 420, maxHeight: 260,
  frame: false,
  transparent: true,
  resizable: true,
  skipTaskbar: true,
  alwaysOnTop: true,
  webPreferences: {
    preload: '...',
    contextIsolation: true,
    nodeIntegration: false,
  }
}
```

### Platform-specific setup after creation

```typescript
if (process.platform === 'darwin') {
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setWindowButtonVisibility(false)
} else {
  win.setAlwaysOnTop(true)
}
if (process.platform === 'linux') {
  win.setVisibleOnAllWorkspaces(true)
}
```

## WindowManager

Responsibilities:
- `createDashboard()` — 900×600, normal frame
- `createWidget()` — frameless, transparent, always-on-top
- `broadcast(channel, ...args)` — send IPC event to all open windows
- `showWidget()` / `hideWidget()` / `toggleWidget()`
- `saveWidgetBounds()` / `restoreWidgetBounds()` — persist position + size to settings table

## IPC Changes

`registerIpcHandlers` receives `WindowManager` instead of `WebContents`.

All push events broadcast to all open windows:
- `ble:device-found`, `ble:data`, `ble:disconnected`, `ble:error`

New IPC channels (renderer → main):
- `widget:show` — show widget window
- `widget:hide` — hide widget window
- `widget:toggle` — toggle widget visibility

## Renderer Routing

```typescript
// App.tsx
const isWidget = new URLSearchParams(window.location.search).get('view') === 'widget'
return isWidget ? <WidgetView /> : <DashboardView />
```

### WidgetView content

- Live speed (large, prominent)
- Cadence (RPM)
- Session distance
- Session duration (HH:MM:SS)
- Drag handle indicator
- "Open dashboard" button (`-webkit-app-region: no-drag`)

CSS drag setup:
```css
.widget-root { -webkit-app-region: drag; }
button, input { -webkit-app-region: no-drag; }
```

## Tray Icon

Always present when app is running. Allows showing/hiding the widget without a taskbar entry.

Menu structure:
```
[✓] Show Widget       (toggle)
    Open Dashboard
    ─────────────────
    Connected: <device name>   (or "Not connected")
    Disconnect
    ─────────────────
    Quit
```

- **macOS:** menu bar (top)
- **Windows:** notification area (bottom right), right-click = menu
- **Linux X11:** AppIndicator — works on KDE natively, GNOME with AppIndicator extension

## Settings

All stored in the existing `settings` table (key/value, JSON-encoded).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `widget.alwaysOnTop` | boolean | `true` | Float widget above other windows |
| `widget.opacity` | number (0.5–1.0) | `0.9` | Window opacity |
| `widget.bounds` | `{x,y,width,height}` | `null` | Saved position + size; null = center on first open |
| `widget.metrics` | string[] | `['speed','cadence','distance','duration']` | Which metrics to display |
| `widget.showOnStartup` | boolean | `true` | Show widget on app launch |
| `units.speed` | `'kmh' \| 'mph'` | `'kmh'` | Speed unit |
| `units.distance` | `'km' \| 'mi'` | `'km'` | Distance unit |

`widget.alwaysOnTop` calls `win.setAlwaysOnTop(...)` immediately on change — no restart needed.
`widget.opacity` calls `win.setOpacity(value)` immediately on change.

## Platform Notes

| Feature | macOS | Windows | Linux X11 | Linux Wayland |
|---------|-------|---------|-----------|---------------|
| Always-on-top | `'floating'` level | `WS_EX_TOPMOST` | `_NET_WM_STATE_ABOVE` | XWayland dependent |
| All workspaces | explicit + fullscreen | automatic | explicit | same as X11 |
| Frameless | ✅ | ✅ | ✅ | ✅ |
| Transparent | ✅ vibrancy possible | ✅ GPU dependent | ✅ compositor needed | ✅ |
| Tray | menu bar | notification area | AppIndicator | AppIndicator |

## Implementation Order

1. `WindowManager` + `TrayManager` in main process
2. Update `index.ts` to use `WindowManager`
3. Update IPC handlers to broadcast via `WindowManager`
4. Widget renderer component (structure, no styling)
5. CSS drag region + position save/restore
6. Platform-specific window options
7. Settings: `widget.alwaysOnTop`, `widget.opacity`
8. Tray icon
