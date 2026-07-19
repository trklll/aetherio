mod scraper;

use std::{
    collections::HashMap,
    ffi::{CStr, CString},
    fs::{self, OpenOptions},
    io::Write,
    os::raw::{c_char, c_int, c_void},
    path::{Path, PathBuf},
    ptr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use libloading::Library;
#[cfg(not(target_os = "android"))]
use librqbit::{
    http_api::{HttpApi, HttpApiOptions},
    Api, Session, SessionOptions,
};
use reqwest::blocking::Client;
#[cfg(not(target_os = "android"))]
use std::sync::mpsc;
#[cfg(target_os = "windows")]
use std::sync::{Once, OnceLock};
use tauri::{Emitter, Manager, Runtime};

#[cfg(target_os = "windows")]
static MOUSE_NAV_APP: OnceLock<tauri::AppHandle> = OnceLock::new();
#[cfg(target_os = "windows")]
static MOUSE_NAV_WINDOW_LABEL: OnceLock<String> = OnceLock::new();

#[tauri::command]
fn playback_capabilities(app: tauri::AppHandle) -> serde_json::Value {
    let runtime_dir = find_mpv_runtime_dir(&app);
    let libmpv_path = runtime_dir
        .as_ref()
        .map(|dir| dir.join(LIBMPV_DLL_NAME))
        .filter(|path| path.exists());

    serde_json::json!({
        "mpvBundled": libmpv_path.is_some(),
        "mpvPath": libmpv_path.as_ref().map(|path| path.display().to_string()),
        "libmpvPath": libmpv_path.map(|path| path.display().to_string()),
        "backend": "libmpv-capi",
        "libmpv": true,
        "exoPlayer": false,
        "platform": std::env::consts::OS,
        "formats": ["hls", "dash", "mkv", "hdr", "atmos", "external-subtitles", "p2p", "torrent", "magnet"]
    })
}

#[cfg(target_os = "android")]
struct AndroidPlayerPlugin<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidPlayerOpenArgs {
    target: String,
    subtitle: Option<String>,
    headers: Option<HashMap<String, String>>,
    file_idx: Option<usize>,
    start_time: Option<f64>,
}

#[cfg(target_os = "android")]
#[derive(serde::Serialize)]
struct AndroidPlayerCommandArgs {
    command: Vec<serde_json::Value>,
}

fn init_android_player_bridge<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("aetherio-player")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(
                    "com.administrator.aetherio.player",
                    "AetherioPlayerPlugin",
                )?;
                _app.manage(AndroidPlayerPlugin(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
fn run_android_player_plugin<R: Runtime, T: serde::de::DeserializeOwned>(
    app: tauri::AppHandle<R>,
    command: &str,
    payload: impl serde::Serialize,
) -> Result<T, String> {
    let handle = app.state::<AndroidPlayerPlugin<R>>();
    handle
        .0
        .run_mobile_plugin(command, payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn android_player_open<R: Runtime>(
    app: tauri::AppHandle<R>,
    target: String,
    subtitle: Option<String>,
    headers: Option<HashMap<String, String>>,
    file_idx: Option<usize>,
    start_time: Option<f64>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return run_android_player_plugin(
            app,
            "open",
            AndroidPlayerOpenArgs {
                target,
                subtitle,
                headers,
                file_idx,
                start_time,
            },
        );
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, target, subtitle, headers, file_idx, start_time);
        Err(String::from(
            "El reproductor Android TV solo esta disponible en Android.",
        ))
    }
}

#[tauri::command]
fn android_player_stop<R: Runtime>(app: tauri::AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return run_android_player_plugin(app, "stop", serde_json::json!({}));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
fn android_player_command<R: Runtime>(
    app: tauri::AppHandle<R>,
    command: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return run_android_player_plugin(app, "command", AndroidPlayerCommandArgs { command });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, command);
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
fn android_player_status<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        return run_android_player_plugin(app, "getLastSession", serde_json::json!({}));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(serde_json::json!({
            "timePos": 0,
            "duration": 0,
            "pause": true,
            "fileLoaded": false,
            "tracks": []
        }))
    }
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
fn fetch_mdblist_ratings(
    media_provider: Option<String>,
    media_id: Option<String>,
    media_type: String,
    api_key: String,
    providers: Vec<String>,
) -> Result<serde_json::Value, String> {
    let media_provider = media_provider
        .as_deref()
        .and_then(normalize_mdblist_media_provider)
        .unwrap_or("imdb");
    let media_id = media_id.unwrap_or_default().trim().to_string();
    let api_key = api_key.trim().to_string();
    if media_id.is_empty() {
        return Err(String::from("MDBList media id vacio."));
    }
    if api_key.is_empty() {
        return Err(String::from("MDBList API key vacia."));
    }
    if providers.is_empty() {
        return Err(String::from("MDBList providers vacios."));
    }

    let media_type = normalize_mdblist_media_type(&media_type);
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("No se pudo crear cliente MDBList: {}", error))?;
    let url = format!(
        "https://api.mdblist.com/{}/{}/{}",
        media_provider, media_type, media_id
    );
    let response = client
        .get(url)
        .query(&[("apikey", api_key.as_str())])
        .header("Accept", "application/json")
        .header("User-Agent", "Aetherio/0.1.0")
        .send()
        .map_err(|error| format!("No se pudo consultar MDBList: {}", error))?;
    if !response.status().is_success() {
        return Err(format!(
            "MDBList respondio con estado {}.",
            response.status()
        ));
    }
    response
        .json::<serde_json::Value>()
        .map_err(|error| format!("No se pudo leer respuesta MDBList: {}", error))
}

fn normalize_mdblist_media_type(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "movie" | "film" => "movie",
        _ => "show",
    }
}

fn normalize_mdblist_media_provider(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "imdb" => Some("imdb"),
        "tmdb" => Some("tmdb"),
        _ => None,
    }
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

    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        if window.is_maximized().map_err(|error| error.to_string())? {
            window.unmaximize().map_err(|error| error.to_string())
        } else {
            window.maximize().map_err(|error| error.to_string())
        }
    }

    #[cfg(target_os = "android")]
    {
        let _ = window;
        Ok(())
    }
}

#[tauri::command]
fn toggle_window_fullscreen(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let is_fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
        window
            .set_fullscreen(!is_fullscreen)
            .map_err(|error| error.to_string())
    }

    #[cfg(target_os = "android")]
    {
        let _ = window;
        Ok(())
    }
}

#[derive(Default)]
struct MpvState {
    lifecycle: Mutex<()>,
    session: Mutex<Option<MpvSession>>,
    open_generation: AtomicU64,
    last_status: Mutex<serde_json::Value>,
    #[cfg(target_os = "windows")]
    surface_rect: Mutex<Option<MpvSurfaceRect>>,
    #[cfg(target_os = "windows")]
    surface_visible: Mutex<bool>,
}

const LIBMPV_DLL_NAME: &str = "libmpv-2.dll";
const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;
const MPV_FORMAT_NODE: c_int = 6;
const MPV_FORMAT_NODE_ARRAY: c_int = 7;
const MPV_FORMAT_NODE_MAP: c_int = 8;
const MPV_EVENT_NONE: c_int = 0;
const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_EVENT_TRACKS_CHANGED: c_int = 9;
const MPV_EVENT_TRACK_SWITCHED: c_int = 10;
const MPV_EVENT_PAUSE: c_int = 12;
const MPV_EVENT_UNPAUSE: c_int = 13;
const MPV_EVENT_SEEK: c_int = 20;
const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;
const MAX_MPV_CSTRING_LEN: usize = 16_384;
const MAX_HTTP_HEADERS_TOTAL_LEN: usize = 8_192;
const MAX_HTTP_HEADER_VALUE_LEN: usize = 2_048;

#[repr(C)]
struct MpvHandle {
    _private: [u8; 0],
}

#[repr(C)]
union MpvNodeUnion {
    string: *mut c_char,
    flag: c_int,
    int64: i64,
    double_: f64,
    list: *mut MpvNodeList,
}

#[repr(C)]
struct MpvNode {
    u: MpvNodeUnion,
    format: c_int,
}

#[repr(C)]
struct MpvNodeList {
    num: c_int,
    values: *mut MpvNode,
    keys: *mut *mut c_char,
}

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[derive(Clone, Copy)]
struct MpvHandlePtr(*mut MpvHandle);

unsafe impl Send for MpvHandlePtr {}
unsafe impl Sync for MpvHandlePtr {}

struct MpvApi {
    _library: Library,
    create: unsafe extern "C" fn() -> *mut MpvHandle,
    initialize: unsafe extern "C" fn(*mut MpvHandle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(*mut MpvHandle),
    command_async: unsafe extern "C" fn(*mut MpvHandle, u64, *const *const c_char) -> c_int,
    set_option_string: unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int,
    observe_property: unsafe extern "C" fn(*mut MpvHandle, u64, *const c_char, c_int) -> c_int,
    wait_event: unsafe extern "C" fn(*mut MpvHandle, f64) -> *mut MpvEvent,
    event_name: unsafe extern "C" fn(c_int) -> *const c_char,
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
}

unsafe impl Send for MpvApi {}
unsafe impl Sync for MpvApi {}

struct MpvClient {
    api: Arc<MpvApi>,
    handle: MpvHandlePtr,
    call_lock: Mutex<()>,
}

unsafe impl Send for MpvClient {}
unsafe impl Sync for MpvClient {}

struct MpvSession {
    client: Arc<MpvClient>,
    p2p: Option<P2pPlaybackInfo>,
    #[cfg(target_os = "windows")]
    surface: Option<MpvVideoSurface>,
}

#[cfg(target_os = "windows")]
struct MpvVideoSurface {
    hwnd: isize,
    owner: tauri::WebviewWindow,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct MpvSurfaceRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[cfg(target_os = "windows")]
unsafe impl Send for MpvVideoSurface {}
#[cfg(target_os = "windows")]
unsafe impl Sync for MpvVideoSurface {}

#[cfg(not(target_os = "android"))]
#[derive(Default)]
struct P2pState {
    server: Mutex<Option<P2pServer>>,
    resolve_lock: Mutex<()>,
    pending: Mutex<Option<P2pPlaybackInfo>>,
}

#[cfg(target_os = "android")]
#[derive(Default)]
struct P2pState;

#[cfg(not(target_os = "android"))]
struct P2pServer {
    base_url: String,
    shutdown: Arc<AtomicBool>,
    stopped: mpsc::Receiver<()>,
}

#[cfg(not(target_os = "android"))]
const P2P_HTTP_ATTEMPT_TIMEOUT_MS: u64 = 35_000;
#[cfg(not(target_os = "android"))]
const P2P_HTTP_MAX_ATTEMPTS: usize = 2;

impl MpvSession {
    fn stop(self) -> Option<P2pPlaybackInfo> {
        let _ = mpv_command_value_async(&self.client, serde_json::json!(["quit"]));
        self.p2p
    }
}

#[cfg(target_os = "windows")]
impl Drop for MpvVideoSurface {
    fn drop(&mut self) {
        if self.hwnd != 0 {
            let hwnd = self.hwnd;
            let _ = self.owner.app_handle().run_on_main_thread(move || {
                use windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow;
                unsafe {
                    DestroyWindow(hwnd as _);
                }
            });
        }
    }
}

impl Drop for MpvClient {
    fn drop(&mut self) {
        if !self.handle.0.is_null() {
            unsafe {
                (self.api.terminate_destroy)(self.handle.0);
            }
        }
    }
}

#[cfg(target_os = "windows")]
impl MpvSurfaceRect {
    fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self {
            x: x.max(0),
            y: y.max(0),
            width: width.max(1),
            height: height.max(1),
        }
    }
}

#[cfg(target_os = "windows")]
impl MpvVideoSurface {
    fn set_visible(&self, visible: bool) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE, SW_SHOW};

