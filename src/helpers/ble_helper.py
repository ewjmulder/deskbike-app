#!/usr/bin/env python3
"""
DeskBike BLE helper process.

Communicates with Electron main process via stdin/stdout using
newline-delimited JSON.

Commands (stdin):
  {"cmd": "scan"}
  {"cmd": "connect", "device_id": "XX:XX:XX:XX:XX:XX"}
  {"cmd": "disconnect"}

Events (stdout):
  {"type": "device", "id": "...", "name": "..."}
  {"type": "connected"}
  {"type": "data", "raw": [...]}
  {"type": "disconnected"}
  {"type": "error", "message": "..."}
"""

import asyncio
import json
import signal
import sys
from bleak import BleakScanner, BleakClient

CSC_SERVICE = "00001816-0000-1000-8000-00805f9b34fb"
CSC_MEASUREMENT = "00002a5b-0000-1000-8000-00805f9b34fb"


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


class BleManager:
    def __init__(self) -> None:
        self._connect_event: asyncio.Event = asyncio.Event()
        self._disconnect_event: asyncio.Event = asyncio.Event()
        self._scan_task: asyncio.Task | None = None
        self._connect_task: asyncio.Task | None = None

    def request_connect(self, device_id: str) -> None:
        self._connect_event.set()

    def request_disconnect(self) -> None:
        self._disconnect_event.set()

    async def scan(self) -> None:
        # Reset event so stale signals from previous sessions don't cause immediate exit
        self._connect_event.clear()
        seen: set[str] = set()

        def on_detection(device, _ad_data) -> None:
            if device.address not in seen:
                seen.add(device.address)
                emit({"type": "device", "id": device.address, "name": device.name or device.address})

        async with BleakScanner(on_detection):
            await self._connect_event.wait()
        # Scanner context is exited here; adapter is released before connect() proceeds

    async def connect(self, device_id: str) -> None:
        # Reset event so stale disconnects don't cause immediate exit
        self._disconnect_event.clear()

        # Wait for scan task to fully finish (adapter released) before connecting
        if self._scan_task is not None and not self._scan_task.done():
            await self._scan_task

        def on_disconnect(_client: BleakClient) -> None:
            emit({"type": "disconnected"})
            self._disconnect_event.set()

        try:
            async with BleakClient(device_id, disconnected_callback=on_disconnect) as client:
                emit({"type": "connected"})

                async def on_notify(_char, data: bytearray) -> None:
                    emit({"type": "data", "raw": list(data)})

                await client.start_notify(CSC_MEASUREMENT, on_notify)

                await self._disconnect_event.wait()
                self._disconnect_event.clear()

                try:
                    await client.stop_notify(CSC_MEASUREMENT)
                except Exception:
                    pass
        except Exception as exc:
            emit({"type": "error", "message": str(exc)})


async def read_commands(manager: BleManager) -> None:
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue

        if cmd.get("cmd") == "scan":
            if manager._scan_task is None or manager._scan_task.done():
                manager._scan_task = asyncio.create_task(manager.scan())
        elif cmd.get("cmd") == "connect":
            device_id = cmd.get("device_id", "")
            if not device_id:
                emit({"type": "error", "message": "device_id is required"})
                continue
            if manager._connect_task is None or manager._connect_task.done():
                manager.request_connect(device_id)
                manager._connect_task = asyncio.create_task(manager.connect(device_id))
        elif cmd.get("cmd") == "disconnect":
            manager.request_disconnect()


async def main() -> None:
    manager = BleManager()
    await read_commands(manager)


if __name__ == "__main__":
    # Allow Electron to cleanly terminate the process via SIGTERM
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    asyncio.run(main())
