use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use reqwest::blocking::Client;
use tauri::{Emitter, Manager};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn playback_capabilities(app: tauri::AppHandle) -> serde_json::Value {
    let runtime_dir = find_mpv_runtime_dir(&app);
    let mpv_path = runtime_dir
        .as_ref()
        .map(|dir| dir.join("mpv.exe"))
        .filter(|path| path.exists());

    serde_json::json!({
        "mpvBundled": mpv_path.is_some(),
        "mpvPath": mpv_path.map(|path| path.display().to_string()),
        "backend": "mpv-wid",
        "libmpv": false,
        "exoPlayer": false,
        "platform": std::env::consts::OS,
        "formats": ["hls", "dash", "mkv", "hdr", "atmos", "external-subtitles"]
    })
}

#[tauri::command]
fn fetch_introdb_segments(
    imdb_id: String,
    season: u32,
    episode: u32,
) -> Result<serde_json::Value, String> {
    if !imdb_id.starts_with("tt") {
        return Err(String::from("IMDb id invalido."));
    }
    if season == 0 || episode == 0 {
        return Err(String::from("Season/episode invalidos."));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("No se pudo crear cliente HTTP: {}", error))?;

    let response = client
        .get("https://api.introdb.app/segments")
        .query(&[
            ("imdb_id", imdb_id.as_str()),
            ("season", &season.to_string()),
            ("episode", &episode.to_string()),
        ])
        .send()
        .map_err(|error| format!("IntroDB request error: {}", error))?;

    if !response.status().is_success() {
        return Ok(serde_json::json!({}));
    }

    response
        .json::<serde_json::Value>()
        .map_err(|error| format!("Respuesta IntroDB invalida: {}", error))
}

#[tauri::command]
fn toggle_window_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IsZoomed, ShowWindow, SW_MAXIMIZE, SW_RESTORE,
        };

        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as _;
        unsafe {
            if IsZoomed(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            } else {
                ShowWindow(hwnd, SW_MAXIMIZE);
            }
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        if window.is_maximized().map_err(|error| error.to_string())? {
            window.unmaximize().map_err(|error| error.to_string())
        } else {
            window.maximize().map_err(|error| error.to_string())
        }
    }
}

#[tauri::command]
fn toggle_window_fullscreen(window: tauri::WebviewWindow) -> Result<(), String> {
    let is_fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(!is_fullscreen)
        .map_err(|error| error.to_string())
}

#[derive(Default)]
struct MpvState {
    lifecycle: Mutex<()>,
    session: Mutex<Option<MpvSession>>,
}

struct MpvSession {
    child: Child,
    pipe_name: String,
}