        unsafe {
            ShowWindow(self.hwnd as _, if visible { SW_SHOW } else { SW_HIDE });
        }
    }

    fn move_to_rect(&self, rect: MpvSurfaceRect) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE,
        };

        unsafe {
            SetWindowPos(
                self.hwnd as _,
                HWND_BOTTOM,
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                SWP_NOACTIVATE,
            );
        }
    }

    fn resize_to_parent(&self, parent_hwnd: isize) {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetClientRect;

        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 1280,
            bottom: 720,
        };
        unsafe {
            let parent = parent_hwnd as _;
            if GetClientRect(parent, &mut rect) == 0 {
                return;
            }
            self.move_to_rect(MpvSurfaceRect::new(
                0,
                0,
                rect.right - rect.left,
                rect.bottom - rect.top,
            ));
        }
    }
}

fn stop_current_mpv(state: &MpvState) -> Option<P2pPlaybackInfo> {
    let session = match state.session.lock() {
        Ok(mut current) => current.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    if let Some(session) = session {
        session.stop()
    } else {
        None
    }
}

fn set_player_window_transparent(window: &tauri::WebviewWindow, transparent: bool) {
    let alpha = if transparent { 0 } else { 255 };
    let _ = window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, alpha)));
}

#[cfg(target_os = "windows")]
fn resize_current_mpv_surface(state: &MpvState, parent_hwnd: isize) {
    let rect = match state.surface_rect.lock() {
        Ok(current) => *current,
        Err(poisoned) => *poisoned.into_inner(),
    };
    let current = match state.session.lock() {
        Ok(current) => current,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(session) = current.as_ref() {
        if let Some(surface) = session.surface.as_ref() {
            if let Some(rect) = rect {
                surface.move_to_rect(rect);
            } else {
                surface.resize_to_parent(parent_hwnd);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn current_mpv_surface_rect(state: &MpvState, parent_hwnd: isize) -> MpvSurfaceRect {
    if let Ok(current) = state.surface_rect.lock() {
        if let Some(rect) = *current {
            return rect;
        }
    }

    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClientRect;

    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 1280,
        bottom: 720,
    };
    unsafe {
        let parent = parent_hwnd as _;
        if GetClientRect(parent, &mut rect) == 0 {
            return MpvSurfaceRect::new(0, 0, 1280, 720);
        }
    }
    MpvSurfaceRect::new(0, 0, rect.right - rect.left, rect.bottom - rect.top)
}

fn current_mpv_client(state: &MpvState) -> Result<Arc<MpvClient>, String> {
    let current = state
        .session
        .lock()
        .map_err(|_| String::from("No se pudo acceder a la sesion de MPV."))?;

    if let Some(session) = current.as_ref() {
        Ok(session.client.clone())
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

    for root in roots {
        let candidates = [
            root.join("bin").join("mpv"),
            root.join("mpv"),
            root.join("resources").join("bin").join("mpv"),
        ];
        for candidate in candidates {
            if candidate.join(LIBMPV_DLL_NAME).exists() {
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
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CLIPCHILDREN,
    };

    unsafe {
        let hwnd = hwnd as _;
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let next_style = style | WS_CLIPCHILDREN as isize;
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

#[cfg(target_os = "windows")]
fn emit_mouse_back_button() {
    if let (Some(app), Some(label)) = (MOUSE_NAV_APP.get(), MOUSE_NAV_WINDOW_LABEL.get()) {
        let _ = app.emit_to(label, "aetherio-mouse-back", serde_json::json!({}));
    }
}

#[cfg(target_os = "windows")]
fn is_mouse_back_button(wparam: windows_sys::Win32::Foundation::WPARAM) -> bool {
    ((wparam >> 16) & 0xffff) == 1
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn mpv_surface_wnd_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    const WM_XBUTTONDOWN: u32 = 0x020B;
    const WM_XBUTTONUP: u32 = 0x020C;

    if (msg == WM_XBUTTONDOWN || msg == WM_XBUTTONUP) && is_mouse_back_button(wparam) {
        if msg == WM_XBUTTONUP {
            emit_mouse_back_button();
        }
        return 1;
    }

    windows_sys::Win32::UI::WindowsAndMessaging::DefWindowProcW(hwnd, msg, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn ensure_mpv_surface_class() -> Result<(), String> {
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        RegisterClassW, CS_HREDRAW, CS_VREDRAW, WNDCLASSW,
    };

    static REGISTER: Once = Once::new();
    static mut REGISTERED: bool = false;

    REGISTER.call_once(|| {
        let class_name = wide_null("AetherioMpvSurface");
        unsafe {
            let instance = GetModuleHandleW(ptr::null());
            let class = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(mpv_surface_wnd_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: instance,
                hIcon: ptr::null_mut(),
                hCursor: ptr::null_mut(),
                hbrBackground: ptr::null_mut(),
                lpszMenuName: ptr::null(),
                lpszClassName: class_name.as_ptr(),
            };
            REGISTERED = RegisterClassW(&class) != 0;
        }
    });

    unsafe {
        if REGISTERED {
            Ok(())
        } else {
            Err(String::from(
                "No se pudo registrar la superficie nativa de MPV.",
            ))
        }
    }
}

#[cfg(target_os = "windows")]
fn create_mpv_video_surface(
    parent_hwnd: isize,
    rect: MpvSurfaceRect,
    visible: bool,
    owner: tauri::WebviewWindow,
) -> Result<MpvVideoSurface, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, SetWindowPos, ShowWindow, HWND_BOTTOM, SWP_NOACTIVATE, SW_HIDE, SW_SHOW,
        WS_CHILD, WS_CLIPCHILDREN,
    };

    ensure_mpv_surface_class()?;
    let class_name = wide_null("AetherioMpvSurface");
    let title = wide_null("Aetherio MPV Surface");

    unsafe {
        let parent = parent_hwnd as _;
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_CHILD | WS_CLIPCHILDREN,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            parent,
            ptr::null_mut(),
            GetModuleHandleForSurface(),
            ptr::null_mut(),
        );

        if hwnd.is_null() {
            return Err(String::from(
                "No se pudo crear la superficie nativa de MPV.",
            ));
        }

        SetWindowPos(
            hwnd,
            HWND_BOTTOM,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            SWP_NOACTIVATE,
        );
        ShowWindow(hwnd, if visible { SW_SHOW } else { SW_HIDE });

        Ok(MpvVideoSurface {
            hwnd: hwnd as isize,
            owner,
        })
    }
}

#[cfg(target_os = "windows")]
fn create_mpv_video_surface_on_main_thread(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<MpvVideoSurface, String> {
    let (tx, rx) = mpsc::sync_channel(1);
    let task_app = app.clone();
    let task_window = window.clone();
    let owner = window.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let parent_hwnd = task_window.hwnd().map_err(|error| error.to_string())?.0 as isize;
            prepare_mpv_parent_window(parent_hwnd);
            let state = task_app.state::<MpvState>();
            let initial_rect = current_mpv_surface_rect(&state, parent_hwnd);
            let initial_visible = match state.surface_visible.lock() {
                Ok(visible) => *visible,
                Err(poisoned) => *poisoned.into_inner(),
            };
            create_mpv_video_surface(parent_hwnd, initial_rect, initial_visible, owner)
        })();
        let _ = tx.send(result);
    })
    .map_err(|error| format!("No se pudo programar la superficie MPV: {}", error))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| String::from("La superficie MPV no se creo a tiempo."))?
}

#[cfg(target_os = "windows")]
#[allow(non_snake_case)]
unsafe fn GetModuleHandleForSurface() -> windows_sys::Win32::Foundation::HINSTANCE {
    windows_sys::Win32::System::LibraryLoader::GetModuleHandleW(ptr::null())
}

#[cfg(target_os = "windows")]
fn prepare_libmpv_dll_search_path(runtime_dir: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::LibraryLoader::SetDllDirectoryW;

    let mut path: Vec<u16> = runtime_dir.as_os_str().encode_wide().collect();
    path.push(0);
    unsafe {
        SetDllDirectoryW(path.as_ptr());
    }
}

#[cfg(not(target_os = "windows"))]
fn prepare_libmpv_dll_search_path(_runtime_dir: &Path) {}

unsafe fn load_mpv_symbol<T: Copy>(library: &Library, symbol: &'static [u8]) -> Result<T, String> {
    let loaded: libloading::Symbol<'_, T> = library
        .get(symbol)
        .map_err(|error| format!("No se pudo cargar simbolo libmpv {:?}: {}", symbol, error))?;
    Ok(*loaded)
}

impl MpvApi {
    fn load(runtime_dir: &Path) -> Result<Arc<Self>, String> {
        prepare_libmpv_dll_search_path(runtime_dir);
        let libmpv_path = runtime_dir.join(LIBMPV_DLL_NAME);
        let library = unsafe { Library::new(&libmpv_path) }
            .map_err(|error| format!("No se pudo cargar {}: {}", libmpv_path.display(), error))?;

        let create = unsafe { load_mpv_symbol(&library, b"mpv_create\0") }?;
        let initialize = unsafe { load_mpv_symbol(&library, b"mpv_initialize\0") }?;
        let terminate_destroy = unsafe { load_mpv_symbol(&library, b"mpv_terminate_destroy\0") }?;
        let command_async = unsafe { load_mpv_symbol(&library, b"mpv_command_async\0") }?;
        let set_option_string = unsafe { load_mpv_symbol(&library, b"mpv_set_option_string\0") }?;
        let observe_property = unsafe { load_mpv_symbol(&library, b"mpv_observe_property\0") }?;
        let wait_event = unsafe { load_mpv_symbol(&library, b"mpv_wait_event\0") }?;
        let event_name = unsafe { load_mpv_symbol(&library, b"mpv_event_name\0") }?;
        let error_string = unsafe { load_mpv_symbol(&library, b"mpv_error_string\0") }?;

        Ok(Arc::new(Self {
            _library: library,
            create,
            initialize,
            terminate_destroy,
            command_async,
            set_option_string,
            observe_property,
            wait_event,
            event_name,
            error_string,
        }))
    }
}

fn mpv_error(api: &MpvApi, code: c_int) -> String {
    unsafe {
        let message = (api.error_string)(code);
        if message.is_null() {
            return format!("codigo {}", code);
        }
        CStr::from_ptr(message).to_string_lossy().into_owned()
    }
}

fn mpv_check(api: &MpvApi, code: c_int, context: &str) -> Result<(), String> {
    if code < 0 {
        Err(format!("{}: {}", context, mpv_error(api, code)))
    } else {
        Ok(())
    }
}

fn cstring_arg(value: &str, context: &str) -> Result<CString, String> {
    let cleaned = value.replace('\0', " ");
    if cleaned.len() > MAX_MPV_CSTRING_LEN {
        return Err(format!(
            "{} excede el limite de longitud permitido para reproducir de forma segura.",
            context
        ));
    }
    CString::new(cleaned).map_err(|_| format!("{} contiene bytes nulos no validos.", context))
}

fn create_mpv_client(api: Arc<MpvApi>) -> Result<Arc<MpvClient>, String> {
    let handle = unsafe { (api.create)() };
    if handle.is_null() {
        return Err(String::from(
            "libmpv no pudo crear un contexto de reproduccion.",
        ));
    }
    Ok(Arc::new(MpvClient {
        api,
        handle: MpvHandlePtr(handle),
        call_lock: Mutex::new(()),
    }))
}

fn mpv_set_option_string(client: &Arc<MpvClient>, name: &str, value: &str) -> Result<(), String> {
    let name = cstring_arg(name, "Nombre de opcion MPV")?;
    let value = cstring_arg(value, "Valor de opcion MPV")?;
    let _guard = client
        .call_lock
        .lock()
        .map_err(|_| String::from("No se pudo bloquear libmpv."))?;
    let result =
        unsafe { (client.api.set_option_string)(client.handle.0, name.as_ptr(), value.as_ptr()) };
    mpv_check(&client.api, result, "No se pudo configurar libmpv")
}

fn mpv_initialize_client(client: &Arc<MpvClient>) -> Result<(), String> {
    let _guard = client
        .call_lock
        .lock()
        .map_err(|_| String::from("No se pudo bloquear libmpv."))?;
    let result = unsafe { (client.api.initialize)(client.handle.0) };
    mpv_check(&client.api, result, "No se pudo inicializar libmpv")
}

fn mpv_command_arg(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::Bool(value) => {
            if *value {
                String::from("yes")
            } else {
                String::from("no")
            }
        }
        serde_json::Value::Null => String::new(),
        _ => value.to_string(),
    }
}

fn mpv_command_value_async(
    client: &Arc<MpvClient>,
    command: serde_json::Value,
) -> Result<(), String> {
    let args = command
        .as_array()
        .ok_or_else(|| String::from("Comando MPV invalido."))?;
    if args.is_empty() {
        return Err(String::from("Comando MPV invalido."));
    }

    let c_args = args
        .iter()
        .map(|value| cstring_arg(&mpv_command_arg(value), "Argumento MPV"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut pointers = c_args
        .iter()
        .map(|value| value.as_ptr())
        .collect::<Vec<*const c_char>>();
    pointers.push(ptr::null());

    let _guard = client
        .call_lock
        .lock()
        .map_err(|_| String::from("No se pudo bloquear libmpv."))?;
    let result = unsafe { (client.api.command_async)(client.handle.0, 0, pointers.as_ptr()) };
    mpv_check(&client.api, result, "MPV devolvio un error")
}

unsafe fn mpv_node_to_json(node: &MpvNode) -> serde_json::Value {
    match node.format {
        MPV_FORMAT_STRING => {
            if node.u.string.is_null() {
                serde_json::Value::Null
            } else {
                serde_json::Value::String(
                    CStr::from_ptr(node.u.string).to_string_lossy().into_owned(),
                )
            }
        }
        MPV_FORMAT_FLAG => serde_json::Value::Bool(node.u.flag != 0),
        MPV_FORMAT_INT64 => serde_json::json!(node.u.int64),
        MPV_FORMAT_DOUBLE => serde_json::Number::from_f64(node.u.double_)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        MPV_FORMAT_NODE_ARRAY => {
            let list = node.u.list;
            if list.is_null() || (*list).values.is_null() || (*list).num <= 0 {
                return serde_json::Value::Array(Vec::new());
            }
            let values = std::slice::from_raw_parts((*list).values, (*list).num as usize);
            serde_json::Value::Array(values.iter().map(|value| mpv_node_to_json(value)).collect())
        }
        MPV_FORMAT_NODE_MAP => {
            let list = node.u.list;
            if list.is_null() || (*list).values.is_null() || (*list).num <= 0 {
                return serde_json::Value::Object(serde_json::Map::new());
            }
            let mut map = serde_json::Map::new();
            for index in 0..(*list).num as usize {
                let key = if (*list).keys.is_null() {
                    None
                } else {
                    let key_ptr = *(*list).keys.add(index);
                    (!key_ptr.is_null())
                        .then(|| CStr::from_ptr(key_ptr).to_string_lossy().into_owned())
                };
                if let Some(key) = key {
                    let value = &*(*list).values.add(index);
                    map.insert(key, mpv_node_to_json(value));
                }
            }
            serde_json::Value::Object(map)
        }
        _ => serde_json::Value::Null,
    }
}

fn empty_mpv_status_snapshot() -> serde_json::Value {
    serde_json::json!({
        "timePos": 0,
        "duration": 0,
        "pause": true,
        "sid": serde_json::Value::Null,
        "aid": serde_json::Value::Null,
        "speed": 1,
        "fileLoaded": false,
        "pausedForCache": false,
        "cacheBufferingState": 0,
        "chapter": serde_json::Value::Null,
        "chapterList": [],
        "tracks": [],
    })
}

fn cached_mpv_status(state: &MpvState) -> serde_json::Value {
    match state.last_status.lock() {
        Ok(status) => {
            if status.is_object() {
                status.clone()
            } else {
                empty_mpv_status_snapshot()
            }
        }
        Err(poisoned) => {
            let status = poisoned.into_inner();
            if status.is_object() {
                status.clone()
            } else {
                empty_mpv_status_snapshot()
            }
        }
    }
}

fn update_cached_mpv_status(app: &tauri::AppHandle, event_id: c_int, payload: &serde_json::Value) {
    let state = app.state::<MpvState>();
    let mut status = match state.last_status.lock() {
        Ok(status) => status,
        Err(poisoned) => poisoned.into_inner(),
    };
    if !status.is_object() {
        *status = empty_mpv_status_snapshot();
    }

    if event_id == MPV_EVENT_FILE_LOADED {
        status["fileLoaded"] = serde_json::Value::Bool(true);
    } else if event_id == MPV_EVENT_END_FILE || event_id == MPV_EVENT_SHUTDOWN {
        status["fileLoaded"] = serde_json::Value::Bool(false);
        status["pause"] = serde_json::Value::Bool(true);
    }

    if event_id != MPV_EVENT_PROPERTY_CHANGE {
        return;
    }
    let property = match payload.get("property") {
        Some(property) => property,
        None => return,
    };
    let name = property
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let key = match name {
        "time-pos" => "timePos",
        "duration" => "duration",
        "pause" => "pause",
        "sid" => "sid",
        "aid" => "aid",
        "speed" => "speed",
        "file-loaded" => "fileLoaded",
        "paused-for-cache" => "pausedForCache",
        "cache-buffering-state" => "cacheBufferingState",
        "chapter" => "chapter",
        "chapter-list" => "chapterList",
        "track-list" => "tracks",
        _ => return,
    };
    status[key] = property
        .get("value")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
}

fn observe_mpv_properties(client: &Arc<MpvClient>) {
    for (index, name) in [
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
    ]
    .iter()
    .enumerate()
    {
        let name = match cstring_arg(name, "Propiedad observable MPV") {
            Ok(name) => name,
            Err(_) => continue,
        };
        unsafe {
            let _ = (client.api.observe_property)(
                client.handle.0,
                index as u64,
                name.as_ptr(),
                MPV_FORMAT_NODE,
            );
        }
    }
}

fn mpv_event_name(api: &MpvApi, event_id: c_int) -> String {
    unsafe {
        let name = (api.event_name)(event_id);
        if name.is_null() {
            return format!("event-{}", event_id);
        }
        CStr::from_ptr(name).to_string_lossy().into_owned()
    }
}

unsafe fn mpv_event_property_payload(event: &MpvEvent) -> serde_json::Value {
    if event.data.is_null() {
        return serde_json::Value::Null;
    }
    let property = &*(event.data as *const MpvEventProperty);
    let name = if property.name.is_null() {
        String::new()
    } else {
        CStr::from_ptr(property.name).to_string_lossy().into_owned()
    };
    let value = if property.data.is_null() {
        serde_json::Value::Null
    } else if property.format == MPV_FORMAT_NODE {
        mpv_node_to_json(&*(property.data as *const MpvNode))
    } else {
        serde_json::Value::Null
    };
    serde_json::json!({ "name": name, "value": value })
}

fn mpv_event_payload(client: &Arc<MpvClient>, event: &MpvEvent) -> serde_json::Value {
    let name = mpv_event_name(&client.api, event.event_id);
    let mut payload = serde_json::json!({
        "event": name,
        "eventId": event.event_id,
        "replyUserdata": event.reply_userdata,
    });

    if event.error < 0 {
        payload["error"] = serde_json::Value::String(mpv_error(&client.api, event.error));
    }
    if event.event_id == MPV_EVENT_PROPERTY_CHANGE {
        payload["property"] = unsafe { mpv_event_property_payload(event) };
    }
    payload
}

fn should_emit_status_for_event(event_id: c_int) -> bool {
    matches!(
        event_id,
        MPV_EVENT_FILE_LOADED
            | MPV_EVENT_TRACKS_CHANGED
            | MPV_EVENT_TRACK_SWITCHED
            | MPV_EVENT_PAUSE
            | MPV_EVENT_UNPAUSE
            | MPV_EVENT_SEEK
            | MPV_EVENT_PLAYBACK_RESTART
            | MPV_EVENT_PROPERTY_CHANGE
    )
}

fn emit_mpv_status(app: &tauri::AppHandle, window_label: &str, reason: &str) {
    let state = app.state::<MpvState>();
    let _ = app.emit_to(
        window_label,
        "mpv-event",
        serde_json::json!({
            "event": "status",
            "reason": reason,
            "snapshot": cached_mpv_status(&state),
        }),
    );
}

fn spawn_mpv_event_forwarder(
    app: tauri::AppHandle,
    window_label: String,
    client: Arc<MpvClient>,
    start_time: Option<f64>,
    p2p: Option<P2pPlaybackInfo>,
) {
    thread::spawn(move || {
        let mut resume_seek_applied = false;
        loop {
            let event = unsafe { (client.api.wait_event)(client.handle.0, 0.25) };
            if event.is_null() {
                continue;
            }
            let event = unsafe { &*event };
            if event.event_id == MPV_EVENT_NONE {
                continue;
            }

            if event.event_id == MPV_EVENT_FILE_LOADED && !resume_seek_applied {
                if let Some(start_time) = start_time {
                    resume_seek_applied = true;
                    let _ = mpv_command_value_async(
                        &client,
                        serde_json::json!(["seek", start_time, "absolute", "exact"]),
                    );
                    mpv_bridge_log(
                        "resume_seek_on_file_loaded",
                        serde_json::json!({ "startTime": start_time }),
                    );
                }
            }

            let payload = mpv_event_payload(&client, event);
            update_cached_mpv_status(&app, event.event_id, &payload);
            let _ = app.emit_to(&window_label, "mpv-event", payload);
            if should_emit_status_for_event(event.event_id) {
                emit_mpv_status(
                    &app,
                    &window_label,
                    &mpv_event_name(&client.api, event.event_id),
                );
            }
            if event.event_id == MPV_EVENT_END_FILE || event.event_id == MPV_EVENT_SHUTDOWN {
                schedule_p2p_cleanup(p2p.clone());
            }
            if event.event_id == MPV_EVENT_SHUTDOWN {
                break;
            }
        }
    });
}

fn emit_mpv_startup_status(app: tauri::AppHandle, window_label: String) {
    thread::spawn(move || {
        for _ in 0..12 {
            thread::sleep(Duration::from_millis(500));
            emit_mpv_status(&app, &window_label, "startup");
        }
    });
}

#[cfg(not(target_os = "android"))]
fn p2p_log(event: &str, payload: serde_json::Value) {
    let path = p2p_log_path();
    let line = serde_json::json!({
        "event": event,
        "tsMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default(),
        "payload": payload,
    });
    eprintln!("[AETHERIO:P2P] {}", line);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", line);
    }
}

fn p2p_log_path() -> PathBuf {
    let pid = std::process::id();
    std::env::temp_dir().join(format!("aetherio-p2p-{}.log", pid))
}

fn mpv_bridge_log(event: &str, payload: serde_json::Value) {
    let line = serde_json::json!({
        "event": event,
        "tsMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default(),
        "payload": payload,
    });
    eprintln!("[AETHERIO:MPV:BRIDGE] {}", line);
    let pid = std::process::id();
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join(format!("aetherio-mpv-bridge-{}.log", pid)))
    {
        let _ = writeln!(file, "{}", line);
    }
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
    p2p: Option<P2pPlaybackInfo>,
}

#[derive(Clone)]
struct P2pPlaybackInfo {
    server_url: String,
    torrent_id: String,
    file_idx: usize,
    cleanup_started: Arc<AtomicBool>,
}

#[cfg(not(target_os = "android"))]
fn cleanup_p2p_torrent(info: P2pPlaybackInfo) {
    if info.cleanup_started.swap(true, Ordering::AcqRel) {
        return;
    }

    let delete_url = format!("{}/torrents/{}/delete", info.server_url, info.torrent_id);
    p2p_log(
        "cleanup_requested",
        serde_json::json!({
            "torrentId": info.torrent_id,
            "fileIdx": info.file_idx,
            "url": delete_url,
        }),
    );
    let result = Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .and_then(|client| client.post(&delete_url).send());
    match result {
        Ok(response) => p2p_log(
            "cleanup_finished",
            serde_json::json!({
                "torrentId": info.torrent_id,
                "fileIdx": info.file_idx,
                "status": response.status().as_u16(),
                "ok": response.status().is_success(),
            }),
        ),
        Err(error) => p2p_log(
            "cleanup_error",
            serde_json::json!({
                "torrentId": info.torrent_id,
                "fileIdx": info.file_idx,
                "error": error.to_string(),
            }),
        ),
    }
}

#[cfg(not(target_os = "android"))]
fn schedule_p2p_cleanup(info: Option<P2pPlaybackInfo>) {
    if let Some(info) = info {
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(180));
            cleanup_p2p_torrent(info);
        });
    }
}

