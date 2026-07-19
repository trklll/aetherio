# Internal libmpv Runtime

Place the Windows libmpv runtime here before packaging. Aetherio loads
`libmpv-2.dll` through the libmpv C API inside the Tauri process and injects
the Tauri window HWND with the `wid` option:

- `libmpv-2.dll`
- the DLL files distributed with the same libmpv/MPV build
- `yt-dlp.exe` for resolving YouTube trailer URLs inside libmpv

`mpv.exe` is no longer used for playback and should not be bundled for the
player path. The app now requires `libmpv-2.dll`.

This folder is included in the Tauri bundle through `tauri.conf.json`.
