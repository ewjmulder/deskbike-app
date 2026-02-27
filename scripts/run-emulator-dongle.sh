#!/usr/bin/env bash
set -euo pipefail

PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "$PNPM_BIN" ]]; then
  echo "pnpm not found on PATH" >&2
  exit 1
fi

NODE_BIN_DIR="$(dirname "$PNPM_BIN")"
BASE_PATH="${NODE_BIN_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo env PATH="${BASE_PATH}" "${PNPM_BIN}" emulator:dongle:raw
fi

exec env PATH="${BASE_PATH}" "${PNPM_BIN}" emulator:dongle:raw