#[cfg(not(target_os = "android"))]
fn take_pending_p2p(state: &P2pState) -> Option<P2pPlaybackInfo> {
    match state.pending.lock() {
        Ok(mut pending) => pending.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    }
}

#[cfg(not(target_os = "android"))]
fn set_pending_p2p(state: &P2pState, info: P2pPlaybackInfo) {
    match state.pending.lock() {
        Ok(mut pending) => *pending = Some(info),
        Err(poisoned) => *poisoned.into_inner() = Some(info),
    }
}

#[cfg(not(target_os = "android"))]
fn clear_pending_p2p(state: &P2pState, info: &P2pPlaybackInfo) {
    let mut pending = match state.pending.lock() {
        Ok(pending) => pending,
        Err(poisoned) => poisoned.into_inner(),
    };
    if pending
        .as_ref()
        .map(|current| Arc::ptr_eq(&current.cleanup_started, &info.cleanup_started))
        .unwrap_or(false)
    {
        pending.take();
    }
}

#[cfg(target_os = "android")]
fn take_pending_p2p(_state: &P2pState) -> Option<P2pPlaybackInfo> {
    None
}

#[cfg(target_os = "android")]
fn cleanup_p2p_torrent(_info: P2pPlaybackInfo) {}

#[cfg(target_os = "android")]
fn schedule_p2p_cleanup(_info: Option<P2pPlaybackInfo>) {}

