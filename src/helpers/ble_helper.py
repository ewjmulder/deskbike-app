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
import os
import signal
import sys
from typing import Any
from bleak import BleakScanner, BleakClient

CSC_SERVICE = "00001816-0000-1000-8000-00805f9b34fb"
CSC_MEASUREMENT = "00002a5b-0000-1000-8000-00805f9b34fb"
CSC_MEASUREMENT_SHORT = "2a5b"


def get_bleak_kwargs() -> dict:
    # Linux-only: allow pinning scanner/client to a specific adapter (e.g. hci0).
    if not sys.platform.startswith("linux"):
        return {}
    adapter = os.environ.get("BLEAK_ADAPTER")
    return {"adapter": adapter} if adapter else {}


def normalize_uuid(uuid: str) -> str:
    value = uuid.lower()
    if len(value) == 4:
        return f"0000{value}-0000-1000-8000-00805f9b34fb"
    return value


def has_csc_service(advertisement_data) -> bool:
    service_uuids = getattr(advertisement_data, "service_uuids", None) or []
    for uuid in service_uuids:
        if normalize_uuid(uuid) == CSC_SERVICE:
            return True
    return False


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


class BleManager:
    def __init__(self) -> None:
        self._connect_event: asyncio.Event = asyncio.Event()
        self._disconnect_event: asyncio.Event = asyncio.Event()
        self._scan_task: asyncio.Task | None = None
        self._connect_task: asyncio.Task | None = None
        self._discovered_devices: dict[str, Any] = {}

    def request_connect(self) -> None:
        self._connect_event.set()

    def request_disconnect(self) -> None:
        self._disconnect_event.set()

    async def scan(self) -> None:
        # Reset event so stale signals from previous sessions don't cause immediate exit
        self._connect_event.clear()
        seen: set[str] = set()
        bleak_kwargs = get_bleak_kwargs()

        def on_detection(device, ad_data) -> None:
            if not has_csc_service(ad_data):
                return
            self._discovered_devices[device.address] = device
            if device.address not in seen:
                seen.add(device.address)
                emit({"type": "device", "id": device.address, "name": device.name or device.address})

        # Prefer software filtering over backend service_uuids filter.
        # On some BlueZ setups the backend filter is unreliable and can
        # interfere with subsequent service discovery during connect.
        async with BleakScanner(on_detection, **bleak_kwargs):
            await self._connect_event.wait()
        # Scanner context is exited here; adapter is released before connect() proceeds

    async def connect(self, device_id: str) -> None:
        # Reset event so stale disconnects don't cause immediate exit
        self._disconnect_event.clear()
        bleak_kwargs = get_bleak_kwargs()

        # Wait for scan task to fully finish (adapter released) before connecting
        if self._scan_task is not None and not self._scan_task.done():
            await self._scan_task
        # Give BlueZ a short moment to fully release scan state before connecting.
        await asyncio.sleep(0.2)

        def on_disconnect(_client: BleakClient) -> None:
            emit({"type": "disconnected"})
            self._disconnect_event.set()

        last_error: Exception | None = None

        for connect_attempt in range(3):
            try:
                target = self._discovered_devices.get(device_id)
                if target is None:
                    resolved_device = await BleakScanner.find_device_by_address(
                        device_id, timeout=4.0, **bleak_kwargs
                    )
                    target = resolved_device or device_id

                async with BleakClient(target, disconnected_callback=on_disconnect, **bleak_kwargs) as client:
                    measurement_char = None
                    available_chars: list[str] = []

                    # Some stacks populate GATT data slightly later; retry briefly.
                    for attempt in range(3):
                        services = client.services
                        if services is None or not services.services:
                            refresh_services = getattr(client, "get_services", None)
                            if callable(refresh_services):
                                maybe_services = await refresh_services()
                                if maybe_services is not None:
                                    services = maybe_services
                            if services is None or not services.services:
                                if attempt < 2:
                                    await asyncio.sleep(0.25)
                                continue
                        measurement_char = (
                            services.get_characteristic(CSC_MEASUREMENT)
                            or services.get_characteristic(CSC_MEASUREMENT_SHORT)
                        )

                        if measurement_char is None:
                            for service in services:
                                for char in service.characteristics:
                                    available_chars.append(f"{service.uuid}/{char.uuid}")
                                    if normalize_uuid(char.uuid) == CSC_MEASUREMENT:
                                        measurement_char = char
                                        break
                                if measurement_char is not None:
                                    break

                        if measurement_char is not None:
                            break
                        if attempt < 2:
                            await asyncio.sleep(0.25)

                    if measurement_char is None:
                        known = ", ".join(sorted(set(available_chars))) or "none"
                        raise RuntimeError(
                            f"Characteristic {CSC_MEASUREMENT} was not found. "
                            f"Discovered characteristics: {known}. "
                            f"If using emulator on dongle, try BLEAK_ADAPTER=hci0."
                        )

                    async def on_notify(_char, data: bytearray) -> None:
                        emit({"type": "data", "raw": list(data)})

                    await client.start_notify(measurement_char, on_notify)
                    emit({"type": "connected"})

                    await self._disconnect_event.wait()
                    self._disconnect_event.clear()

                    try:
                        await client.stop_notify(measurement_char)
                    except Exception:
                        pass

                    return
            except Exception as exc:
                last_error = exc
                if connect_attempt < 2:
                    await asyncio.sleep(0.4)
                    continue

        emit({"type": "error", "message": str(last_error) if last_error else "BLE connect failed"})


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
                manager.request_connect()
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
