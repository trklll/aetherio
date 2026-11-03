"""Bounded, local HLS checks against the bundled libmpv (no application window).

Run: python scripts/iptv-native-smoke.py --profile both --runs 3
Requires the existing ffmpeg executable and src-tauri/bin/mpv/libmpv-2.dll.
Fixtures live in a temporary directory; no production data is changed.
"""

import argparse
import ctypes as c
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = Path(__file__).resolve().parents[1]
BASELINE = "reconnect=1,reconnect_streamed=1,reconnect_delay_max=4"


class Event(c.Structure):
    _fields_ = [("id", c.c_int), ("error", c.c_int), ("reply", c.c_uint64), ("data", c.c_void_p)]


class EndFile(c.Structure):
    _fields_ = [("reason", c.c_int), ("error", c.c_int)]


class LogMessage(c.Structure):
    _fields_ = [("prefix", c.c_char_p), ("level", c.c_char_p), ("text", c.c_char_p), ("log_level", c.c_int)]


def load_mpv():
    runtime = ROOT / "src-tauri/bin/mpv"
    dll_dir = os.add_dll_directory(str(runtime))
    dll = c.CDLL(str(runtime / "libmpv-2.dll"))
    signatures = {
        "mpv_create": (c.c_void_p, []),
        "mpv_initialize": (c.c_int, [c.c_void_p]),
        "mpv_set_option_string": (c.c_int, [c.c_void_p, c.c_char_p, c.c_char_p]),
        "mpv_command": (c.c_int, [c.c_void_p, c.POINTER(c.c_char_p)]),
        "mpv_wait_event": (c.POINTER(Event), [c.c_void_p, c.c_double]),
        "mpv_get_property_string": (c.c_void_p, [c.c_void_p, c.c_char_p]),
        "mpv_free": (None, [c.c_void_p]),
        "mpv_terminate_destroy": (None, [c.c_void_p]),
        "mpv_request_log_messages": (c.c_int, [c.c_void_p, c.c_char_p]),
    }
    for name, (result, args) in signatures.items():
        function = getattr(dll, name)
        function.restype, function.argtypes = result, args
    return dll, dll_dir


