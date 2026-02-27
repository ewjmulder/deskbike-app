import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const blenoPackageJsonPath = require.resolve("@abandonware/bleno/package.json");
const blenoRequire = createRequire(blenoPackageJsonPath);
const packageJsonPath = blenoRequire.resolve("@abandonware/bluetooth-hci-socket/package.json");
const moduleDir = dirname(packageJsonPath);

const result = spawnSync("pnpm", ["exec", "node-pre-gyp", "rebuild"], {
  cwd: moduleDir,
  stdio: "inherit",
});

if (result.error) {
  console.error("[emulator:rebuild-native] Failed to run node-pre-gyp:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
