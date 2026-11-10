"""Send actual Windows wheel input to a specific, visible Tauri process."""
import argparse
import ctypes
import json
import time
from ctypes import wintypes

parser = argparse.ArgumentParser()
parser.add_argument("--pid", required=True, type=int)
parser.add_argument("--ticks", type=int, default=0)
parser.add_argument("--interval-ms", type=float, default=100)
parser.add_argument("--direction", choices=["down", "up"], default="down")
args = parser.parse_args()
user32 = ctypes.windll.user32
user32.GetForegroundWindow.restype = wintypes.HWND
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetDpiForWindow.argtypes = [wintypes.HWND]
user32.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t]
user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
windows = []

@ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
def collect(hwnd, _):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value == args.pid and user32.IsWindowVisible(hwnd):
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        windows.append(((rect.right - rect.left) * (rect.bottom - rect.top), hwnd, rect))
    return True

user32.EnumWindows(collect, 0)
if not windows:
    raise RuntimeError(f"No visible window for PID {args.pid}")
_, hwnd, rect = max(windows, key=lambda entry: entry[0])
if user32.IsIconic(hwnd):
    user32.ShowWindow(hwnd, 9)
user32.BringWindowToTop(hwnd)
user32.SetForegroundWindow(hwnd)
if user32.GetForegroundWindow() != hwnd:
    foreground = user32.GetForegroundWindow()
    foreground_thread = user32.GetWindowThreadProcessId(foreground, None)
    own_thread = ctypes.windll.kernel32.GetCurrentThreadId()
    user32.AttachThreadInput(own_thread, foreground_thread, True)
    try:
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
    finally:
        user32.AttachThreadInput(own_thread, foreground_thread, False)
    if user32.GetForegroundWindow() != hwnd:
        raise RuntimeError("Tauri could not be foregrounded; refusing a background measurement")

x = rect.left + round((rect.right - rect.left) * 0.55)
y = rect.top + round((rect.bottom - rect.top) * 0.72)
user32.SetCursorPos(x, y)
start = time.perf_counter()
for tick in range(args.ticks):
    if user32.GetForegroundWindow() != hwnd:
        raise RuntimeError("Foreground window changed during wheel input")
    # Windows wheel delta, not a synthetic DOM WheelEvent or scrollTop write.
    delta = -120 if args.direction == "down" else 120
    user32.mouse_event(0x0800, 0, 0, ctypes.c_uint32(delta).value, 0)
    # Deliberate input pacing is part of the experiment, not readiness polling.
    remaining = start + (tick + 1) * args.interval_ms / 1000 - time.perf_counter()
    if remaining > 0:
        time.sleep(remaining)
print(json.dumps({
    "pid": args.pid, "hwnd": int(hwnd), "ticks": args.ticks,
    "durationMs": round((time.perf_counter() - start) * 1000, 1),
    "cursor": [x, y], "dpi": user32.GetDpiForWindow(hwnd),
    "window": [rect.left, rect.top, rect.right, rect.bottom],
    "foreground": user32.GetForegroundWindow() == hwnd,
}))