impl MpvSession {
    fn stop(mut self) {
        let _ = send_mpv_ipc(&self.pipe_name, serde_json::json!(["quit"]));
        for _ in 0..20 {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn stop_current_mpv(state: &MpvState) {
    let session = match state.session.lock() {
        Ok(mut current) => current.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    if let Some(session) = session {
        session.stop();
    }
}

fn current_pipe(state: &MpvState) -> Result<String, String> {
    let mut current = state
        .session
        .lock()
        .map_err(|_| String::from("No se pudo acceder a la sesion de MPV."))?;

    if let Some(session) = current.as_mut() {
        if matches!(session.child.try_wait(), Ok(Some(_))) {
            *current = None;
            return Err(String::from("MPV ya se cerro."));
        }
        Ok(session.pipe_name.clone())
    } else {
        Err(String::from("MPV no esta iniciado."))
    }
}

fn find_mpv_runtime_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    for root in roots {
        let candidates = [
            root.join("bin").join("mpv"),
            root.join("mpv"),
            root.join("resources").join("bin").join("mpv"),
        ];
        for candidate in candidates {
            if candidate.join("mpv.exe").exists() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn prepare_mpv_parent_window(hwnd: isize) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
    };

    unsafe {
        let hwnd = hwnd as _;
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let next_style = style | WS_CLIPCHILDREN as isize | WS_CLIPSIBLINGS as isize;
        if next_style != style {
            SetWindowLongPtrW(hwnd, GWL_STYLE, next_style);
            SetWindowPos(
                hwnd,
                0 as _,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

fn pipe_path(pipe_name: &str) -> String {
    format!(r"\\.\pipe\{}", pipe_name)
}

fn looks_like_youtube_url(target: &str) -> bool {
    let value = target.to_ascii_lowercase();
    value.contains("youtube.com/watch")
        || value.contains("youtu.be/")
        || value.contains("youtube.com/shorts/")
        || value.contains("youtube.com/embed/")
}

struct ResolvedPlaybackTarget {
    target: String,
    audio_file: Option<String>,
}

fn fallback_playback_target(target: &str) -> ResolvedPlaybackTarget {
    ResolvedPlaybackTarget {
        target: target.to_string(),
        audio_file: None,
    }
}

fn resolve_ytdlp_playback_target(runtime_dir: &PathBuf, target: &str) -> ResolvedPlaybackTarget {
    if !looks_like_youtube_url(target) {
        return fallback_playback_target(target);
    }

    let ytdlp_path = runtime_dir.join("yt-dlp.exe");
    if !ytdlp_path.exists() {
        return fallback_playback_target(target);
    }

    let output = Command::new(&ytdlp_path)
        .current_dir(runtime_dir)
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("-f")
        .arg("bestvideo*+bestaudio/best")
        .arg("-g")
        .arg(target)
        .stdin(Stdio::null())
        .output();

    let output = match output {
        Ok(output) if output.status.success() => output,
        _ => return fallback_playback_target(target),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let urls: Vec<String> = stdout
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("http://") || line.starts_with("https://"))
        .map(ToOwned::to_owned)
        .collect();

    match urls.as_slice() {
        [video_url, audio_url, ..] => ResolvedPlaybackTarget {
            target: video_url.clone(),
            audio_file: Some(audio_url.clone()),
        },
        [url] => ResolvedPlaybackTarget {
            target: url.clone(),
            audio_file: None,
        },
        _ => fallback_playback_target(target),
    }
}

fn wait_for_pipe(pipe_name: &str) -> Result<(), String> {
    let path = pipe_path(pipe_name);
    for _ in 0..80 {
        if OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .is_ok()
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err(String::from("MPV no abrio el canal IPC a tiempo."))
}

fn send_mpv_ipc(pipe_name: &str, command: serde_json::Value) -> Result<serde_json::Value, String> {
    let path = pipe_path(pipe_name);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|error| format!("No se pudo conectar al IPC de MPV: {}", error))?;
    let mut writer = file
        .try_clone()
        .map_err(|error| format!("No se pudo preparar IPC de MPV: {}", error))?;
    let mut reader = BufReader::new(file);
    let request = serde_json::json!({ "command": command });
    writeln!(writer, "{}", request)
        .map_err(|error| format!("No se pudo escribir al IPC de MPV: {}", error))?;
    writer
        .flush()
        .map_err(|error| format!("No se pudo enviar comando a MPV: {}", error))?;

    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|error| format!("No se pudo leer respuesta de MPV: {}", error))?;
    serde_json::from_str(line.trim()).map_err(|error| format!("Respuesta IPC invalida: {}", error))
}

fn mpv_properties(pipe_name: &str, names: &[&str]) -> HashMap<String, serde_json::Value> {
    let mut values = HashMap::new();
    let path = pipe_path(pipe_name);
    let file = match OpenOptions::new().read(true).write(true).open(&path) {
        Ok(file) => file,
        Err(_) => return values,
    };
    let mut writer = match file.try_clone() {
        Ok(writer) => writer,
        Err(_) => return values,
    };
    let mut reader = BufReader::new(file);

    for (index, name) in names.iter().enumerate() {
        let request = serde_json::json!({
            "command": ["get_property", name],
            "request_id": index
        });
        if writeln!(writer, "{}", request).is_err() {
            return values;
        }
    }
    if writer.flush().is_err() {
        return values;
    }

    for _ in names {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            break;
        }
        let response: serde_json::Value = match serde_json::from_str(line.trim()) {
            Ok(response) => response,
            Err(_) => continue,
        };
        let request_id = response
            .get("request_id")
            .and_then(|value| value.as_u64())
            .map(|value| value as usize);
        if let Some(index) = request_id.filter(|index| *index < names.len()) {
            values.insert(
                names[index].to_string(),
                response
                    .get("data")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            );
        }
    }

    values
}

fn mpv_status_snapshot(pipe_name: &str) -> serde_json::Value {
    let values = mpv_properties(
        pipe_name,
        &[
            "time-pos",
            "duration",
            "pause",
            "sid",
            "aid",
            "speed",
            "file-loaded",
            "paused-for-cache",
            "cache-buffering-state",
            "chapter",
            "chapter-list",
            "track-list",
        ],
    );

    let get = |name: &str| values.get(name).cloned().unwrap_or(serde_json::Value::Null);

    serde_json::json!({
        "timePos": get("time-pos"),
        "duration": get("duration"),
        "pause": get("pause"),
        "sid": get("sid"),
        "aid": get("aid"),
        "speed": get("speed"),
        "fileLoaded": get("file-loaded"),
        "pausedForCache": get("paused-for-cache"),
        "cacheBufferingState": get("cache-buffering-state"),
        "chapter": get("chapter"),
        "chapterList": get("chapter-list"),
        "tracks": get("track-list"),
    })
}

fn emit_mpv_startup_status(app: tauri::AppHandle, window_label: String, pipe_name: String) {
    thread::spawn(move || {
        for _ in 0..12 {
            thread::sleep(Duration::from_millis(500));
            let snapshot = mpv_status_snapshot(&pipe_name);
            let _ = app.emit_to(
                &window_label,
                "mpv-event",
                serde_json::json!({
                    "event": "status",
                    "snapshot": snapshot,
                }),
            );
        }
    });
}

#[derive(Clone, Copy)]
struct CropRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl CropRect {
    fn mpv_value(self) -> String {
        format!("{}x{}+{}+{}", self.width, self.height, self.x, self.y)
    }
}

fn is_black_bar_pixel(pixel: &image::Rgb<u8>) -> bool {
    let [r, g, b] = pixel.0;
    let luma = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;
    luma <= 28.0 && r <= 48 && g <= 48 && b <= 48
}

fn sampled_row_is_black(image: &image::RgbImage, y: u32, x_start: u32, x_end: u32) -> bool {
    if x_end <= x_start {
        return false;
    }

    let step = ((x_end - x_start) / 240).max(1) as usize;
    let mut total = 0usize;
    let mut black = 0usize;

    for x in (x_start..x_end).step_by(step) {
        total += 1;
        if is_black_bar_pixel(image.get_pixel(x, y)) {
            black += 1;
        }
    }

    total > 0 && (black as f32 / total as f32) >= 0.965
}

fn sampled_col_is_black(image: &image::RgbImage, x: u32, y_start: u32, y_end: u32) -> bool {
    if y_end <= y_start {
        return false;
    }

    let step = ((y_end - y_start) / 240).max(1) as usize;
    let mut total = 0usize;
    let mut black = 0usize;

    for y in (y_start..y_end).step_by(step) {
        total += 1;
        if is_black_bar_pixel(image.get_pixel(x, y)) {
            black += 1;
        }
    }

    total > 0 && (black as f32 / total as f32) >= 0.965
}

fn even_floor(value: u32) -> u32 {
    value & !1
}

fn detect_black_bar_crop(path: &PathBuf) -> Result<Option<CropRect>, String> {
    let image = image::ImageReader::open(path)
        .map_err(|error| format!("No se pudo abrir screenshot de MPV: {}", error))?
        .decode()
        .map_err(|error| format!("No se pudo leer screenshot de MPV: {}", error))?
        .to_rgb8();
    let width = image.width();
    let height = image.height();

    if width < 320 || height < 180 {
        return Ok(None);
    }

    let x_margin = (width / 50).max(4);
    let y_margin = (height / 50).max(4);
    let min_horizontal_bar = (height / 40).max(8);
    let min_vertical_bar = (width / 40).max(8);

    let mut top = 0;
    while top < height / 2 && sampled_row_is_black(&image, top, x_margin, width - x_margin) {
        top += 1;
    }

    let mut bottom = 0;
    while bottom < height / 2
        && sampled_row_is_black(&image, height - 1 - bottom, x_margin, width - x_margin)
    {
        bottom += 1;
    }

    let use_horizontal = top >= min_horizontal_bar
        && bottom >= min_horizontal_bar
        && top + bottom < (height * 45 / 100);
    if !use_horizontal {
        top = 0;
        bottom = 0;
    }

    let y_start = top.max(y_margin);
    let y_end = height.saturating_sub(bottom.max(y_margin));
    let mut left = 0;
    while left < width / 2 && sampled_col_is_black(&image, left, y_start, y_end) {
        left += 1;
    }

    let mut right = 0;
    while right < width / 2 && sampled_col_is_black(&image, width - 1 - right, y_start, y_end) {
        right += 1;
    }

    let use_vertical =
        left >= min_vertical_bar && right >= min_vertical_bar && left + right < (width * 45 / 100);
    if !use_vertical {
        left = 0;
        right = 0;
    }

    if top == 0 && bottom == 0 && left == 0 && right == 0 {
        return Ok(None);
    }

    let x = even_floor(left);
    let y = even_floor(top);
    let crop_width = even_floor(width.saturating_sub(left + right));
    let crop_height = even_floor(height.saturating_sub(top + bottom));

    if crop_width < width / 2 || crop_height < height / 2 {
        return Ok(None);
    }

    Ok(Some(CropRect {
        x,
        y,
        width: crop_width,
        height: crop_height,
    }))
}

fn wait_for_screenshot(path: &PathBuf) -> bool {
    for _ in 0..40 {
        if path.exists()
            && path
                .metadata()
                .map(|metadata| metadata.len() > 0)
                .unwrap_or(false)
        {
            return true;
        }
        thread::sleep(Duration::from_millis(50));
    }
    false
}

fn send_mpv_command_ignore(pipe_name: &str, command: serde_json::Value) {
    let _ = send_mpv_ipc(pipe_name, command);
}

fn reset_mpv_crop_state(pipe_name: &str) {
    send_mpv_command_ignore(
        pipe_name,
        serde_json::json!(["set_property", "video-crop", ""]),
    );
    send_mpv_command_ignore(pipe_name, serde_json::json!(["set_property", "panscan", 0]));
    send_mpv_command_ignore(
        pipe_name,
        serde_json::json!(["set_property", "video-zoom", 0]),
    );
    send_mpv_command_ignore(
        pipe_name,
        serde_json::json!(["set_property", "video-align-x", 0]),
    );
    send_mpv_command_ignore(
        pipe_name,
        serde_json::json!(["set_property", "video-align-y", 0]),
    );
}

fn normalize_command(command: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    if command.is_empty() {
        return Err(String::from("Comando MPV invalido."));
    }
    Ok(serde_json::Value::Array(command))
}

#[tauri::command]
fn open_mpv(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MpvState>,
    target: String,
    subtitle: Option<String>,
    headers: Option<HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    if target.trim().is_empty() {
        return Err(String::from("La fuente no tiene URL reproducible."));
    }

    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| String::from("No se pudo acceder al ciclo de vida de MPV."))?;
    stop_current_mpv(&state);

    let runtime_dir = find_mpv_runtime_dir(&app).ok_or_else(|| {
        String::from("MPV interno no esta instalado. Coloca mpv.exe y sus DLLs en src-tauri/bin/mpv antes de empaquetar.")
    })?;
    let mpv_path = runtime_dir.join("mpv.exe");
    let ytdlp_path = runtime_dir.join("yt-dlp.exe");
    let playback_target = resolve_ytdlp_playback_target(&runtime_dir, &target);
    let log_path = std::env::temp_dir().join("aetherio-mpv.log");
    let pipe_name = format!("aetherio-mpv-{}", std::process::id());

    let _ = window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
    let window_label = window.label().to_string();

    #[cfg(target_os = "windows")]
    let parent_hwnd = {
        let parent_hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        prepare_mpv_parent_window(parent_hwnd);
        parent_hwnd
    };
    #[cfg(not(target_os = "windows"))]
    let parent_hwnd = 0isize;

    let mut command = Command::new(&mpv_path);
    command
        .current_dir(&runtime_dir)
        .arg("--no-terminal")
        .arg("--force-window=immediate")
        .arg(format!("--wid={}", parent_hwnd))
        .arg("--idle=no")
        .arg("--pause=no")
        .arg("--keep-open=no")
        .arg("--resume-playback=no")
        .arg("--cache=yes")
        .arg("--cache-pause=yes")
        .arg("--cache-pause-initial=no")
        .arg("--cache-pause-wait=1")
        .arg("--hwdec=auto-safe")
        .arg("--vo=gpu-next")
        .arg("--gpu-api=d3d11")
        .arg("--osc=no")
        .arg("--input-default-bindings=yes")
        .arg("--input-vo-keyboard=yes")
        .arg("--ao=wasapi")
        .arg("--audio-channels=auto-safe")
        .arg("--sub-auto=fuzzy")
        .arg("--cookies=yes")
        .arg("--ytdl=yes")
        .arg("--ytdl-format=bestvideo*+bestaudio/best")
        .arg("--demuxer-max-bytes=512MiB")
        .arg("--demuxer-max-back-bytes=128MiB")
        .arg(format!("--input-ipc-server={}", pipe_path(&pipe_name)))
        .arg(format!("--log-file={}", log_path.display()));

    if let Some(headers) = headers {
        let mut header_fields: Vec<String> = Vec::new();
        for (key, value) in headers {
            let normalized_key = key.trim();
            let normalized_value = value.trim();
            if normalized_key.is_empty() || normalized_value.is_empty() {
                continue;
            }
            // mpv list option parser uses comma separators, so keep values comma-safe.
            header_fields.push(format!(
                "{}: {}",
                normalized_key,
                normalized_value.replace(',', " ")
            ));
        }
        if !header_fields.is_empty() {
            command.arg(format!("--http-header-fields={}", header_fields.join(",")));
        }
    }

    if ytdlp_path.exists() {
        command.arg(format!(
            "--script-opts=ytdl_hook-ytdl_path={}",
            ytdlp_path.display()
        ));
    }

    if let Some(audio_file) = playback_target.audio_file.as_ref() {
        command.arg(format!("--audio-file={}", audio_file));
    }

    if let Some(subtitle_url) = subtitle.as_ref().filter(|value| !value.trim().is_empty()) {
        command.arg(format!("--sub-file={}", subtitle_url));
    }

    let mut child = command
        .arg(&playback_target.target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("No se pudo iniciar MPV interno: {}", error))?;

    if let Err(error) = wait_for_pipe(&pipe_name) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    if let Some(subtitle_url) = subtitle.as_ref().filter(|value| !value.trim().is_empty()) {
        let _ = send_mpv_ipc(
            &pipe_name,
            serde_json::json!(["sub-add", subtitle_url, "select"]),
        );
    }
    let pid = child.id();
    {
        let mut current = state
            .session
            .lock()
            .map_err(|_| String::from("No se pudo guardar la sesion de MPV."))?;
        *current = Some(MpvSession {
            child,
            pipe_name: pipe_name.clone(),
        });
    }

    let _ = app.emit_to(
        &window_label,
        "mpv-event",
        serde_json::json!({
            "event": "open",
            "target": target,
            "resolvedTarget": playback_target.target,
            "resolvedAudio": playback_target.audio_file,
            "snapshot": mpv_status_snapshot(&pipe_name),
        }),
    );
    emit_mpv_startup_status(app.clone(), window_label, pipe_name.clone());

    Ok(serde_json::json!({
        "pid": pid,
        "backend": "mpv-wid",
        "embedded": true,
        "runtimePath": runtime_dir.display().to_string(),
        "logPath": log_path.display().to_string()
    }))
}

#[tauri::command]
fn mpv_command(
    state: tauri::State<'_, MpvState>,
    command: Vec<serde_json::Value>,
) -> Result<(), String> {
    let pipe_name = current_pipe(&state)?;
    let command = normalize_command(command)?;
    let response = send_mpv_ipc(&pipe_name, command)?;
    let error = response.get("error").and_then(|value| value.as_str());
    if matches!(error, Some(value) if value != "success") {
        Err(format!(
            "MPV devolvio un error: {}",
            error.unwrap_or("unknown")
        ))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn mpv_autocrop(
    state: tauri::State<'_, MpvState>,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let pipe_name = current_pipe(&state)?;
    reset_mpv_crop_state(&pipe_name);

    if !enabled {
        return Ok(serde_json::json!({
            "enabled": false,
            "sourceCropApplied": false,
            "crop": serde_json::Value::Null
        }));
    }

    let screenshot_path = std::env::temp_dir().join(format!(
        "aetherio-autocrop-{}-{}.png",
        std::process::id(),
        chrono_like_timestamp()
    ));
    let _ = fs::remove_file(&screenshot_path);

    let mut warning: Option<String> = None;
    let screenshot_command = serde_json::json!([
        "screenshot-to-file",
        screenshot_path.display().to_string(),
        "video"
    ]);
    match send_mpv_ipc(&pipe_name, screenshot_command) {
        Ok(response) => {
            let error = response.get("error").and_then(|value| value.as_str());
            if matches!(error, Some(value) if value != "success") {
                warning = Some(format!(
                    "MPV no pudo capturar frame para autocrop: {}",
                    error.unwrap_or("unknown")
                ));
            }
        }
        Err(error) => warning = Some(error),
    }

    let crop = if warning.is_none() && wait_for_screenshot(&screenshot_path) {
        match detect_black_bar_crop(&screenshot_path) {
            Ok(value) => value,
            Err(error) => {
                warning = Some(error);
                None
            }
        }
    } else {
        if warning.is_none() {
            warning = Some(String::from(
                "MPV no genero screenshot para detectar franjas.",
            ));
        }
        None
    };
    let _ = fs::remove_file(&screenshot_path);

    send_mpv_command_ignore(
        &pipe_name,
        serde_json::json!(["set_property", "panscan", 1]),
    );
    if let Some(rect) = crop {
        let crop_value = rect.mpv_value();
        send_mpv_command_ignore(
            &pipe_name,
            serde_json::json!(["set_property", "video-crop", crop_value]),
        );
        Ok(serde_json::json!({
            "enabled": true,
            "sourceCropApplied": true,
            "crop": rect.mpv_value(),
            "warning": warning
        }))
    } else {
        Ok(serde_json::json!({
            "enabled": true,
            "sourceCropApplied": false,
            "crop": serde_json::Value::Null,
            "warning": warning
        }))
    }
}

fn chrono_like_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[tauri::command]
fn mpv_status(state: tauri::State<'_, MpvState>) -> Result<serde_json::Value, String> {
    let pipe_name = current_pipe(&state)?;
    Ok(mpv_status_snapshot(&pipe_name))
}

#[tauri::command]
fn stop_mpv(state: tauri::State<'_, MpvState>) -> Result<(), String> {
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| String::from("No se pudo acceder al ciclo de vida de MPV."))?;
    stop_current_mpv(&state);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(MpvState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            playback_capabilities,
            fetch_introdb_segments,
            toggle_window_maximize,
            toggle_window_fullscreen,
            open_mpv,
            mpv_command,
            mpv_autocrop,
            mpv_status,
            stop_mpv
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<MpvState>();
                stop_current_mpv(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
