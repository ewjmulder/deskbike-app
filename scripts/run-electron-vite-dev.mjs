import { spawn } from "node:child_process";

const isMock = process.argv.includes("--mock");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (isMock) env.MOCK_BLE = "1";

const child = spawn("pnpm", ["exec", "electron-vite", "dev"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
