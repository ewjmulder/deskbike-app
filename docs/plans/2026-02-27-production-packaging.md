# Production Packaging Implementation Plan

> **Status update (2026-02-27):** Implemented.
> Packaging pipeline exists with bundled helper binary and migrations via electron-builder.
> Current source of truth: `electron-builder.yml`, `scripts/build-ble-helper.ts`, and CI workflow files.


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bundle the Python BLE helper as a self-contained binary into the Electron installer so users need no Python or bleak installed.

**Architecture:** PyInstaller compiles `src/helpers/ble_helper.py` + bleak + its Python runtime into a single platform-native executable (`dist-helpers/ble_helper` / `ble_helper.exe`). electron-builder is configured to copy this binary into `resources/helpers/` in the packaged app. `BleHelper.start()` already splits on `app.isPackaged`; we extend it to spawn the compiled binary directly (no Python interpreter) when packaged. GitHub Actions builds all three platforms natively in a matrix job.

**Tech Stack:** PyInstaller ≥ 6.0, electron-builder ≥ 25, uv (Python package manager), tsx (already in devDeps), GitHub Actions matrix (ubuntu-latest / macos-latest / windows-latest)

---

### Task 1: PyInstaller build script

**Files:**
- Create: `requirements-build.txt`
- Create: `scripts/build-ble-helper.ts`
- Modify: `package.json` (add `build:helper` script)
- Modify: `.gitignore` (add `dist-helpers/`, `*.spec`)

**Context:** uv is the project's Python package manager. The venv has no pip — use `uv pip install`. `pyinstaller` is a build-time dev dependency; keep it out of the runtime `requirements.txt`. Use `spawnSync` (not `execSync`) so no shell is involved and paths with spaces are handled safely.

**Step 1: Create `requirements-build.txt`**

```
pyinstaller>=6.0
```

**Step 2: Create `scripts/build-ble-helper.ts`**

