import { createRequire } from "node:module";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve("better-sqlite3/package.json");
const moduleDir = dirname(packageJsonPath);

const result = spawnSync("npm", ["run", "build-release"], {
  cwd: moduleDir,
  stdio: "inherit",
});

if (result.error) {
  console.error("[native:rebuild:node] Failed to run build-release:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