struct PendingP2pCleanup(Option<P2pPlaybackInfo>);

impl PendingP2pCleanup {
    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for PendingP2pCleanup {
    fn drop(&mut self) {
        schedule_p2p_cleanup(self.0.take());
    }
}

fn fallback_playback_target(target: &str) -> ResolvedPlaybackTarget {
    ResolvedPlaybackTarget {
        target: target.to_string(),
        audio_file: None,
        p2p: None,
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

    // Let MPV's ytdl_hook resolve YouTube itself. Pre-resolving with yt-dlp -g
    // can split video/audio into separate URLs, and audio-add is not reliable
    // enough during the initial async load in the embedded player.
    fallback_playback_target(target)
}

#[cfg(not(target_os = "android"))]
fn is_p2p_target(target: &str) -> bool {
    let value = target.trim().to_ascii_lowercase();
    value.starts_with("magnet:")
        || value.starts_with("stremio:")
        || (value.len() == 40 && value.chars().all(|c| c.is_ascii_hexdigit()))
}

#[cfg(not(target_os = "android"))]
fn normalize_magnet_target(target: &str) -> Result<String, String> {
    let value = target.trim();
    if value.to_ascii_lowercase().starts_with("magnet:") {
        return Ok(value.to_string());
    }
    if value.len() == 40 && value.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(format!("magnet:?xt=urn:btih:{}", value));
    }
    Err(String::from(
        "La fuente P2P no trae magnet ni infoHash reproducible.",
    ))
}

#[cfg(not(target_os = "android"))]
fn validate_p2p_server(base_url: &str) -> bool {
    let ok = Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
        .and_then(|client| client.get(base_url).send().ok())
        .map(|response| response.status().is_success())
        .unwrap_or(false);
    p2p_log(
        "server_validate",
        serde_json::json!({ "baseUrl": base_url, "ok": ok }),
    );
    ok
}

#[cfg(not(target_os = "android"))]
fn stop_p2p_server(server: P2pServer, reason: &str) {
    p2p_log(
        "server_stop_requested",
        serde_json::json!({ "baseUrl": server.base_url, "reason": reason }),
    );
    server.shutdown.store(true, Ordering::Release);
    let stopped = server.stopped.recv_timeout(Duration::from_secs(3)).is_ok();
    p2p_log(
        "server_stop_finished",
        serde_json::json!({ "baseUrl": server.base_url, "stopped": stopped }),
    );
}

#[cfg(not(target_os = "android"))]
fn invalidate_p2p_server(state: &P2pState, expected_base_url: &str, reason: &str) {
    let server = {
        let mut current = match state.server.lock() {
            Ok(current) => current,
            Err(poisoned) => poisoned.into_inner(),
        };
        if current
            .as_ref()
            .map(|server| server.base_url == expected_base_url)
            .unwrap_or(false)
        {
            current.take()
        } else {
            None
        }
    };
    if let Some(server) = server {
        stop_p2p_server(server, reason);
    }
}

#[cfg(not(target_os = "android"))]
fn clear_stale_p2p_cache(cache_root: &Path) -> Result<(), String> {
    if cache_root.file_name().and_then(|value| value.to_str()) != Some("p2p") {
        return Err(String::from("Se rechazo limpiar una ruta P2P inesperada."));
    }
    if !cache_root.exists() {
        return Ok(());
    }

    let mut removed = 0usize;
    for entry in fs::read_dir(cache_root)
        .map_err(|error| format!("No se pudo revisar cache P2P anterior: {}", error))?
    {
        let entry = entry.map_err(|error| format!("Entrada P2P invalida: {}", error))?;
        let path = entry.path();
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        result.map_err(|error| format!("No se pudo limpiar {}: {}", path.display(), error))?;
        removed += 1;
    }
    p2p_log(
        "stale_cache_cleared",
        serde_json::json!({ "cacheRoot": cache_root, "entries": removed }),
    );
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn ensure_p2p_server(app: &tauri::AppHandle, state: &P2pState) -> Result<String, String> {
    let stale_server = {
        let mut current = state
            .server
            .lock()
            .map_err(|_| String::from("No se pudo acceder al motor P2P."))?;
        if let Some(server) = current.as_ref() {
            if validate_p2p_server(&server.base_url) {
                return Ok(server.base_url.clone());
            }
        }
        current.take()
    };
    if let Some(server) = stale_server {
        stop_p2p_server(server, "health_check_failed");
    }

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("No se pudo ubicar cache P2P: {}", error))?
        .join("p2p");
    clear_stale_p2p_cache(&cache_root)?;
    fs::create_dir_all(&cache_root)
        .map_err(|error| format!("No se pudo crear cache P2P: {}", error))?;
    p2p_log(
        "server_start_requested",
        serde_json::json!({ "cacheRoot": cache_root }),
    );

    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let (stopped_tx, stopped_rx) = mpsc::channel::<()>();
    let shutdown = Arc::new(AtomicBool::new(false));
    let thread_shutdown = shutdown.clone();
    thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                let _ = tx.send(Err(format!("No se pudo iniciar runtime P2P: {}", error)));
                let _ = stopped_tx.send(());
                return;
            }
        };

        runtime.block_on(async move {
            // Persistent DHT reuses a fixed UDP port and breaks when a dev reload
            // overlaps the previous process. Keep DHT enabled, but per session.
            let session = match Session::new_with_opts(
                cache_root.clone(),
                SessionOptions {
                    disable_dht_persistence: true,
                    ..Default::default()
                },
            )
            .await
            {
                Ok(session) => {
                    p2p_log(
                        "session_started",
                        serde_json::json!({ "dhtMode": "memory" }),
                    );
                    session
                }
                Err(dht_error) => {
                    p2p_log(
                        "session_dht_fallback",
                        serde_json::json!({ "error": dht_error.to_string() }),
                    );
                    match Session::new_with_opts(
                        cache_root,
                        SessionOptions {
                            disable_dht: true,
                            disable_dht_persistence: true,
                            ..Default::default()
                        },
                    )
                    .await
                    {
                        Ok(session) => session,
                        Err(error) => {
                            let _ = tx.send(Err(format!(
                                "No se pudo crear sesion P2P: {} (DHT: {})",
                                error, dht_error
                            )));
                            return;
                        }
                    }
                }
            };
            let api = Api::new(session.clone(), None, None);
            let http_api = HttpApi::new(
                api,
                Some(HttpApiOptions {
                    read_only: false,
                    basic_auth: None,
                }),
            );
            let listener = match tokio::net::TcpListener::bind(("127.0.0.1", 0)).await {
                Ok(listener) => listener,
                Err(error) => {
                    let _ = tx.send(Err(format!("No se pudo abrir servidor P2P: {}", error)));
                    return;
                }
            };
            let addr = match listener.local_addr() {
                Ok(addr) => addr,
                Err(error) => {
                    let _ = tx.send(Err(format!("No se pudo leer puerto P2P: {}", error)));
                    return;
                }
            };
            let base_url = format!("http://{}", addr);
            p2p_log("server_started", serde_json::json!({ "baseUrl": base_url }));
            let _ = tx.send(Ok(base_url));
            let server_result = tokio::select! {
                result = http_api.make_http_api_and_run(listener, None) => Some(result),
                _ = async {
                    while !thread_shutdown.load(Ordering::Acquire) {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                } => None,
            };
            if let Some(Err(error)) = server_result {
                p2p_log(
                    "server_error",
                    serde_json::json!({ "error": format!("{error:#}") }),
                );
            }
            session.stop().await;
            p2p_log("server_stopped", serde_json::json!({}));
        });
        let _ = stopped_tx.send(());
    });

    let base_url = rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| String::from("El servidor P2P no inicio a tiempo."))??;
    p2p_log("server_ready", serde_json::json!({ "baseUrl": base_url }));

    let mut server = state
        .server
        .lock()
        .map_err(|_| String::from("No se pudo guardar el motor P2P."))?;
    *server = Some(P2pServer {
        base_url: base_url.clone(),
        shutdown,
        stopped: stopped_rx,
    });
    Ok(base_url)
}

