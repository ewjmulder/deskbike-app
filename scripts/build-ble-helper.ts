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
