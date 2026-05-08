# Internal MPV Runtime

Place the Windows MPV runtime here before packaging. The bundled `mpv.exe`
is launched as an internal child process and embedded into the Tauri window with
`--wid=<HWND>`:

- `mpv.exe`
- the DLL files distributed with the same MPV build
- `yt-dlp.exe` for resolving YouTube trailer URLs inside the internal MPV player

At runtime Aetherio loads this bundled copy and injects the Tauri window HWND
into MPV so native video renders behind the transparent React controls.

This folder is included in the Tauri bundle through `tauri.conf.json`.