#[cfg(not(target_os = "android"))]
fn p2p_episode_file_score(name: &str, episode: usize) -> i32 {
    let escaped_episode = format!("0*{}", episode);
    let patterns = [
        (format!(r"(?i)\bs\d{{1,2}}e{}\b", escaped_episode), 120),
        (
            format!(
                r"(?i)\b(?:e|ep|episode|episodio)[ ._-]*{}(?:v\d+)?\b",
                escaped_episode
            ),
            100,
        ),
        (
            format!(
                r"(?i)(?:^|[\s\[\]()_.-]){}(?:v\d+)?(?:[\s\[\]()_.-]|$)",
                escaped_episode
            ),
            70,
        ),
    ];
    let mut score = patterns
        .iter()
        .filter_map(|(pattern, score)| {
            regex::Regex::new(pattern)
                .ok()
                .filter(|regex| regex.is_match(name))
                .map(|_| *score)
        })
        .max()
        .unwrap_or(0);
    let lower = name.to_ascii_lowercase();
    if ["sample", "ncop", "nced", "creditless", "trailer", "preview"]
        .iter()
        .any(|token| lower.contains(token))
    {
        score -= 200;
    }
    score
}

#[cfg(not(target_os = "android"))]
fn choose_p2p_file(
    details: &serde_json::Value,
    requested: Option<usize>,
    episode: Option<usize>,
) -> Result<usize, String> {
    if let Some(file_idx) = requested {
        p2p_log(
            "file_selected_requested",
            serde_json::json!({ "fileIdx": file_idx }),
        );
        return Ok(file_idx);
    }

    let files = details
        .get("files")
        .and_then(|value| value.as_array())
        .ok_or_else(|| String::from("El torrent no publico lista de archivos."))?;

    let playable = [
        ".mkv", ".mp4", ".avi", ".mov", ".m4v", ".webm", ".ts", ".m2ts", ".wmv",
    ];
    let selected = files
        .iter()
        .enumerate()
        .filter_map(|(index, file)| {
            let name = file
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let length = file
                .get("length")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            let lower = name.to_ascii_lowercase();
            let is_playable = playable.iter().any(|ext| lower.ends_with(ext));
            is_playable.then_some((
                index,
                episode
                    .map(|value| p2p_episode_file_score(name, value))
                    .unwrap_or(0),
                length,
            ))
        })
        .max_by_key(|(_, score, length)| (*score, *length))
        .map(|(index, _, _)| index)
        .or_else(|| {
            files
                .iter()
                .enumerate()
                .max_by_key(|(_, file)| {
                    file.get("length")
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0)
                })
                .map(|(index, _)| index)
        })
        .ok_or_else(|| String::from("El torrent no tiene archivos reproducibles."))?;
    p2p_log(
        "file_selected_auto",
        serde_json::json!({
            "fileIdx": selected,
            "episode": episode,
            "files": files.iter().enumerate().take(20).map(|(index, file)| serde_json::json!({
                "index": index,
                "name": file.get("name").and_then(|value| value.as_str()).unwrap_or(""),
                "length": file.get("length").and_then(|value| value.as_u64()).unwrap_or(0),
            })).collect::<Vec<_>>()
        }),
    );
    Ok(selected)
}

#[cfg(all(test, not(target_os = "android")))]
mod p2p_file_tests {
    use super::{choose_p2p_file, p2p_episode_file_score};

    #[test]
    fn episode_score_recognizes_common_anime_names() {
        assert!(p2p_episode_file_score("Show S01E03.mkv", 3) > 100);
        assert!(p2p_episode_file_score("Show - Episodio 03.mkv", 3) > 80);
        assert!(p2p_episode_file_score("Show_03_(1080p).mkv", 3) > 50);
        assert!(
            p2p_episode_file_score("Show_03_sample.mkv", 3)
                < p2p_episode_file_score("Show_03.mkv", 3)
        );
    }

    #[test]
    fn batch_selection_prefers_episode_match_over_file_size() {
        let details = serde_json::json!({
            "files": [
                { "name": "Show_01.mkv", "length": 800 },
                { "name": "Show_02.mkv", "length": 1200 },
                { "name": "Show_NCOP.mkv", "length": 2000 }
            ]
        });
        assert_eq!(choose_p2p_file(&details, None, Some(1)).unwrap(), 0);
        assert_eq!(choose_p2p_file(&details, None, Some(2)).unwrap(), 1);
    }
}

#[cfg(not(target_os = "android"))]
#[derive(Debug)]
struct P2pPostError {
    message: String,
    retryable: bool,
    restart_server: bool,
}

#[cfg(not(target_os = "android"))]
fn post_p2p_magnet(
    client: &Client,
    url: &str,
    magnet: &str,
    request_event: &str,
    response_event: &str,
) -> Result<serde_json::Value, P2pPostError> {
    p2p_log(request_event, serde_json::json!({ "url": url }));
    let response = client
        .post(url)
        .body(magnet.to_string())
        .send()
        .map_err(|error| {
            let is_timeout = error.is_timeout();
            let restart_server = error.is_connect();
            let message = if is_timeout {
                String::from(
                    "No se recibieron metadatos del torrent. Puede no tener peers disponibles.",
                )
            } else {
                format!("No se pudo contactar al motor P2P local: {}", error)
            };
            p2p_log(
                "request_error",
                serde_json::json!({
                    "url": url,
                    "error": error.to_string(),
                    "timeout": is_timeout,
                    "connect": restart_server,
                }),
            );
            P2pPostError {
                message,
                retryable: is_timeout || restart_server,
                restart_server,
            }
        })?;
    let status = response.status();
    let body = response.text().map_err(|error| P2pPostError {
        message: format!("No se pudo leer respuesta P2P: {}", error),
        retryable: false,
        restart_server: false,
    })?;
    p2p_log(
        response_event,
        serde_json::json!({
            "status": status.as_u16(),
            "bodyPrefix": body.chars().take(4000).collect::<String>(),
        }),
    );
    if !status.is_success() {
        let timed_out = body.to_ascii_lowercase().contains("timeout");
        return Err(P2pPostError {
            message: if timed_out {
                String::from(
                    "No se recibieron metadatos del torrent. Puede no tener peers disponibles.",
                )
            } else {
                format!("El motor P2P rechazo la fuente: HTTP {}", status)
            },
            retryable: timed_out,
            restart_server: false,
        });
    }
    serde_json::from_str::<serde_json::Value>(&body).map_err(|error| P2pPostError {
        message: format!("Respuesta P2P invalida: {}", error),
        retryable: false,
        restart_server: false,
    })
}

#[cfg(not(target_os = "android"))]
fn post_p2p_magnet_with_retry(
    app: &tauri::AppHandle,
    state: &P2pState,
    client: &Client,
    endpoint: &str,
    magnet: &str,
    request_event: &str,
    response_event: &str,
) -> Result<(String, serde_json::Value), String> {
    for attempt in 1..=P2P_HTTP_MAX_ATTEMPTS {
        let base_url = ensure_p2p_server(app, state)?;
        let url = format!("{}{}", base_url, endpoint);
        match post_p2p_magnet(client, &url, magnet, request_event, response_event) {
            Ok(value) => return Ok((base_url, value)),
            Err(error) if error.retryable && attempt < P2P_HTTP_MAX_ATTEMPTS => {
                p2p_log(
                    "request_retry",
                    serde_json::json!({
                        "attempt": attempt,
                        "nextAttempt": attempt + 1,
                        "restartServer": error.restart_server,
                        "error": error.message,
                    }),
                );
                if error.restart_server {
                    invalidate_p2p_server(state, &base_url, "request_transport_failed");
                }
                thread::sleep(Duration::from_millis(1200));
            }
            Err(error) => return Err(error.message),
        }
    }
    Err(String::from("No se pudo preparar el torrent P2P."))
}

