# Native addon ABI compatibility in Electron projects

## Background

This project uses `better-sqlite3`, a native Node.js addon — a compiled `.node` binary that links directly against a specific version of the V8 JavaScript engine and Node.js internals. Native addons are not portable: each binary is compiled for a specific **NODE_MODULE_VERSION** (also called ABI version), and a binary compiled for one ABI will refuse to load in a runtime with a different ABI.

### The two runtimes in this project

| Runtime | Used for | ABI (as of 2026-03) |
|---------|----------|---------------------|
| System Node.js (v22/v25) | `pnpm test`, build tooling, `electron-vite` | 141 |
| Electron 33's bundled Node.js | Running the app | 130 |

Electron ships its **own patched Node.js** runtime. Its ABI does not follow the same numbering as standalone Node.js. ABI 130 (Electron 33) is an Electron-internal value that does not correspond to any released standalone Node.js version.

The `better-sqlite3` binary therefore needs to satisfy two incompatible ABIs: one for running tests with system Node, and one for running the app inside Electron.

---

## Why is this a problem?

The native addon lives at a single path on disk:

```
node_modules/.pnpm/better-sqlite3@.../build/Release/better_sqlite3.node
```

There is only one file. If it is compiled for ABI 130 (Electron), Vitest fails:

```
Error: The module '...better_sqlite3.node' was compiled against a different
Node.js version using NODE_MODULE_VERSION 130. This version of Node.js
requires NODE_MODULE_VERSION 141.
```

If it is compiled for ABI 141 (system Node), the app fails at startup:

```
[Main] fatal startup error: Error: The module '...better_sqlite3.node'
was compiled against a different Node.js version using NODE_MODULE_VERSION 141.
This version of Node.js requires NODE_MODULE_VERSION 130.
```

Because `pnpm install` (via `postinstall → electron-rebuild`) and `pnpm test` (via `pretest → rebuild-for-node`) each overwrite the same file for their own ABI, running both in a row always left the binary in the wrong state for whichever command ran second.

---

## Attempted solutions

### 1. Run tests before `pnpm dev` — insufficient

The `predev` hook rebuilds for Electron. The `pretest` hook rebuilds for Node. Because hooks run unconditionally, the binary was always rebuilt twice regardless of whether it was necessary. This was slow but also fragile: the order of operations determined which ABI the final binary had.

### 2. Switch system Node to match Electron's ABI — does not work

The hypothesis was that if the system Node and Electron share the same ABI, a single binary would work for both. Electron 33 uses ABI 130. Testing confirmed:

```
Node 22.22.1 → ABI 141
Node 25.4.0  → ABI 141
Electron 33  → ABI 130
```

ABI 130 is Electron-specific. No current standalone Node.js release uses it. The mismatch is structural and cannot be resolved by switching Node versions.

### 3. Stamp file to skip redundant rebuilds — partially correct, order-dependent

A single `.native-rebuild-stamp` file stored `node=vX electron=vY`. When the stamp matched, both rebuilds were skipped. When it did not match, both rebuilds ran.

The problem: the rebuild order still mattered. Building for Node last left the binary in Node ABI, making the app fail. Building for Electron last broke tests. This was fixed by ordering Node-rebuild → tests → Electron-rebuild, but it still ran two full compilations on every version change.

---

## Chosen solution: binary cache

A `.native-cache/` directory stores one compiled binary per runtime version:

```
.native-cache/
  better_sqlite3.node-v22.22.1.node     # compiled for system Node ABI
  better_sqlite3.electron-33.4.11.node  # compiled for Electron ABI
```

`run.sh` manages the lifecycle:

1. **Before tests:** copy the Node-ABI binary from cache to the active path (build it first if not cached).
2. **Run tests** with the correct binary in place.
3. **Before starting the app:** copy the Electron-ABI binary from cache to the active path (build it first if not cached).
4. **Build and run** with the correct binary in place.

Each binary is only compiled **once** — on the first run for that combination of Node version and Electron version. Subsequent runs restore from cache in milliseconds.

Cache files are keyed on version strings, so switching Node or upgrading Electron automatically triggers a rebuild for the new version while the old cache entry remains available.

```
.native-cache/ is listed in .gitignore — it is machine-local.
```

---

## Trade-offs

| Aspect | Impact |
|--------|--------|
| First-run overhead | Two full compilations (~1–2 min total) |
| Subsequent runs | Cache restore: ~1s instead of ~60s each |
| Disk usage | Two ~3 MB `.node` files per Node+Electron version pair |
| Portability | Each developer machine and CI runner builds its own cache on first use |
| Version changes | Upgrading Node or Electron triggers only the affected rebuild, not both |
| Correctness | Binary in active path is always correct for the immediately following operation |

### Why not a single binary?

It would require either:
- Running tests inside Electron (possible via `vitest-electron`, but slow and complex — Electron startup overhead on every test run)
- A WebAssembly-based SQLite library like `sql.js` (no native compilation needed, but different API and performance characteristics — significant migration effort)

Neither trade-off is worth it for this project's scale and test count.

### Why `.native-cache/` and not a per-runtime `node_modules`?

electron-rebuild already handles the Electron side correctly when invoked directly; it just writes to the same path that plain Node uses. The cache is a thin wrapper around the existing build tooling rather than a replacement for it.

---

## ABI reference

| Version | ABI |
|---------|-----|
| Electron 33 | 130 |
| Node.js 22.22.1 | 141 |
| Node.js 25.4.0 | 141 |

To check ABI values at any time:

```bash
# System Node
node -e "console.log(process.versions.modules)"

# Electron
node -e "
  const e = require('./node_modules/electron');
  const {execFileSync} = require('child_process');
  console.log(execFileSync(e, ['-e', 'process.stdout.write(process.versions.modules)'], {timeout:5000}).toString())
"
```
