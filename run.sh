#!/usr/bin/env bash
set -euo pipefail

MOCK=0
if [[ "${1:-}" == "mock" ]]; then
  MOCK=1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${BOLD}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="$SCRIPT_DIR/.native-cache"
mkdir -p "$CACHE_DIR"

# Resolve the active better-sqlite3 binary path
BINARY_PATH="$(node -e "console.log(require.resolve('better-sqlite3/build/Release/better_sqlite3.node'))")"

# ── 1. Sanity checks ────────────────────────────────────────────────────────
step "Sanity checks"

command -v node    >/dev/null 2>&1 || fail "node not found"
command -v pnpm    >/dev/null 2>&1 || fail "pnpm not found"
command -v python3 >/dev/null 2>&1 || fail "python3 not found"

ok "node $(node --version)"
ok "pnpm $(pnpm --version)"
ok "python3 $(python3 --version 2>&1 | cut -d' ' -f2)"

# Check node_modules exist
[[ -d node_modules ]] || fail "node_modules missing — run: pnpm install"
ok "node_modules present"

NODE_VER="$(node --version)"
ELECTRON_VER="$(node -e "console.log(require('./node_modules/electron/package.json').version)" 2>/dev/null || echo "unknown")"
NODE_ABI="$(node -e "console.log(process.versions.modules)")"
ELECTRON_ABI="$(node -e "
  const e = require('./node_modules/electron');
  const {execFileSync} = require('child_process');
  try { process.stdout.write(execFileSync(e, ['-e', 'process.stdout.write(process.versions.modules)'], {timeout:5000}).toString()) }
  catch(_) { process.stdout.write('unknown') }
" 2>/dev/null || echo "unknown")"

if [[ "$NODE_ABI" == "$ELECTRON_ABI" ]]; then
  ok "Node ABI $NODE_ABI == Electron ABI $ELECTRON_ABI — single binary works for both"
else
  # This is normal for Electron: it ships its own Node runtime with a different ABI.
  # The native cache below maintains separate binaries for each.
  warn "Node ABI $NODE_ABI ≠ Electron ABI $ELECTRON_ABI — using separate cached binaries (normal for Electron)"
fi

# Check bleak is installed (required for real BLE mode)
if [[ $MOCK -eq 0 ]]; then
  python3 -c "import bleak" 2>/dev/null || fail "bleak not installed — run: pip install bleak"
  ok "bleak available"
else
  warn "mock mode — skipping bleak check"
fi

NODE_CACHE="$CACHE_DIR/better_sqlite3.node-${NODE_VER}.node"
ELECTRON_CACHE="$CACHE_DIR/better_sqlite3.electron-${ELECTRON_VER}.node"

# ── 2. Native module for Node (Vitest) ───────────────────────────────────────
step "Native modules (Node $NODE_VER)"
if [[ -f "$NODE_CACHE" ]]; then
  cp "$NODE_CACHE" "$BINARY_PATH"
  ok "restored from cache"
else
  node scripts/rebuild-better-sqlite3-node.mjs || fail "node rebuild failed"
  cp "$BINARY_PATH" "$NODE_CACHE"
  ok "built and cached"
fi

# ── 3. Tests ─────────────────────────────────────────────────────────────────
step "Tests"
pnpm exec vitest run || fail "tests failed"
ok "all tests passed"

# ── 4. Native module for Electron (runtime) ──────────────────────────────────
step "Native modules (Electron $ELECTRON_VER)"
if [[ -f "$ELECTRON_CACHE" ]]; then
  cp "$ELECTRON_CACHE" "$BINARY_PATH"
  ok "restored from cache"
else
  pnpm exec electron-rebuild -f -w better-sqlite3 || fail "electron-rebuild failed"
  cp "$BINARY_PATH" "$ELECTRON_CACHE"
  ok "built and cached"
fi

# ── 5. Build ─────────────────────────────────────────────────────────────────
step "Build"
pnpm exec electron-vite build || fail "build failed"
ok "build complete"

# ── 6. Run ───────────────────────────────────────────────────────────────────
if [[ $MOCK -eq 1 ]]; then
  step "Starting app (mock BLE)"
  exec node scripts/run-electron-vite-dev.mjs --mock
else
  step "Starting app (real BLE)"
  exec node scripts/run-electron-vite-dev.mjs
fi