#[cfg(not(target_os = "android"))]
fn resolve_p2p_playback_target(
    app: &tauri::AppHandle,
    state: &P2pState,
    target: &str,
    file_idx: Option<usize>,
    episode: Option<usize>,
) -> Result<Option<ResolvedPlaybackTarget>, String> {
    if !is_p2p_target(target) {
        return Ok(None);
    }

    let _resolve = state
        .resolve_lock
        .lock()
        .map_err(|_| String::from("No se pudo serializar la sesion P2P."))?;

    let magnet = normalize_magnet_target(target)?;
    let initial_base_url = ensure_p2p_server(app, state)?;
    p2p_log(
        "resolve_start",
        serde_json::json!({
            "targetPrefix": target.chars().take(80).collect::<String>(),
            "magnetPrefix": magnet.chars().take(160).collect::<String>(),
            "requestedFileIdx": file_idx,
            "episode": episode,
            "baseUrl": initial_base_url,
        }),
    );
    let client = Client::builder()
        .timeout(Duration::from_millis(P2P_HTTP_ATTEMPT_TIMEOUT_MS + 5_000))
        .build()
        .map_err(|error| format!("No se pudo crear cliente P2P: {}", error))?;

    let selected_file_idx = if let Some(index) = file_idx {
        index
    } else {
        let inspect_endpoint = format!(
            "/torrents?list_only=true&timeout_ms={}",
            P2P_HTTP_ATTEMPT_TIMEOUT_MS
        );
        let (_, inspected) = post_p2p_magnet_with_retry(
            app,
            state,
            &client,
            &inspect_endpoint,
            &magnet,
            "inspect_request",
            "inspect_response",
        )?;
        let inspect_details = inspected
            .get("details")
            .ok_or_else(|| String::from("El motor P2P no devolvio archivos al inspeccionar."))?;
        choose_p2p_file(inspect_details, None, episode)?
    };
    let add_endpoint = format!(
        "/torrents?only_files={}&overwrite=true&timeout_ms={}",
        selected_file_idx, P2P_HTTP_ATTEMPT_TIMEOUT_MS
    );
    let (base_url, json) = post_p2p_magnet_with_retry(
        app,
        state,
        &client,
        &add_endpoint,
        &magnet,
        "add_request",
        "add_response",
    )?;
    let details = json
        .get("details")
        .ok_or_else(|| String::from("El motor P2P no devolvio detalles del torrent."))?;
    let torrent_id = json
        .get("id")
        .and_then(|value| value.as_u64())
        .map(|value| value.to_string())
        .or_else(|| {
            details
                .get("id")
                .and_then(|value| value.as_u64())
                .map(|value| value.to_string())
        })
        .or_else(|| {
            details
                .get("info_hash")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned)
        })
        .ok_or_else(|| String::from("El motor P2P no devolvio id del torrent."))?;
    let stream_url = format!(
        "{}/torrents/{}/stream/{}",
        base_url, torrent_id, selected_file_idx
    );
    let info_hash = details
        .get("info_hash")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let hash_stream_url = if info_hash.is_empty() {
        None
    } else {
        Some(format!(
            "{}/torrents/{}/stream/{}",
            base_url, info_hash, selected_file_idx
        ))
    };

    let p2p_info = P2pPlaybackInfo {
        server_url: base_url.clone(),
        torrent_id: torrent_id.clone(),
        file_idx: selected_file_idx,
        cleanup_started: Arc::new(AtomicBool::new(false)),
    };
    set_pending_p2p(state, p2p_info.clone());
    let ready_stream_url = match wait_until_p2p_stream_ready(
        &stream_url,
        hash_stream_url.as_deref(),
        &base_url,
        &torrent_id,
        selected_file_idx,
        &p2p_info.cleanup_started,
    ) {
        Ok(url) => {
            clear_pending_p2p(state, &p2p_info);
            url
        }
        Err(error) => {
            clear_pending_p2p(state, &p2p_info);
            cleanup_p2p_torrent(p2p_info.clone());
            return Err(error);
        }
    };
    p2p_log(
        "resolve_ok",
        serde_json::json!({
            "torrentId": torrent_id,
            "fileIdx": selected_file_idx,
            "streamUrl": ready_stream_url,
            "fallbackHashUrl": hash_stream_url,
        }),
    );

    Ok(Some(ResolvedPlaybackTarget {
        target: ready_stream_url,
        audio_file: None,
        p2p: Some(p2p_info),
    }))
}

#[cfg(target_os = "android")]
fn resolve_p2p_playback_target(
    _app: &tauri::AppHandle,
    _state: &P2pState,
    _target: &str,
    _file_idx: Option<usize>,
    _episode: Option<usize>,
) -> Result<Option<ResolvedPlaybackTarget>, String> {
    Ok(None)
}

#[cfg(not(target_os = "android"))]
fn wait_until_p2p_stream_ready(
    id_stream_url: &str,
    hash_stream_url: Option<&str>,
    base_url: &str,
    torrent_id: &str,
    file_idx: usize,
    cancelled: &AtomicBool,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|error| format!("No se pudo crear cliente de verificacion P2P: {}", error))?;

    let mut attempts: u32 = 0;
    let mut last_status: Option<u16> = None;
    let mut last_error: Option<String> = None;
    let start = std::time::Instant::now();
    let max_wait = Duration::from_secs(75);
    let urls = if let Some(hash_url) = hash_stream_url {
        vec![id_stream_url.to_string(), hash_url.to_string()]
    } else {
        vec![id_stream_url.to_string()]
    };

    while start.elapsed() < max_wait {
        if cancelled.load(Ordering::Acquire) {
            return Err(String::from("La preparacion del torrent fue cancelada."));
        }
        attempts += 1;
        for url in &urls {
            let response = client
                .get(url)
                .header(reqwest::header::RANGE, "bytes=0-1")
                .send();

            match response {
                Ok(response) => {
                    let status = response.status().as_u16();
                    let ok = response.status().is_success()
                        || status == 206
                        || status == 416
                        || status == 302
                        || status == 307
                        || status == 308;
                    p2p_log(
                        "stream_probe",
                        serde_json::json!({
                            "attempt": attempts,
                            "url": url,
                            "status": status,
                            "ok": ok,
                        }),
                    );
                    if ok {
                        return Ok(url.clone());
                    }
                    last_status = Some(status);
                }
                Err(error) => {
                    let message = error.to_string();
                    last_error = Some(message.clone());
                    p2p_log(
                        "stream_probe_error",
                        serde_json::json!({
                            "attempt": attempts,
                            "url": url,
                            "error": message,
                        }),
                    );
                }
            }
        }

        if attempts == 6 || attempts == 12 || attempts == 18 {
            let details_url = format!("{}/torrents/{}", base_url, torrent_id);
            if let Ok(response) = client.get(&details_url).send() {
                let status = response.status().as_u16();
                let body = response.text().unwrap_or_default();
                p2p_log(
                    "torrent_details_probe",
                    serde_json::json!({
                        "attempt": attempts,
                        "status": status,
                        "bodyPrefix": body.chars().take(3000).collect::<String>(),
                        "torrentId": torrent_id,
                        "fileIdx": file_idx,
                    }),
                );
            }
        }

        thread::sleep(Duration::from_millis(850));
    }

    Err(format!(
        "El stream P2P no quedo listo (torrent {}, fileIdx {}). status={:?}, error={:?}. Revisa {}",
        torrent_id,
        file_idx,
        last_status,
        last_error,
        p2p_log_path().display()
    ))
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

    total > 0 && (black as f32 / total as f32) >= 0.90
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

    total > 0 && (black as f32 / total as f32) >= 0.90
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

fn reset_mpv_crop_state(client: &Arc<MpvClient>) {
    for (name, value) in [
        ("video-crop", serde_json::json!("")),
        ("panscan", serde_json::json!(0)),
        ("video-zoom", serde_json::json!(0)),
        ("video-align-x", serde_json::json!(0)),
        ("video-align-y", serde_json::json!(0)),
    ] {
        let _ = mpv_command_value_async(client, serde_json::json!(["set", name, value]));
    }
}

const ALLOWED_MPV_COMMANDS: &[&str] = &[
    "loadfile",
    "stop",
    "seek",
    "playlist-next",
    "playlist-prev",
    "cycle",
    "set",
    "show-text",
    "sub-add",
    "audio-add",
];

const ALLOWED_MPV_PROPERTIES: &[&str] = &[
    "pause",
    "time-pos",
    "volume",
    "speed",
    "mute",
    "video-crop",
    "panscan",
    "video-zoom",
    "sid",
    "aid",
    "sub-delay",
    "audio-delay",
    "playlist-pos",
    "loop",
    "video-align-x",
    "video-align-y",
];

fn normalize_command(command: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    if command.is_empty() {
        return Err(String::from("Comando MPV invalido."));
    }
    if let Some(name) = command.first().and_then(|v| v.as_str()) {
        if !ALLOWED_MPV_COMMANDS.contains(&name) {
            return Err(format!("Comando MPV no permitido: {}", name));
        }
    }
    Ok(serde_json::Value::Array(command))
}