```typescript
// scripts/build-ble-helper.ts
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { platform } from 'process'

const root = process.cwd()
const isWin = platform === 'win32'
const venvPython = join(root, '.venv', isWin ? 'Scripts\\python.exe' : 'bin/python3')

if (!existsSync(venvPython)) {
  console.error('ERROR: .venv not found.')
  console.error('Run: uv venv && uv pip install -r requirements.txt')
  process.exit(1)
}

function run(cmd: string, args: string[]): void {
  console.log(`> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: root })
  if (result.status !== 0) {
    console.error(`Command failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

// Install pyinstaller into the venv via uv
run('uv', ['pip', 'install', '--python', venvPython, '-r', 'requirements-build.txt'])

const pyinstaller = join(root, '.venv', isWin ? 'Scripts\\pyinstaller.exe' : 'bin/pyinstaller')
const helperSrc = join(root, 'src', 'helpers', 'ble_helper.py')

run(pyinstaller, [
  '--onefile',
  '--clean',
  '--name', 'ble_helper',
  '--distpath', 'dist-helpers',
  helperSrc,
])

const binary = join(root, 'dist-helpers', isWin ? 'ble_helper.exe' : 'ble_helper')
if (!existsSync(binary)) {
  console.error(`ERROR: Expected binary not found at ${binary}`)
  process.exit(1)
}

console.log(`\n✓ Built: ${binary}`)
```

**Step 3: Add script to `package.json`**

In the `"scripts"` section, add after `"build"`:
```json
"build:helper": "tsx scripts/build-ble-helper.ts",
```

**Step 4: Update `.gitignore`**

Append to the file:
```
dist-helpers/
*.spec
build/
```

**Step 5: Run to verify**

```bash
pnpm build:helper
```

Expected output ends with:
```
✓ Built: /path/to/dist-helpers/ble_helper
```

Verify the binary is standalone by running it briefly:

```bash
# Linux/Mac — should start without "No module named bleak":
./dist-helpers/ble_helper &
PID=$!
sleep 1
kill $PID
echo "exit OK"
```

**Step 6: Commit**

```bash
git add requirements-build.txt scripts/build-ble-helper.ts package.json .gitignore
git commit -m "build: add PyInstaller script to compile BLE helper binary"
```

---

### Task 2: electron-builder configuration

**Files:**
- Create: `electron-builder.yml`
- Create: `build-resources/entitlements.mac.plist`
- Modify: `package.json` (add `dist` script, install `electron-builder`)
- Modify: `.gitignore` (add `release/`)

**Context:** electron-vite's `pnpm build` compiles TypeScript/React into `out/`. electron-builder takes `out/` and produces native installers. `extraResources` copies `dist-helpers/` into `resources/helpers/` inside the packaged app. `process.resourcesPath` in `BleHelper` resolves to that directory at runtime.

**Step 1: Install electron-builder**

```bash
pnpm add -D electron-builder
```

**Step 2: Create `electron-builder.yml`**

```yaml
appId: com.bytecraft.deskbike
productName: DeskBike
copyright: "Copyright © 2026 Bytecraft Digital"

directories:
  output: release
  buildResources: build-resources

files:
  - out/**/*
  - node_modules/**/*
  - "!node_modules/.cache/**"
  - "!**/*.ts"

# Bundle the compiled BLE helper binary into resources/helpers/
extraResources:
  - from: dist-helpers/
    to: helpers/
    filter:
      - "ble_helper"
      - "ble_helper.exe"

linux:
  target:
    - target: AppImage
    - target: deb
  category: Utility

mac:
  target:
    - target: dmg
  hardenedRuntime: true
  entitlements: build-resources/entitlements.mac.plist
  entitlementsInherit: build-resources/entitlements.mac.plist

win:
  target:
    - target: nsis
```

**Step 3: Create macOS entitlements**

Create directory and file `build-resources/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.device.bluetooth</key>
  <true/>
</dict>
</plist>
```

**Step 4: Add `dist` script and update `.gitignore`**

In `package.json` scripts:
```json
"dist": "pnpm build && pnpm build:helper && electron-builder",
```

In `.gitignore`, append:
```
release/
```

**Step 5: Commit**

```bash
git add electron-builder.yml build-resources/ package.json pnpm-lock.yaml .gitignore
git commit -m "build: add electron-builder config with BLE helper extraResources"
```

---

### Task 3: Update BleHelper for packaged mode

**Files:**
- Modify: `src/main/ble/helper.ts` (the `start()` method)

**Context:** When `app.isPackaged`, the `.py` file isn't shipped. The compiled binary lives at `join(process.resourcesPath, 'helpers', 'ble_helper[.exe]')`. Spawn it directly with no args and no Python interpreter. On Windows the binary has `.exe` extension; on Linux/macOS no extension. The existing `existsSync` import and venv-detection logic are already in the file; we're refactoring `start()` to clearly separate packaged vs dev paths.

**Step 1: No new tests needed** — existing 21 tests already cover the BleHelper logic. The packaged path can only be end-to-end tested in Task 4.

**Step 2: Replace `start()` in `src/main/ble/helper.ts`**

Replace the entire `start()` method body (currently lines 37–72 of the file) with:

```typescript
start(): void {
  let helperBin: string
  let helperArgs: string[]

  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : ''
    helperBin = join(process.resourcesPath, 'helpers', `ble_helper${ext}`)
    helperArgs = []
  } else {
    const helperPath = join(app.getAppPath(), 'src', 'helpers', 'ble_helper.py')
    const venvPython = join(app.getAppPath(), '.venv', 'bin', 'python3')
    helperBin = existsSync(venvPython) ? venvPython : 'python3'
    helperArgs = [helperPath]
  }

  console.log(`[BleHelper] spawning ${helperBin} ${helperArgs.join(' ')}`)
  this.process = spawn(helperBin, helperArgs)

  const rl = createInterface({ input: this.process.stdout! })
  rl.on('line', (line) => {
    console.log(`[BleHelper] stdout: ${line}`)
    const event = parseHelperLine(line)
    if (event) this.onEvent?.(event)
  })

  this.process.stderr!.on('data', (data: Buffer) => {
    console.error('[BleHelper] stderr:', data.toString())
  })

  this.process.on('error', (err: NodeJS.ErrnoException) => {
    const hint = err.code === 'ENOENT'
      ? app.isPackaged
        ? ' (ble_helper binary missing — was the app built with pnpm dist?)'
        : ' (is python3 installed and on PATH?)'
      : ''
    console.error(`[BleHelper] spawn error:${hint}`, err)
    this.onEvent?.({ type: 'error', message: `Failed to start BLE helper: ${err.message}${hint}` })
    this.process = null
  })

  this.process.on('exit', (code) => {
    console.log(`[BleHelper] process exited with code ${code}`)
    this.onEvent?.({ type: 'error', message: `BLE helper process exited (code ${code})` })
    this.process = null
  })
}
```

**Step 3: Run tests**

```bash
pnpm test
```

Expected: all 21 tests pass (no new tests, no regressions).

**Step 4: Commit**

```bash
git add src/main/ble/helper.ts
git commit -m "feat: spawn compiled BLE helper binary when packaged (no Python required)"
```

---

### Task 4: Local end-to-end packaging test (Linux)

**Files:** None — verification only.

**Goal:** Build a real Linux AppImage/deb, mount/install it, and confirm the BLE helper binary starts and works without Python.

**Step 1: Build the full distribution**

```bash
pnpm dist
```

Expected: `release/` contains `DeskBike-0.1.0.AppImage` and `DeskBike-0.1.0.deb`.

If the build fails, read the error carefully:
- `dist-helpers/ble_helper not found` → run `pnpm build:helper` first
- electron-builder config errors → check `electron-builder.yml` syntax

**Step 2: Verify the binary is inside the AppImage**

```bash
# AppImage files are self-extracting; check contents without running:
./release/*.AppImage --appimage-extract >/dev/null 2>&1
ls squashfs-root/resources/helpers/
# Expected: ble_helper
file squashfs-root/resources/helpers/ble_helper
# Expected: ELF 64-bit LSB executable (or similar)
rm -rf squashfs-root
```

**Step 3: Run the AppImage**

```bash
chmod +x release/*.AppImage
./release/*.AppImage
```

In the app, click Scan. Expected in the terminal:
```
[BleHelper] spawning /tmp/.mount_*/resources/helpers/ble_helper
```

No "No module named bleak" error. BLE scan should behave identically to dev mode.

**Step 4: (Optional) Install and test the .deb**

```bash
sudo dpkg -i release/*.deb
deskbike-app   # or the installed binary name
```

**Step 5: Fix any issues found and commit**

```bash
git add <fixed files>
git commit -m "fix: <describe fix>"
```

---

### Task 5: GitHub Actions CI/CD workflow

**Files:**
- Create: `.github/workflows/build.yml`

**Context:** PyInstaller cannot cross-compile — each platform must build natively. GitHub Actions provides `ubuntu-latest`, `macos-latest`, `windows-latest`. uv is installed via `astral-sh/setup-uv@v5`. Builds are unsigned for now (code signing requires paid Apple/Microsoft certificates); unsigned `.dmg`/`.exe` will show security warnings but are installable. Upload artifacts per platform.

**Step 1: Create `.github/workflows/build.yml`**

```yaml
name: Build

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
    branches: [main]

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
      fail-fast: false

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          version: "latest"

      - name: Create Python venv and install runtime deps
        run: |
          uv venv
          uv pip install -r requirements.txt

      - name: Install Node dependencies
        run: pnpm install

      - name: Rebuild native modules for Electron
        run: pnpm electron-rebuild -f -w better-sqlite3

      - name: Build BLE helper binary
        run: pnpm build:helper

      - name: Compile TypeScript / React
        run: pnpm build

      - name: Package with electron-builder
        run: npx electron-builder --publish never
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload Linux artifacts
        if: matrix.os == 'ubuntu-latest'
        uses: actions/upload-artifact@v4
        with:
          name: deskbike-linux
          path: |
            release/*.AppImage
            release/*.deb
          if-no-files-found: warn

      - name: Upload macOS artifacts
        if: matrix.os == 'macos-latest'
        uses: actions/upload-artifact@v4
        with:
          name: deskbike-macos
          path: release/*.dmg
          if-no-files-found: warn

      - name: Upload Windows artifacts
        if: matrix.os == 'windows-latest'
        uses: actions/upload-artifact@v4
        with:
          name: deskbike-windows
          path: |
            release/*.exe
            release/*.msi
          if-no-files-found: warn
```

**Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add GitHub Actions matrix build for Linux, macOS, Windows"
```

**Step 3: Push and verify**

```bash
git push
```

Open GitHub → Actions. All three matrix jobs should pass. Download the Linux artifact and do a quick sanity check that it runs.

---

## After completion: full build workflow

**Development (unchanged):**
```bash
pnpm dev             # Uses .venv python + .py script (auto-detected)
MOCK_BLE=1 pnpm dev  # No BLE hardware needed
pnpm test            # 21 unit tests
```

**One-time local build:**
```bash
pnpm dist            # build + build:helper + electron-builder → release/
```

**CI:** Every push to main builds all three platforms and uploads installers as artifacts.