def run_case(dll, segments, profile, scenario, options, remote_url=None):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            requests.append(self.path)
            if self.path == "/live.m3u8":
                count = requests.count(self.path)
                status = 404 if scenario == "missing-404" else 503 if scenario == "persistent-503" or scenario == "transient-503" and count == 1 else 200
                if status != 200:
                    self.send_response(status)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                body = ("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n"
                        + "".join(f"#EXTINF:2,\n/seg-{index:02}.ts\n" for index in range(len(segments)))).encode()
                content_type = "application/vnd.apple.mpegurl"
            else:
                match = re.fullmatch(r"/seg-(\d+)\.ts", self.path)
                if not match or int(match[1]) >= len(segments):
                    self.send_error(404)
                    return
                body = segments[int(match[1])]
                content_type = "video/mp2t"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    core = dll.mpv_create()
    started = time.perf_counter()
    first_frame = None
    end_reason = None
    error_code = None
    http_status = None
    try:
        for name, value in {
            "terminal": "no", "vo": "null", "ao": "null", "idle": "yes", "pause": "no",
            "cache": "yes", "cache-pause-initial": "no", "network-timeout": "5",
            "cache-secs": "2", "demuxer-readahead-secs": "3", "ytdl": "no",
            "demuxer-lavf-o": options,
        }.items():
            code = dll.mpv_set_option_string(core, name.encode(), value.encode())
            if code < 0:
                raise RuntimeError(f"libmpv rejected {name}: {code}")
        if profile == "current":
            code = dll.mpv_set_option_string(core, b"stream-lavf-o", options.encode())
            if code < 0:
                raise RuntimeError(f"libmpv rejected stream-lavf-o: {code}")
        dll.mpv_request_log_messages(core, b"warn")
        if dll.mpv_initialize(core) < 0:
            raise RuntimeError("libmpv initialization failed")
        started = time.perf_counter()
        target = (remote_url or f"http://127.0.0.1:{server.server_port}/live.m3u8").encode()
        args = (c.c_char_p * 4)(b"loadfile", target, b"replace", None)
        if dll.mpv_command(core, args) < 0:
            raise RuntimeError("loadfile rejected")
        while time.perf_counter() - started < 10:
            event = dll.mpv_wait_event(core, 0.05).contents
            if event.id == 2 and event.data:
                message = c.cast(event.data, c.POINTER(LogMessage)).contents
                match = re.search(r"(?:HTTP error |Server returned )([45]\d{2})\b", (message.text or b"").decode(errors="replace"))
                if match:
                    http_status = int(match[1])
            if event.id == 21:  # playback-restart, the decoder began presenting
                first_frame = round((time.perf_counter() - started) * 1000, 2)
                break
            if event.id == 7 and event.data:
                end = c.cast(event.data, c.POINTER(EndFile)).contents
                end_reason, error_code = end.reason, end.error
                if end.reason != 5:  # playlist redirect is not a failed load
                    break
        version_ptr = dll.mpv_get_property_string(core, b"mpv-version")
        version = c.string_at(version_ptr).decode() if version_ptr else "unknown"
        if version_ptr:
            dll.mpv_free(version_ptr)
        return {
            "profile": profile, "scenario": scenario, "firstFrameMs": first_frame,
            "elapsedMs": round((time.perf_counter() - started) * 1000, 2),
            "manifestRequests": requests.count("/live.m3u8"),
            "segmentRequests": sum(path.endswith(".ts") for path in requests),
            "endReason": end_reason, "errorCode": error_code, "mpvVersion": version,
            "httpStatus": http_status,
        }
    finally:
        dll.mpv_terminate_destroy(core)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=["baseline", "current", "both"], default="both")
    parser.add_argument("--runs", type=int, default=3, choices=range(1, 6))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--url", help="Optional single remote HTTP(S) stream; URLs are not printed in reports")
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg and not args.url:
        raise SystemExit("ffmpeg is required; no dependencies were installed")
    module = (ROOT / "src-tauri/src/sports_hls.rs").read_text(encoding="utf-8")
    current = re.search(r'const RECONNECT: &str = "([^"]+)"', module)[1]
    profiles = {"baseline": BASELINE, "current": current} if args.profile == "both" else {args.profile: BASELINE if args.profile == "baseline" else current}
    dll, dll_dir = load_mpv()
    results = []
    try:
        if args.url:
            if not args.url.startswith(("http://", "https://")):
                raise SystemExit("Only HTTP(S) URLs are accepted")
            for profile, options in profiles.items():
                for _run in range(args.runs):
                    results.append(run_case(dll, [], profile, "remote", options, args.url))
        else:
            with tempfile.TemporaryDirectory(prefix="aetherio-iptv-", dir=os.environ.get("TEMP")) as directory:
                output = str(Path(directory) / "seg-%02d.ts")
                subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=15", "-t", "12",
                                "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-sc_threshold", "0", "-pix_fmt", "yuv420p",
                                "-f", "segment", "-segment_time", "2", "-segment_format", "mpegts", output], check=True, timeout=30)
                segments = [path.read_bytes() for path in sorted(Path(directory).glob("seg-*.ts"))]
                for profile, options in profiles.items():
                    for scenario in ["healthy", "transient-503", "persistent-503", "missing-404"]:
                        for _run in range(args.runs):
                            results.append(run_case(dll, segments, profile, scenario, options))
    finally:
        dll_dir.close()
    report = {"options": profiles, "results": results}
    serialized = json.dumps(report, indent=2)
    print(serialized)
    if args.output:
        args.output.write_text(serialized, encoding="utf-8")
    for result in results:
        if result["scenario"] == "healthy" or result["profile"] == "current" and result["scenario"] == "transient-503":
            if result["firstFrameMs"] is None:
                raise SystemExit("Native HLS recovery check failed")
        if result["scenario"] == "missing-404":
            if result["firstFrameMs"] is not None or result["manifestRequests"] != 1 or result["httpStatus"] != 404:
                raise SystemExit("A permanent HTTP error was retried or misclassified")
        if result["profile"] == "current" and result["scenario"] == "persistent-503":
            if result["firstFrameMs"] is not None or not 1 < result["manifestRequests"] <= 3 or result["httpStatus"] != 503:
                raise SystemExit("Native transient retries exceeded their budget or lost the error code")


if __name__ == "__main__":
    main()