#[tauri::command]
async fn open_mpv(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    target: String,
    subtitle: Option<String>,
    headers: Option<HashMap<String, String>>,
    file_idx: Option<usize>,
    episode: Option<usize>,
    start_time: Option<f64>,
) -> Result<serde_json::Value, String> {
    if target.trim().is_empty() {
        return Err(String::from("La fuente no tiene URL reproducible."));
    }
    if target.len() > MAX_MPV_CSTRING_LEN {
        return Err(String::from(
            "La URL de esta fuente es demasiado larga para abrirse de forma segura.",
        ));
    }
    mpv_bridge_log(
        "open_requested",
        serde_json::json!({
            "targetPrefix": target.chars().take(240).collect::<String>(),
            "hasSubtitle": subtitle.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false),
            "hasHeaders": headers.as_ref().map(|value| !value.is_empty()).unwrap_or(false),
            "fileIdx": file_idx,
            "episode": episode,
            "startTime": start_time,
        }),
    );

    let state = app.state::<MpvState>();
    let p2p_state = app.state::<P2pState>();
    let open_generation = state.open_generation.fetch_add(1, Ordering::AcqRel) + 1;
    let previous_pending_p2p = take_pending_p2p(&p2p_state);
    let previous_p2p = {
        let _lifecycle = state
            .lifecycle
            .lock()
            .map_err(|_| String::from("No se pudo acceder al ciclo de vida de MPV."))?;
        stop_current_mpv(&state)
    };

    let runtime_dir = find_mpv_runtime_dir(&app).ok_or_else(|| {
        String::from("libmpv interno no esta instalado. Coloca libmpv-2.dll y sus DLLs en src-tauri/bin/mpv antes de empaquetar.")
    })?;
    let ytdlp_path = runtime_dir.join("yt-dlp.exe");
    let resolver_app = app.clone();
    let resolver_target = target.clone();
    let resolver_runtime_dir = runtime_dir.clone();
    let playback_target = tauri::async_runtime::spawn_blocking(move || {
        if let Some(previous_p2p) = previous_p2p {
            cleanup_p2p_torrent(previous_p2p);
        }
        if let Some(previous_pending_p2p) = previous_pending_p2p {
            cleanup_p2p_torrent(previous_pending_p2p);
        }
        let p2p_state = resolver_app.state::<P2pState>();
        resolve_p2p_playback_target(
            &resolver_app,
            &p2p_state,
            &resolver_target,
            file_idx,
            episode,
        )
        .map(|resolved| {
            resolved.unwrap_or_else(|| {
                resolve_ytdlp_playback_target(&resolver_runtime_dir, &resolver_target)
            })
        })
    })
    .await
    .map_err(|error| format!("Fallo la tarea de preparacion P2P: {}", error))??;
    let mut pending_p2p_cleanup = PendingP2pCleanup(playback_target.p2p.clone());

    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| String::from("No se pudo acceder al ciclo de vida de MPV."))?;
    if state.open_generation.load(Ordering::Acquire) != open_generation {
        return Err(String::from("La apertura fue reemplazada por otra fuente."));
    }
    schedule_p2p_cleanup(stop_current_mpv(&state));
    let log_path = std::env::temp_dir().join("aetherio-mpv.log");
    mpv_bridge_log(
        "target_resolved",
        serde_json::json!({
            "resolvedPrefix": playback_target.target.chars().take(240).collect::<String>(),
            "audioFile": playback_target.audio_file.as_ref(),
            "isP2p": playback_target.p2p.is_some(),
            "runtimeDir": runtime_dir.display().to_string(),
            "mpvLog": log_path.display().to_string(),
        }),
    );

    set_player_window_transparent(&window, false);
    let window_label = window.label().to_string();

    #[cfg(target_os = "windows")]
    let video_surface = create_mpv_video_surface_on_main_thread(&app, &window)?;
    #[cfg(not(target_os = "windows"))]
    let parent_hwnd = 0isize;

    let api = MpvApi::load(&runtime_dir)?;
    let client = create_mpv_client(api)?;
    mpv_bridge_log(
        "libmpv_loaded",
        serde_json::json!({ "runtimeDir": runtime_dir.display().to_string() }),
    );

    #[cfg(target_os = "windows")]
    mpv_set_option_string(&client, "wid", &video_surface.hwnd.to_string())?;
    #[cfg(not(target_os = "windows"))]
    let _ = parent_hwnd;

    let ytdl_enabled = looks_like_youtube_url(&target);

    for (name, value) in [
        ("terminal", "no"),
        ("force-window", "immediate"),
        ("idle", "yes"),
        ("pause", "yes"),
        ("keep-open", "no"),
        ("resume-playback", "no"),
        ("cache", "yes"),
        ("cache-pause", "yes"),
        ("cache-pause-initial", "no"),
        ("cache-pause-wait", "1"),
        ("hwdec", "auto-safe"),
        ("vo", "gpu-next"),
        ("gpu-api", "d3d11"),
        ("osc", "no"),
        ("input-default-bindings", "yes"),
        ("input-vo-keyboard", "yes"),
        ("ao", "wasapi"),
        ("audio-channels", "auto-safe"),
        ("sub-auto", "fuzzy"),
        ("cookies", "yes"),
        ("demuxer-max-bytes", "512MiB"),
        ("demuxer-max-back-bytes", "128MiB"),
    ] {
        mpv_set_option_string(&client, name, value)?;
    }
    mpv_set_option_string(&client, "ytdl", if ytdl_enabled { "yes" } else { "no" })?;
    if ytdl_enabled {
        mpv_set_option_string(&client, "ytdl-format", "bestvideo*+bestaudio/best")?;
    }
    mpv_set_option_string(&client, "log-file", &log_path.display().to_string())?;

    if let Some(headers) = headers {
        let mut header_fields: Vec<String> = Vec::new();
        let mut total_len = 0usize;
        for (key, value) in headers {
            let normalized_key = key.trim();
            let normalized_value = value
                .trim()
                .replace('\r', " ")
                .replace('\n', " ")
                .replace(',', " ");
            if normalized_key.is_empty() || normalized_value.is_empty() {
                continue;
            }
            let safe_value = if normalized_value.len() > MAX_HTTP_HEADER_VALUE_LEN {
                normalized_value[..MAX_HTTP_HEADER_VALUE_LEN].to_string()
            } else {
                normalized_value
            };
            let header_line = format!("{}: {}", normalized_key, safe_value);
            total_len += header_line.len();
            if total_len > MAX_HTTP_HEADERS_TOTAL_LEN {
                mpv_bridge_log(
                    "headers_truncated",
                    serde_json::json!({ "reason": "max_total_len", "max": MAX_HTTP_HEADERS_TOTAL_LEN }),
                );
                break;
            }
            header_fields.push(header_line);
        }
        if !header_fields.is_empty() {
            mpv_set_option_string(&client, "http-header-fields", &header_fields.join(","))?;
        }
    }

    if ytdlp_path.exists() && ytdl_enabled {
        mpv_set_option_string(
            &client,
            "script-opts",
            &format!("ytdl_hook-ytdl_path={}", ytdlp_path.display()),
        )?;
    }

    mpv_initialize_client(&client)?;
    mpv_bridge_log("libmpv_initialized", serde_json::json!({}));

    match state.last_status.lock() {
        Ok(mut status) => *status = empty_mpv_status_snapshot(),
        Err(poisoned) => *poisoned.into_inner() = empty_mpv_status_snapshot(),
    }

    {
        let mut current = state
            .session
            .lock()
            .map_err(|_| String::from("No se pudo guardar la sesion de MPV."))?;
        #[cfg(target_os = "windows")]
        {
            *current = Some(MpvSession {
                client: client.clone(),
                p2p: playback_target.p2p.clone(),
                surface: Some(video_surface),
            });
        }
        #[cfg(not(target_os = "windows"))]
        {
            *current = Some(MpvSession {
                client: client.clone(),
                p2p: playback_target.p2p.clone(),
            });
        }
    }

    let normalized_start_time = start_time.filter(|value| value.is_finite() && *value >= 1.0);
    observe_mpv_properties(&client);
    spawn_mpv_event_forwarder(
        app.clone(),
        window_label.clone(),
        client.clone(),
        normalized_start_time,
        playback_target.p2p.clone(),
    );
    if let Err(error) = mpv_command_value_async(
        &client,
        serde_json::json!(["loadfile", playback_target.target.clone(), "replace"]),
    ) {
        schedule_p2p_cleanup(stop_current_mpv(&state));
        mpv_bridge_log("loadfile_error", serde_json::json!({ "error": error }));
        return Err(error);
    }
    pending_p2p_cleanup.disarm();
    mpv_bridge_log(
        "loadfile_queued",
        serde_json::json!({
            "resolvedPrefix": playback_target.target.chars().take(240).collect::<String>(),
            "startTime": normalized_start_time,
        }),
    );
    let audio_file = playback_target.audio_file.clone();
    let subtitle_url = subtitle
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && value.len() <= MAX_MPV_CSTRING_LEN)
        .map(ToOwned::to_owned);
    if audio_file.is_some() || subtitle_url.is_some() {
        let supplemental_client = client.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(120));
            if let Some(audio_file) = audio_file {
                let _ = mpv_command_value_async(
                    &supplemental_client,
                    serde_json::json!(["audio-add", audio_file, "auto"]),
                );
            }
            if let Some(subtitle_url) = subtitle_url {
                let _ = mpv_command_value_async(
                    &supplemental_client,
                    serde_json::json!(["sub-add", subtitle_url, "select"]),
                );
            }
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
            "p2pLogPath": p2p_log_path().display().to_string(),
            "p2p": playback_target.p2p.as_ref().map(|p2p| serde_json::json!({
                "serverUrl": p2p.server_url,
                "torrentId": p2p.torrent_id,
                "fileIdx": p2p.file_idx,
            })),
            "snapshot": cached_mpv_status(&state),
        }),
    );
    emit_mpv_startup_status(app.clone(), window_label);
    mpv_bridge_log(
        "open_ready",
        serde_json::json!({ "openGeneration": open_generation }),
    );

    Ok(serde_json::json!({
        "pid": serde_json::Value::Null,
        "hostPid": std::process::id(),
        "backend": "libmpv-capi",
        "embedded": true,
        "resolvedTarget": playback_target.target,
        "p2p": playback_target.p2p.as_ref().map(|p2p| serde_json::json!({
            "serverUrl": p2p.server_url,
            "torrentId": p2p.torrent_id,
            "fileIdx": p2p.file_idx,
        }))
    }))
}

#[tauri::command]
fn set_mpv_surface_rect(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MpvState>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let rect = MpvSurfaceRect::new(x, y, width, height);
        {
            let mut current_rect = state
                .surface_rect
                .lock()
                .map_err(|_| String::from("No se pudo guardar el layout de MPV."))?;
            *current_rect = Some(rect);
        }

        let current = state
            .session
            .lock()
            .map_err(|_| String::from("No se pudo acceder a la sesion de MPV."))?;
        if let Some(session) = current.as_ref() {
            if let Some(surface) = session.surface.as_ref() {
                surface.move_to_rect(rect);
            }
        }
        let _ = window;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, state, x, y, width, height);
    }

    Ok(())
}

#[tauri::command]
fn set_mpv_surface_visible(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MpvState>,
    visible: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        {
            let mut current_visible = state
                .surface_visible
                .lock()
                .map_err(|_| String::from("No se pudo guardar la visibilidad de MPV."))?;
            *current_visible = visible;
        }

        let current = state
            .session
            .lock()
            .map_err(|_| String::from("No se pudo acceder a la sesion de MPV."))?;
        if let Some(session) = current.as_ref() {
            if let Some(surface) = session.surface.as_ref() {
                surface.set_visible(visible);
            }
        }
        set_player_window_transparent(&window, visible);
    }

    #[cfg(not(target_os = "windows"))]
    {
        set_player_window_transparent(&window, visible);
        let _ = (state, visible);
    }

    Ok(())
}

#[tauri::command]
async fn mpv_command(app: tauri::AppHandle, command: Vec<serde_json::Value>) -> Result<(), String> {
    let client = {
        let state = app.state::<MpvState>();
        current_mpv_client(&state)?
    };
    let command = normalize_command(command)?;
    tauri::async_runtime::spawn_blocking(move || mpv_command_value_async(&client, command))
        .await
        .map_err(|error| format!("Fallo la tarea de comando MPV: {}", error))?
}

