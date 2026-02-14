#!/usr/bin/env python3
import asyncio
import time
from bleak import BleakScanner, BleakClient

# BLE UUIDs (Bluetooth Cycling Speed & Cadence)
CSC_MEASUREMENT = "00002a5b-0000-1000-8000-00805f9b34fb"

# Pas dit eventueel aan:
DEVICE_NAME_PREFIX = "deskbike"  # jouw device heet "deskbike-13851"
WHEEL_CIRCUMFERENCE_M = 2.10  # calibration factor (2.10m = grove default)

TICKS_PER_SEC = 1024.0

state = {
    "last_wheel_revs": None,
    "last_wheel_time": None,
    "last_crank_revs": None,
    "last_crank_time": None,
    "distance_m": 0.0,
    "last_print": 0.0,
}


def u16_delta(new, old):
    return (new - old) & 0xFFFF


def u32_delta(new, old):
    return (new - old) & 0xFFFFFFFF


def handler(_, data: bytearray):
    flags = data[0]
    idx = 1

    wheel_present = flags & 0x01
    crank_present = flags & 0x02

    wheel_revs = wheel_time = None
    crank_revs = crank_time = None

    if wheel_present:
        wheel_revs = int.from_bytes(data[idx : idx + 4], "little")
        idx += 4
        wheel_time = int.from_bytes(data[idx : idx + 2], "little")
        idx += 2

    if crank_present:
        crank_revs = int.from_bytes(data[idx : idx + 2], "little")
        idx += 2
        crank_time = int.from_bytes(data[idx : idx + 2], "little")
        idx += 2

    # Speed + distance from wheel
    speed_kmh = None
    if wheel_present and state["last_wheel_revs"] is not None:
        d_revs = u32_delta(wheel_revs, state["last_wheel_revs"])
        d_time = u16_delta(wheel_time, state["last_wheel_time"])
        if d_time > 0:
            dt = d_time / TICKS_PER_SEC
            dist_m = d_revs * WHEEL_CIRCUMFERENCE_M
            state["distance_m"] += dist_m
            speed_kmh = (dist_m / dt) * 3.6

    # Cadence from crank
    cadence_rpm = None
    if crank_present and state["last_crank_revs"] is not None:
        d_revs = u16_delta(crank_revs, state["last_crank_revs"])
        d_time = u16_delta(crank_time, state["last_crank_time"])
        if d_time > 0:
            dt = d_time / TICKS_PER_SEC
            cadence_rpm = (d_revs / dt) * 60.0

    # Update state
    if wheel_present:
        state["last_wheel_revs"] = wheel_revs
        state["last_wheel_time"] = wheel_time
    if crank_present:
        state["last_crank_revs"] = crank_revs
        state["last_crank_time"] = crank_time

    # Print max 4x/sec
    now = time.time()
    if now - state["last_print"] > 0.25:
        state["last_print"] = now
        parts = []
        if cadence_rpm is not None:
            parts.append(f"cadence={cadence_rpm:5.1f} rpm")
        if speed_kmh is not None:
            parts.append(f"speed={speed_kmh:5.1f} km/h")
        parts.append(f"dist={state['distance_m'] / 1000:7.3f} km")
        print(" | ".join(parts), flush=True)


async def main():
    print("Scanning... trap nu (10s) zodat de sensor blijft adverteren.")
    dev = await BleakScanner.find_device_by_filter(
        lambda d, ad: (d.name or "").lower().startswith(DEVICE_NAME_PREFIX),
        timeout=10.0,
    )
    if not dev:
        print(
            "Geen deskbike device gevonden. Tip: blijf trappen tijdens scan, en zorg dat telefoon-app los is."
        )
        return

    print(f"Found: {dev.address} {dev.name}")
    print("Connecting...")

    async with BleakClient(dev) as client:
        print("Connected:", client.is_connected)
        print("Subscribing to CSC Measurement notifications...")
        await client.start_notify(CSC_MEASUREMENT, handler)
        print("Listening... trap nu. Ctrl+C om te stoppen.")
        try:
            while True:
                await asyncio.sleep(1)
        finally:
            try:
                await client.stop_notify(CSC_MEASUREMENT)
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(main())