#[tauri::command]
async fn mpv_set_property(
    app: tauri::AppHandle,
    name: String,
    value: serde_json::Value,
) -> Result<(), String> {
    if !ALLOWED_MPV_PROPERTIES.contains(&name.as_str()) {
        return Err(format!("Propiedad MPV no permitida: {}", name));
    }
    let client = {
        let state = app.state::<MpvState>();
        current_mpv_client(&state)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        mpv_command_value_async(&client, serde_json::json!(["set", name, value]))
    })
    .await
    .map_err(|error| format!("Fallo la tarea de propiedad MPV: {}", error))?
}

#[tauri::command]
async fn mpv_autocrop(app: tauri::AppHandle, enabled: bool) -> Result<serde_json::Value, String> {
    let client = {
        let state = app.state::<MpvState>();
        current_mpv_client(&state)?
    };
    tauri::async_runtime::spawn_blocking(move || mpv_autocrop_for_client(client, enabled))
        .await
        .map_err(|error| format!("Fallo la tarea de autocrop: {}", error))?
}

fn mpv_autocrop_for_client(
    client: Arc<MpvClient>,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    reset_mpv_crop_state(&client);

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
    match mpv_command_value_async(&client, screenshot_command) {
        Ok(()) => {}
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

    let _ = mpv_command_value_async(&client, serde_json::json!(["set", "panscan", 0]));
    if let Some(rect) = crop {
        let crop_value = rect.mpv_value();
        let _ = mpv_command_value_async(
            &client,
            serde_json::json!(["set", "video-crop", crop_value]),
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
    Ok(cached_mpv_status(&state))
}

#[tauri::command]
async fn stop_mpv(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    {
        let state = app.state::<MpvState>();
        state.open_generation.fetch_add(1, Ordering::AcqRel);
        let p2p_state = app.state::<P2pState>();
        schedule_p2p_cleanup(take_pending_p2p(&p2p_state));
    }
    let stop_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = stop_app.state::<MpvState>();
        let _lifecycle = state
            .lifecycle
            .lock()
            .map_err(|_| String::from("No se pudo acceder al ciclo de vida de MPV."))?;
        schedule_p2p_cleanup(stop_current_mpv(&state));
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("Fallo la tarea de cierre MPV: {}", error))??;
    #[cfg(target_os = "windows")]
    {
        let state = app.state::<MpvState>();
        if let Ok(mut current_visible) = state.surface_visible.lock() {
            *current_visible = false;
        };
    }
    set_player_window_transparent(&window, false);
    Ok(())
}

#[tauri::command]
fn trakt_oauth_configured() -> bool {
    trakt_client_secret().is_ok()
}

#[tauri::command]
fn trakt_oauth_token(
    grant_type: String,
    client_id: String,
    code: Option<String>,
    refresh_token: Option<String>,
    redirect_uri: String,
) -> Result<serde_json::Value, String> {
    let client_id = client_id.trim();
    let redirect_uri = redirect_uri.trim();
    let grant_type = grant_type.trim();
    if client_id.is_empty() || redirect_uri.is_empty() {
        return Err(String::from(
            "Trakt no esta configurado en esta version de Aetherio.",
        ));
    }

    let mut body = serde_json::Map::new();
    body.insert("client_id".into(), serde_json::json!(client_id));
    body.insert(
        "client_secret".into(),
        serde_json::json!(trakt_client_secret()?),
    );
    body.insert("redirect_uri".into(), serde_json::json!(redirect_uri));
    body.insert("grant_type".into(), serde_json::json!(grant_type));

    match grant_type {
        "authorization_code" => {
            let code = code
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| String::from("Trakt no devolvio codigo de autorizacion."))?;
            body.insert("code".into(), serde_json::json!(code));
        }
        "refresh_token" => {
            let refresh_token = refresh_token
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| String::from("Trakt no tiene refresh token valido."))?;
            body.insert("refresh_token".into(), serde_json::json!(refresh_token));
        }
        _ => return Err(String::from("Grant OAuth de Trakt invalido.")),
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("No se pudo crear cliente Trakt OAuth: {}", error))?;
    let response = client
        .post("https://api.trakt.tv/oauth/token")
        .header("Accept", "application/json")
        .header("User-Agent", "Aetherio/0.1.0")
        .json(&body)
        .send()
        .map_err(|error| format!("No se pudo contactar Trakt OAuth: {}", error))?;

    let status = response.status();
    let body_text = response
        .text()
        .map_err(|error| format!("No se pudo leer respuesta Trakt OAuth: {}", error))?;
    let payload = parse_trakt_oauth_body(&body_text);
    if !status.is_success() {
        return Err(trakt_oauth_error_message(
            status.as_u16(),
            payload.as_ref(),
            &body_text,
        ));
    }

    payload.ok_or_else(|| trakt_oauth_error_message(status.as_u16(), None, &body_text))
}

#[tauri::command]
fn trakt_oauth_revoke(client_id: String, token: String) -> Result<(), String> {
    let client_id = client_id.trim();
    let token = token.trim();
    if client_id.is_empty() || token.is_empty() {
        return Ok(());
    }

    let secret = trakt_client_secret()?;
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("No se pudo crear cliente Trakt OAuth: {}", error))?;
    let response = client
        .post("https://api.trakt.tv/oauth/revoke")
        .header("Accept", "application/json")
        .header("User-Agent", "Aetherio/0.1.0")
        .json(&serde_json::json!({
            "token": token,
            "client_id": client_id,
            "client_secret": secret,
        }))
        .send()
        .map_err(|error| format!("No se pudo revocar Trakt: {}", error))?;

    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status().as_u16();
        let body_text = response.text().unwrap_or_default();
        let payload = parse_trakt_oauth_body(&body_text);
        Err(trakt_oauth_error_message(
            status,
            payload.as_ref(),
            &body_text,
        ))
    }
}

#[tauri::command]
fn trakt_api_get(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(String::from("URL de Trakt vacia."));
    }
    if !trimmed.starts_with("https://api.trakt.tv/") {
        return Err(String::from("Endpoint Trakt no permitido."));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("No se pudo crear cliente Trakt: {}", error))?;

    let mut request = client
        .get(trimmed)
        .header("Accept", "application/json")
        .header("User-Agent", "Aetherio/0.1.0");

    if let Some(raw_headers) = headers {
        for (name, value) in raw_headers {
            let header_name = name.trim();
            let header_value = value.trim();
            if header_name.is_empty() || header_value.is_empty() {
                continue;
            }
            let lower_name = header_name.to_lowercase();
            if !matches!(
                lower_name.as_str(),
                "authorization" | "content-type" | "accept" | "trakt-api-version"
            ) {
                continue;
            }
            let parsed_name = reqwest::header::HeaderName::from_bytes(header_name.as_bytes());
            let parsed_value = reqwest::header::HeaderValue::from_str(header_value);
            if let (Ok(ok_name), Ok(ok_value)) = (parsed_name, parsed_value) {
                request = request.header(ok_name, ok_value);
            }
        }
    }

    let response = request
        .send()
        .map_err(|error| format!("No se pudo contactar Trakt: {}", error))?;
    let status = response.status().as_u16();
    let mut response_headers = serde_json::Map::new();
    for (name, value) in response.headers().iter() {
        if let Ok(text) = value.to_str() {
            response_headers.insert(name.as_str().to_lowercase(), serde_json::json!(text));
        }
    }
    let body_text = response
        .text()
        .map_err(|error| format!("No se pudo leer respuesta Trakt: {}", error))?;

    Ok(serde_json::json!({
        "status": status,
        "headers": response_headers,
        "body": body_text,
    }))
}

fn trakt_client_secret() -> Result<String, String> {
    if let Some(value) = option_env!("AETHERIO_TRAKT_CLIENT_SECRET")
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(value.to_string());
    }

    std::env::var("AETHERIO_TRAKT_CLIENT_SECRET")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| String::from("Trakt no esta configurado en esta version de Aetherio."))
}

fn parse_trakt_oauth_body(body: &str) -> Option<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(body).ok()
}

fn trakt_oauth_error_message(
    status: u16,
    payload: Option<&serde_json::Value>,
    body_text: &str,
) -> String {
    let reason = payload
        .and_then(|value| {
            value
                .get("error_description")
                .or_else(|| value.get("error"))
                .and_then(|entry| entry.as_str())
        })
        .or_else(|| {
            let trimmed = body_text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or("Trakt rechazo la autorizacion.");
    let reason = reason.chars().take(420).collect::<String>();
    format!("Trakt OAuth fallo ({}): {}", status, reason)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(init_android_player_bridge())
        .setup(|app| {
            #[cfg(target_os = "android")]
            let _ = app;

            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            #[cfg(target_os = "windows")]
            {
                let _ = MOUSE_NAV_APP.set(app.handle().clone());
                let main_window = app.get_webview_window("main");
                if let Some(window) = main_window.as_ref() {
                    set_player_window_transparent(window, false);
                }
                let label = main_window
                    .map(|window| window.label().to_string())
                    .unwrap_or_else(|| String::from("main"));
                let _ = MOUSE_NAV_WINDOW_LABEL.set(label);
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .manage(MpvState::default())
        .manage(P2pState::default())
        .manage(scraper::provider_http::ProviderHttpState::default())
        .invoke_handler(tauri::generate_handler![
            playback_capabilities,
            fetch_introdb_segments,
            fetch_mdblist_ratings,
            android_player_open,
            android_player_stop,
            android_player_command,
            android_player_status,
            toggle_window_maximize,
            toggle_window_fullscreen,
            open_mpv,
            set_mpv_surface_rect,
            set_mpv_surface_visible,
            mpv_command,
            mpv_set_property,
            mpv_autocrop,
            mpv_status,
            stop_mpv,
            trakt_oauth_configured,
            trakt_oauth_token,
            trakt_oauth_revoke,
            trakt_api_get,
            scraper::scrape_streams,
            scraper::get_scraper_sites,
            scraper::provider_http::provider_http_request
        ])
        .on_window_event(|window, event| {
            let state = window.state::<MpvState>();
            match event {
                tauri::WindowEvent::Destroyed => {
                    state.open_generation.fetch_add(1, Ordering::AcqRel);
                    let p2p_state = window.state::<P2pState>();
                    schedule_p2p_cleanup(take_pending_p2p(&p2p_state));
                    schedule_p2p_cleanup(stop_current_mpv(&state));
                }
                tauri::WindowEvent::Resized(_) =>
                {
                    #[cfg(target_os = "windows")]
                    if let Ok(hwnd) = window.hwnd() {
                        resize_current_mpv_surface(&state, hwnd.0 as isize);
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
