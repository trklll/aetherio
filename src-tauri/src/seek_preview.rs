//! Native, playback-independent frame previews for the timeline.
//!
//! The preview player is a separate libmpv core using libmpv's software render
//! API. It never seeks or pauses the user-facing player. Preview requests are
//! serialized per media session and JPEGs are kept in a bounded cache whose
//! directory name is a one-way source fingerprint (URLs and headers are never
//! written to disk or logged).

use std::{
    collections::BTreeMap,
    ffi::{CStr, CString},
    os::raw::{c_char, c_int, c_void},
    path::{Path, PathBuf},
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageBuffer, Rgb};
use libloading::Library;
use serde::Serialize;
use sha2::{Digest, Sha256};

const LIBMPV_DLL_NAME: &str = "libmpv-2.dll";
const PREVIEW_WIDTH: usize = 160;
const PREVIEW_HEIGHT: usize = 90;
const PREVIEW_JPEG_QUALITY: u8 = 45;
const PREVIEW_ZONE_MS: i64 = 5_000;
const MAX_PREVIEW_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PREVIEW_CACHE_ITEMS: usize = 256;
const MAX_HEADERS_BYTES: usize = 8 * 1024;
const MAX_HEADER_VALUE_BYTES: usize = 2 * 1024;
const MAX_DURATION_SECONDS: f64 = 24.0 * 60.0 * 60.0;
const MIN_FRAME_ALIGNMENT_TOLERANCE_SECONDS: f64 = 0.03;
const MAX_FRAME_ALIGNMENT_TOLERANCE_SECONDS: f64 = 0.75;
const MPV_EVENT_NONE: c_int = 0;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_EVENT_SEEK: c_int = 20;
const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
const MPV_RENDER_PARAM_INVALID: c_int = 0;
const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
const MPV_RENDER_PARAM_SW_SIZE: c_int = 17;
const MPV_RENDER_PARAM_SW_FORMAT: c_int = 18;
const MPV_RENDER_PARAM_SW_STRIDE: c_int = 19;
const MPV_RENDER_PARAM_SW_POINTER: c_int = 20;
const MPV_RENDER_UPDATE_FRAME: u64 = 1;

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventEndFile {
    reason: c_int,
    error: c_int,
}

#[repr(C)]
struct RenderParam {
    type_: c_int,
    data: *mut c_void,
}

type MpvHandle = *mut c_void;
type RenderContext = *mut c_void;

struct MpvApi {
    _library: Library,
    create: unsafe extern "C" fn() -> MpvHandle,
    initialize: unsafe extern "C" fn(MpvHandle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(MpvHandle),
    command: unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int,
    set_option_string: unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char,
    free: unsafe extern "C" fn(*mut c_void),
    wait_event: unsafe extern "C" fn(MpvHandle, f64) -> *mut MpvEvent,
    error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    render_context_create:
        unsafe extern "C" fn(*mut RenderContext, MpvHandle, *mut RenderParam) -> c_int,
    render_context_update: unsafe extern "C" fn(RenderContext) -> u64,
    render_context_render: unsafe extern "C" fn(RenderContext, *mut RenderParam) -> c_int,
    render_context_free: unsafe extern "C" fn(RenderContext),
}

unsafe impl Send for MpvApi {}
unsafe impl Sync for MpvApi {}

impl MpvApi {
    fn load(runtime_dir: &Path) -> Result<Arc<Self>, String> {
        crate::prepare_libmpv_dll_search_path(runtime_dir);
        let path = runtime_dir.join(LIBMPV_DLL_NAME);
        let library = unsafe { Library::new(&path) }
            .map_err(|error| format!("No se pudo cargar el motor de previews: {error}"))?;

        unsafe fn symbol<T: Copy>(library: &Library, name: &'static [u8]) -> Result<T, String> {
            library.get::<T>(name).map(|value| *value).map_err(|_| {
                String::from("La versión de libmpv no incluye el renderizador de previews.")
            })
        }

        Ok(Arc::new(unsafe {
            Self {
                create: symbol(&library, b"mpv_create\0")?,
                initialize: symbol(&library, b"mpv_initialize\0")?,
                terminate_destroy: symbol(&library, b"mpv_terminate_destroy\0")?,
                command: symbol(&library, b"mpv_command\0")?,
                set_option_string: symbol(&library, b"mpv_set_option_string\0")?,
                set_property_string: symbol(&library, b"mpv_set_property_string\0")?,
                get_property_string: symbol(&library, b"mpv_get_property_string\0")?,
                free: symbol(&library, b"mpv_free\0")?,
                wait_event: symbol(&library, b"mpv_wait_event\0")?,
                error_string: symbol(&library, b"mpv_error_string\0")?,
                render_context_create: symbol(&library, b"mpv_render_context_create\0")?,
                render_context_update: symbol(&library, b"mpv_render_context_update\0")?,
                render_context_render: symbol(&library, b"mpv_render_context_render\0")?,
                render_context_free: symbol(&library, b"mpv_render_context_free\0")?,
                _library: library,
            }
        }))
    }

    fn check(&self, code: c_int, action: &str) -> Result<(), String> {
        if code >= 0 {
            return Ok(());
        }
        let error = unsafe { (self.error_string)(code) };
        let detail = if error.is_null() {
            format!("código {code}")
        } else {
            unsafe { CStr::from_ptr(error) }
                .to_string_lossy()
                .into_owned()
        };
        Err(format!("{action}: {detail}"))
    }
}

struct PreviewDecoder {
    api: Arc<MpvApi>,
    handle: MpvHandle,
    render: RenderContext,
    target: String,
}

// The handle is only touched while PreviewDecoder is behind its session mutex.
unsafe impl Send for PreviewDecoder {}

impl PreviewDecoder {
    fn open(
        runtime_dir: &Path,
        target: &str,
        headers: &[(String, String)],
    ) -> Result<Self, String> {
        let api = MpvApi::load(runtime_dir)?;
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err(String::from(
                "libmpv no pudo crear el decodificador de previews.",
            ));
        }

        let mut decoder = Self {
            api,
            handle,
            render: ptr::null_mut(),
            target: target.to_string(),
        };
        let init = decoder.initialize(headers);
        if let Err(error) = init {
            return Err(error);
        }
        Ok(decoder)
    }

    fn initialize(&mut self, headers: &[(String, String)]) -> Result<(), String> {
        for (name, value) in [
            ("config", "no"),
            ("terminal", "no"),
            ("ytdl", "no"),
            ("input-default-bindings", "no"),
            ("vo", "libmpv"),
            ("ao", "null"),
            ("audio", "no"),
            ("osc", "no"),
            ("osd-level", "0"),
            ("hwdec", "no"),
            ("pause", "yes"),
            ("keep-open", "yes"),
            ("cache", "yes"),
            ("demuxer-max-bytes", "32MiB"),
            ("demuxer-max-back-bytes", "8MiB"),
            ("network-timeout", "8"),
            ("video-sync", "display-resample"),
            ("video-timing-offset", "0"),
        ] {
            self.set_option(name, value)?;
        }
        let mut additional_headers = Vec::new();
        let mut additional_len = 0usize;
        for (name, value) in headers {
            let name = name.trim();
            let value = sanitize_header_value(value);
            if name.eq_ignore_ascii_case("user-agent") {
                self.set_option("user-agent", &value)?;
                continue;
            }
            if name.eq_ignore_ascii_case("referer") || name.eq_ignore_ascii_case("referrer") {
                self.set_option("referrer", &value)?;
                continue;
            }
            // Do not forward credentials or cookies from a preview decoder. A
            // source requiring those headers remains playable; its previews fail
            // closed rather than risking credential disclosure on redirects.
            if name.eq_ignore_ascii_case("cookie")
                || name.eq_ignore_ascii_case("authorization")
                || name.eq_ignore_ascii_case("proxy-authorization")
                || name.eq_ignore_ascii_case("host")
                || name.is_empty()
                || name.len() > 64
                || !name.bytes().all(is_header_name_byte)
                || value.is_empty()
            {
                continue;
            }
            let line = format!("{name}: {value}");
            additional_len = additional_len.saturating_add(line.len());
            if additional_len > MAX_HEADERS_BYTES {
                break;
            }
            additional_headers.push(line);
        }
        if !additional_headers.is_empty() {
            self.set_option("http-header-fields", &additional_headers.join(","))?;
        }

        let code = unsafe { (self.api.initialize)(self.handle) };
        self.api
            .check(code, "No se pudo iniciar el decodificador de previews")?;

        let api_type = CString::new("sw").expect("static render API name");
        let mut params = [
            RenderParam {
                type_: MPV_RENDER_PARAM_API_TYPE,
                data: api_type.as_ptr() as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];
        let code = unsafe {
            (self.api.render_context_create)(&mut self.render, self.handle, params.as_mut_ptr())
        };
        self.api
            .check(code, "No se pudo iniciar el renderizador de previews")?;
        if self.render.is_null() {
            return Err(String::from("libmpv no creó el renderizador de previews."));
        }

        self.command(&["loadfile", &self.target, "replace"])?;
        let deadline = Instant::now() + Duration::from_secs(18);
        loop {
            if Instant::now() >= deadline {
                return Err(String::from(
                    "El video tardó demasiado en abrirse para generar previews.",
                ));
            }
            let event = unsafe { (self.api.wait_event)(self.handle, 0.1) };
            if event.is_null() {
                continue;
            }
            match unsafe { (*event).event_id } {
                MPV_EVENT_FILE_LOADED => return Ok(()),
                MPV_EVENT_END_FILE => {
                    let detail = if unsafe { (*event).data }.is_null() {
                        String::from("sin detalles")
                    } else {
                        let end_file = unsafe { &*(*event).data.cast::<MpvEventEndFile>() };
                        let error = if end_file.error < 0 {
                            let message = unsafe { (self.api.error_string)(end_file.error) };
                            if message.is_null() {
                                format!("código {}", end_file.error)
                            } else {
                                unsafe { CStr::from_ptr(message) }
                                    .to_string_lossy()
                                    .into_owned()
                            }
                        } else {
                            String::from("sin error libmpv")
                        };
                        format!("motivo {}, {}", end_file.reason, error)
                    };
                    return Err(format!(
                        "Esta fuente no se puede decodificar para previews ({detail})."
                    ));
                }
                MPV_EVENT_NONE => {}
                _ => {}
            }
        }
    }

    fn set_option(&self, name: &str, value: &str) -> Result<(), String> {
        let name = CString::new(name).map_err(|_| String::from("Opción nativa inválida."))?;
        let value = CString::new(value).map_err(|_| String::from("Valor nativo inválido."))?;
        let code =
            unsafe { (self.api.set_option_string)(self.handle, name.as_ptr(), value.as_ptr()) };
        self.api
            .check(code, "No se pudo configurar el decodificador de previews")
    }

    fn set_property(&self, name: &str, value: &str) -> Result<(), String> {
        let name = CString::new(name).map_err(|_| String::from("Propiedad nativa inválida."))?;
        let value = CString::new(value).map_err(|_| String::from("Valor nativo inválido."))?;
        let code =
            unsafe { (self.api.set_property_string)(self.handle, name.as_ptr(), value.as_ptr()) };
        self.api
            .check(code, "No se pudo preparar la extracción de la imagen")
    }

    fn command(&self, values: &[&str]) -> Result<(), String> {
        let args = values
            .iter()
            .map(|value| {
                CString::new(*value).map_err(|_| String::from("Comando de preview inválido."))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut pointers = args.iter().map(|value| value.as_ptr()).collect::<Vec<_>>();
        pointers.push(ptr::null());
        let code = unsafe { (self.api.command)(self.handle, pointers.as_ptr()) };
        self.api.check(code, "libmpv no pudo extraer la imagen")
    }

    fn numeric_property(&self, name: &str) -> Option<f64> {
        let property = CString::new(name).ok()?;
        let value = unsafe { (self.api.get_property_string)(self.handle, property.as_ptr()) };
        if value.is_null() {
            return None;
        }
        let parsed = unsafe { CStr::from_ptr(value) }
            .to_string_lossy()
            .parse::<f64>()
            .ok();
        unsafe { (self.api.free)(value.cast()) };
        parsed.filter(|position| position.is_finite() && *position >= 0.0)
    }

    fn time_position(&self) -> Option<f64> {
        self.numeric_property("time-pos")
    }

    fn warm_first_frame(&mut self, cancel: &AtomicBool) -> Result<Option<Vec<u8>>, String> {
        if cancel.load(Ordering::Acquire) {
            return Ok(None);
        }
        loop {
            let event = unsafe { (self.api.wait_event)(self.handle, 0.0) };
            if event.is_null() || unsafe { (*event).event_id } == MPV_EVENT_NONE {
                break;
            }
        }
        self.set_property("pause", "no")?;
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut playback_restarted = false;
        while Instant::now() < deadline {
            if cancel.load(Ordering::Acquire) {
                break;
            }
            let event = unsafe { (self.api.wait_event)(self.handle, 0.04) };
            if cancel.load(Ordering::Acquire) {
                break;
            }
            if event.is_null() {
                continue;
            }
            match unsafe { (*event).event_id } {
                MPV_EVENT_PLAYBACK_RESTART => {
                    playback_restarted = true;
                    break;
                }
                MPV_EVENT_END_FILE => break,
                _ => {}
            }
        }
        self.set_property("pause", "yes")?;
        if cancel.load(Ordering::Acquire) {
            return Ok(None);
        }
        if !playback_restarted {
            return Err(String::from(
                "No se pudo preparar el primer fotograma del preview.",
            ));
        }
        let row_stride = ((PREVIEW_WIDTH * 4 + 63) / 64) * 64;
        let mut rgba = vec![0u8; row_stride * PREVIEW_HEIGHT];
        let width_height = [PREVIEW_WIDTH as c_int, PREVIEW_HEIGHT as c_int];
        let pixel_format = CString::new("bgr0").expect("static pixel format");
        let stride = row_stride;
        let mut params = [
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_SIZE,
                data: width_height.as_ptr() as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_FORMAT,
                data: pixel_format.as_ptr() as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_STRIDE,
                data: &stride as *const usize as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_POINTER,
                data: rgba.as_mut_ptr().cast(),
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];
        let _ = unsafe { (self.api.render_context_update)(self.render) };
        let result = unsafe { (self.api.render_context_render)(self.render, params.as_mut_ptr()) };
        self.api
            .check(result, "No se pudo preparar el renderizador de previews")?;
        Ok(Some(encode_preview_rgba(&rgba, row_stride)?))
    }

    fn frame_at(&mut self, requested_ms: i64) -> Result<(i64, Vec<u8>), String> {
        let slot_start_ms = preview_target_ms(requested_ms as f64 / 1_000.0);
        let slot_start_seconds = slot_start_ms as f64 / 1_000.0;
        let slot_end_seconds = self
            .numeric_property("duration")
            .filter(|duration| *duration > slot_start_seconds)
            .unwrap_or(slot_start_seconds + PREVIEW_ZONE_MS as f64 / 1_000.0)
            .min(slot_start_seconds + PREVIEW_ZONE_MS as f64 / 1_000.0);
        if slot_end_seconds <= slot_start_seconds {
            return Err(String::from("La zona solicitada queda fuera del video."));
        }

        let fps = self.numeric_property("container-fps");
        let edge_margin = fps
            .filter(|value| value.is_finite() && *value > 0.0)
            .map(|value| 1.0 / value)
            .unwrap_or(0.05);
        let fast_target_seconds =
            (slot_end_seconds - edge_margin.max(0.02)).max(slot_start_seconds);
        let started = Instant::now();
        if let Some(frame) =
            self.frame_at_keyframe(fast_target_seconds, slot_start_seconds, slot_end_seconds)?
        {
            if std::env::var_os("AETHERIO_SEEK_PREVIEW_TIMINGS").is_some() {
                eprintln!(
                    "PREVIEW_ZONE strategy=keyframe start_ms={slot_start_ms} actual_ms={} total_frame_ms={}",
                    frame.0,
                    started.elapsed().as_millis()
                );
            }
            return Ok(frame);
        }

        let center_ms = (((slot_start_seconds + slot_end_seconds) / 2.0) * 1_000.0).round() as i64;
        let frame = self.frame_at_exact(center_ms)?;
        if std::env::var_os("AETHERIO_SEEK_PREVIEW_TIMINGS").is_some() {
            eprintln!(
                "PREVIEW_ZONE strategy=accurate-fallback start_ms={slot_start_ms} actual_ms={} total_frame_ms={}",
                frame.0,
                started.elapsed().as_millis()
            );
        }
        Ok(frame)
    }

    fn frame_at_keyframe(
        &mut self,
        seek_seconds: f64,
        slot_start_seconds: f64,
        slot_end_seconds: f64,
    ) -> Result<Option<(i64, Vec<u8>)>, String> {
        self.set_property("pause", "yes")?;
        loop {
            let event = unsafe { (self.api.wait_event)(self.handle, 0.0) };
            if event.is_null() || unsafe { (*event).event_id } == MPV_EVENT_NONE {
                break;
            }
        }
        self.command(&["seek", &format!("{seek_seconds:.3}"), "absolute+keyframes"])?;
        self.set_property("pause", "no")?;

        let row_stride = ((PREVIEW_WIDTH * 4 + 63) / 64) * 64;
        let mut rgba = vec![0u8; row_stride * PREVIEW_HEIGHT];
        let width_height = [PREVIEW_WIDTH as c_int, PREVIEW_HEIGHT as c_int];
        let pixel_format = CString::new("bgr0").expect("static render pixel format");
        let stride = row_stride;
        let mut params = [
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_SIZE,
                data: width_height.as_ptr() as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_FORMAT,
                data: pixel_format.as_ptr() as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_STRIDE,
                data: &stride as *const usize as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_POINTER,
                data: rgba.as_mut_ptr().cast(),
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut seek_started = false;
        let mut playback_restarted = false;
        let mut rendered_at_ms = None;
        while Instant::now() < deadline {
            let event = unsafe { (self.api.wait_event)(self.handle, 0.04) };
            if !event.is_null() {
                match unsafe { (*event).event_id } {
                    MPV_EVENT_SEEK => seek_started = true,
                    MPV_EVENT_PLAYBACK_RESTART if seek_started && !playback_restarted => {
                        playback_restarted = true;
                        self.set_property("pause", "yes")?;
                    }
                    MPV_EVENT_END_FILE => break,
                    _ => {}
                }
            }
            if !playback_restarted {
                continue;
            }
            let Some(position) = self.time_position() else {
                continue;
            };
            if !preview_position_in_zone(position, slot_start_seconds, slot_end_seconds) {
                break;
            }
            if unsafe { (self.api.render_context_update)(self.render) } & MPV_RENDER_UPDATE_FRAME
                == 0
            {
                continue;
            }
            let result =
                unsafe { (self.api.render_context_render)(self.render, params.as_mut_ptr()) };
            self.api
                .check(result, "No se pudo renderizar la miniatura de la zona")?;
            rendered_at_ms = Some((position * 1_000.0).round() as i64);
            break;
        }
        let _ = self.set_property("pause", "yes");
        let Some(actual_ms) = rendered_at_ms else {
            return Ok(None);
        };

        let jpeg = encode_preview_rgba(&rgba, row_stride)?;
        Ok(Some((actual_ms, jpeg)))
    }

    fn frame_at_exact(&mut self, target_ms: i64) -> Result<(i64, Vec<u8>), String> {
        let target_seconds = target_ms as f64 / 1_000.0;
        let benchmark_started = Instant::now();
        self.set_property("pause", "yes")?;
        loop {
            let event = unsafe { (self.api.wait_event)(self.handle, 0.0) };
            if event.is_null() || unsafe { (*event).event_id } == MPV_EVENT_NONE {
                break;
            }
        }
        let command_started = Instant::now();
        self.command(&["seek", &format!("{target_seconds:.3}"), "absolute+exact"])?;
        let command_elapsed = command_started.elapsed();
        let unpause_started = Instant::now();
        self.set_property("pause", "no")?;
        let unpause_elapsed = unpause_started.elapsed();
        let property_started = Instant::now();
        let frame_alignment_tolerance =
            frame_alignment_tolerance_seconds(self.numeric_property("container-fps"));
        let property_elapsed = property_started.elapsed();
        let row_stride = ((PREVIEW_WIDTH * 4 + 63) / 64) * 64;
        let mut rgba = vec![0u8; row_stride * PREVIEW_HEIGHT];
        let width_height = [PREVIEW_WIDTH as c_int, PREVIEW_HEIGHT as c_int];
        let pixel_format = CString::new("bgr0").expect("static pixel format");
        let stride = row_stride;
        let mut params = [
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_SIZE,
                data: width_height.as_ptr() as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_FORMAT,
                data: pixel_format.as_ptr() as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_STRIDE,
                data: &stride as *const usize as *mut c_void,
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_SW_POINTER,
                data: rgba.as_mut_ptr().cast(),
            },
            RenderParam {
                type_: MPV_RENDER_PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];

        let deadline = Instant::now() + Duration::from_secs(12);
        let mut seek_started = false;
        let mut playback_restarted = false;
        let mut rendered = false;
        let mut restart_elapsed = None;
        let mut render_elapsed = None;
        let mut pause_after_restart_elapsed = Duration::ZERO;
        let mut actual_ms = target_ms;
        while Instant::now() < deadline {
            let event = unsafe { (self.api.wait_event)(self.handle, 0.04) };
            if !event.is_null() {
                match unsafe { (*event).event_id } {
                    MPV_EVENT_SEEK => seek_started = true,
                    MPV_EVENT_PLAYBACK_RESTART if seek_started => {
                        playback_restarted = true;
                        restart_elapsed = Some(benchmark_started.elapsed());
                        // Freeze on the first frame produced by the exact seek.
                        // Otherwise the sidecar keeps advancing while we poll
                        // time-pos, which can make a valid seek look inaccurate.
                        let pause_started = Instant::now();
                        self.set_property("pause", "yes")?;
                        pause_after_restart_elapsed = pause_started.elapsed();
                    }
                    MPV_EVENT_END_FILE => break,
                    _ => {}
                }
            }

            if !playback_restarted {
                continue;
            }
            let Some(position) = self.time_position() else {
                continue;
            };
            if (position - target_seconds).abs() > frame_alignment_tolerance {
                continue;
            }
            actual_ms = (position * 1_000.0).round() as i64;
            let update = unsafe { (self.api.render_context_update)(self.render) };
            if update & MPV_RENDER_UPDATE_FRAME == 0 {
                continue;
            }
            let result =
                unsafe { (self.api.render_context_render)(self.render, params.as_mut_ptr()) };
            self.api
                .check(result, "No se pudo renderizar la imagen de preview")?;
            rendered = true;
            render_elapsed = Some(benchmark_started.elapsed());
            break;
        }
        // Keep the sidecar decoder idle between requests. The main playback
        // core is independent and is never paused or sought by this call.
        let _ = self.set_property("pause", "yes");
        if !rendered {
            return Err(String::from(
                "No se pudo decodificar un fotograma cercano a ese momento.",
            ));
        }

        let encode_started = Instant::now();
        let jpeg = encode_preview_rgba(&rgba, row_stride)?;
        if std::env::var_os("AETHERIO_SEEK_PREVIEW_TIMINGS").is_some() {
            eprintln!(
                "PREVIEW_PHASES command_ms={} unpause_ms={} property_ms={} request_to_restart_ms={} pause_after_restart_ms={} restart_to_render_ms={} encode_ms={} total_frame_ms={}",
                command_elapsed.as_millis(),
                unpause_elapsed.as_millis(),
                property_elapsed.as_millis(),
                restart_elapsed.unwrap_or_default().as_millis(),
                pause_after_restart_elapsed.as_millis(),
                render_elapsed
                    .unwrap_or_default()
                    .saturating_sub(restart_elapsed.unwrap_or_default())
                    .as_millis(),
                encode_started.elapsed().as_millis(),
                benchmark_started.elapsed().as_millis()
            );
        }
        Ok((actual_ms, jpeg))
    }
}

impl Drop for PreviewDecoder {
    fn drop(&mut self) {
        if !self.render.is_null() {
            unsafe { (self.api.render_context_free)(self.render) };
            self.render = ptr::null_mut();
        }
        if !self.handle.is_null() {
            unsafe { (self.api.terminate_destroy)(self.handle) };
            self.handle = ptr::null_mut();
        }
    }
}

fn encode_preview_rgba(rgba: &[u8], row_stride: usize) -> Result<Vec<u8>, String> {
    let mut rgb = Vec::with_capacity(PREVIEW_WIDTH * PREVIEW_HEIGHT * 3);
    for row in rgba.chunks_exact(row_stride).take(PREVIEW_HEIGHT) {
        for pixel in row.chunks_exact(4).take(PREVIEW_WIDTH) {
            rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
        }
    }
    let image =
        ImageBuffer::<Rgb<u8>, _>::from_raw(PREVIEW_WIDTH as u32, PREVIEW_HEIGHT as u32, rgb)
            .ok_or_else(|| String::from("No se pudo componer la miniatura del preview."))?;
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, PREVIEW_JPEG_QUALITY)
        .encode_image(&DynamicImage::ImageRgb8(image))
        .map_err(|_| String::from("No se pudo comprimir la miniatura del preview."))?;
    Ok(jpeg)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrame {
    pub data_url: String,
}

struct PreviewCache {
    root: PathBuf,
    source_dir: PathBuf,
    frames: Mutex<BTreeMap<i64, Vec<u8>>>,
}

impl PreviewCache {
    fn new(root: PathBuf, source_key: &str) -> Result<Self, String> {
        let mut digest = Sha256::new();
        digest.update(source_key.as_bytes());
        let source_dir = root.join(hex::encode(digest.finalize()));
        std::fs::create_dir_all(&source_dir)
            .map_err(|error| format!("No se pudo crear la caché de previews: {error}"))?;
        let mut frames = BTreeMap::new();
        if let Ok(entries) = std::fs::read_dir(&source_dir) {
            let mut cached_files = entries
                .flatten()
                .filter_map(|entry| {
                    let path = entry.path();
                    if path.extension().and_then(|value| value.to_str()) != Some("jpg") {
                        return None;
                    }
                    let time_ms = path.file_stem()?.to_str()?.parse::<i64>().ok()?;
                    let modified = entry
                        .metadata()
                        .ok()?
                        .modified()
                        .unwrap_or(SystemTime::UNIX_EPOCH);
                    Some((path, time_ms, modified))
                })
                .collect::<Vec<_>>();
            cached_files.sort_by_key(|(_, _, modified)| std::cmp::Reverse(*modified));
            for (path, time_ms, _) in cached_files.into_iter().take(MAX_PREVIEW_CACHE_ITEMS) {
                if let Ok(bytes) = std::fs::read(path) {
                    if !bytes.is_empty() && bytes.len() <= 4 * 1024 * 1024 {
                        frames.insert(time_ms, bytes);
                    }
                }
            }
        }
        Ok(Self {
            root,
            source_dir,
            frames: Mutex::new(frames),
        })
    }

    fn get(&self, target_ms: i64) -> Option<Vec<u8>> {
        let cached = { self.frames.lock().ok()?.get(&target_ms).cloned() };
        if let Some(bytes) = cached {
            return Some(bytes);
        }

        // Keep the in-memory working set bounded, but still make older zones
        // on disk a cache hit after a long scrub or a player remount.
        let path = self.source_dir.join(format!("{target_ms}.jpg"));
        let bytes = std::fs::read(path).ok()?;
        if bytes.is_empty() || bytes.len() > 4 * 1024 * 1024 {
            return None;
        }
        if let Ok(mut frames) = self.frames.lock() {
            frames.insert(target_ms, bytes.clone());
            while frames.len() > MAX_PREVIEW_CACHE_ITEMS {
                let Some(oldest) = frames.keys().next().copied() else {
                    break;
                };
                frames.remove(&oldest);
            }
        }
        Some(bytes)
    }

    fn store(&self, time_ms: i64, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.is_empty() || bytes.len() > 4 * 1024 * 1024 {
            return Err(String::from(
                "El fotograma de preview excede el tamaño permitido.",
            ));
        }
        let path = self.source_dir.join(format!("{time_ms}.jpg"));
        std::fs::write(&path, &bytes)
            .map_err(|error| format!("No se pudo guardar el fotograma de preview: {error}"))?;
        if let Ok(mut frames) = self.frames.lock() {
            frames.insert(time_ms, bytes);
            while frames.len() > MAX_PREVIEW_CACHE_ITEMS {
                let Some(oldest) = frames.keys().next().copied() else {
                    break;
                };
                frames.remove(&oldest);
            }
        }
        trim_cache(&self.root);
        Ok(())
    }
}

fn trim_cache(root: &Path) {
    let mut entries = Vec::new();
    collect_cache_files(root, &mut entries);
    let mut total_bytes: u64 = entries
        .iter()
        .map(|(path, _, bytes)| {
            let _ = path;
            *bytes
        })
        .sum();
    entries.sort_by_key(|(_, modified, _)| *modified);
    for (path, _, bytes) in entries {
        if total_bytes <= MAX_PREVIEW_BYTES {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            total_bytes = total_bytes.saturating_sub(bytes);
        }
    }
}

fn collect_cache_files(root: &Path, output: &mut Vec<(PathBuf, SystemTime, u64)>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            collect_cache_files(&path, output);
        } else if kind.is_file() && path.extension().and_then(|value| value.to_str()) == Some("jpg")
        {
            if let Ok(metadata) = entry.metadata() {
                output.push((
                    path,
                    metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    metadata.len(),
                ));
            }
        }
    }
}

pub struct SeekPreviewSession {
    requests: mpsc::SyncSender<PreviewRequest>,
    cancel_warmup: Arc<AtomicBool>,
}

struct PreviewRequest {
    target_seconds: f64,
    response: mpsc::SyncSender<Result<PreviewFrame, String>>,
}

impl SeekPreviewSession {
    pub fn new(
        runtime_dir: PathBuf,
        target: String,
        headers: Option<std::collections::HashMap<String, String>>,
        cache_root: PathBuf,
    ) -> Result<Self, String> {
        if target.trim().is_empty() || target.len() > 16_384 {
            return Err(String::from("La fuente para previews no es válida."));
        }
        let headers = headers
            .unwrap_or_default()
            .into_iter()
            .map(|(name, value)| {
                (
                    name,
                    value
                        .chars()
                        .filter(|ch| !ch.is_control())
                        .take(MAX_HEADER_VALUE_BYTES)
                        .collect(),
                )
            })
            .collect::<Vec<_>>();
        let source_key = format!(
            "seek-preview-v2\n{target}\n{}",
            headers
                .iter()
                .map(|(name, value)| format!("{name}:{value}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let (requests, request_rx) = mpsc::sync_channel::<PreviewRequest>(1);
        let (cache_ready_tx, cache_ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
        let cancel_warmup = Arc::new(AtomicBool::new(false));
        let worker_cancel_warmup = Arc::clone(&cancel_warmup);
        std::thread::Builder::new()
            .name(String::from("aetherio-seek-preview"))
            .spawn(move || {
                let cache = match PreviewCache::new(cache_root, &source_key) {
                    Ok(cache) => {
                        let _ = cache_ready_tx.send(Ok(()));
                        cache
                    }
                    Err(error) => {
                        let _ = cache_ready_tx.send(Err(error));
                        return;
                    }
                };
                // Warm the independent decoder while playback starts, instead
                // of charging its initialization to the first hover/scrub.
                // Keep failures lazy: the first request retries and reports
                // the normal user-facing error if this source is unsupported.
                let mut decoder = PreviewDecoder::open(&runtime_dir, &target, &headers).ok();
                let warmup_result = match decoder.as_mut() {
                    Some(decoder) if !worker_cancel_warmup.load(Ordering::Acquire) => {
                        decoder.warm_first_frame(&worker_cancel_warmup)
                    }
                    _ => Ok(None),
                };
                match warmup_result {
                    Ok(Some(jpeg)) => {
                        // The prepared first frame is already a valid member
                        // of zone zero; reuse it rather than seeking again.
                        let _ = cache.store(0, jpeg);
                    }
                    Ok(None) => {}
                    Err(_) => decoder = None,
                }
                while let Ok(request) = request_rx.recv() {
                    let result = extract_or_load_frame(
                        &cache,
                        &mut decoder,
                        &runtime_dir,
                        &target,
                        &headers,
                        request.target_seconds,
                    );
                    let _ = request.response.send(result);
                }
            })
            .map_err(|error| format!("No se pudo iniciar el hilo de previews: {error}"))?;
        cache_ready_rx
            .recv()
            .map_err(|_| String::from("No se pudo preparar la caché de previews."))??;
        Ok(Self {
            requests,
            cancel_warmup,
        })
    }

    pub fn frame_at(&self, time_seconds: f64) -> Result<PreviewFrame, String> {
        if !time_seconds.is_finite() || time_seconds < 0.0 || time_seconds > MAX_DURATION_SECONDS {
            return Err(String::from(
                "El tiempo solicitado para el preview no es válido.",
            ));
        }
        // A real request takes priority over the disposable startup frame.
        self.cancel_warmup.store(true, Ordering::Release);
        let (response, result_rx) = mpsc::sync_channel(1);
        self.requests
            .send(PreviewRequest {
                target_seconds: time_seconds,
                response,
            })
            .map_err(|_| String::from("El hilo de previews ya no está disponible."))?;
        result_rx
            .recv()
            .map_err(|_| String::from("El hilo de previews terminó antes de responder."))?
    }
}

fn extract_or_load_frame(
    cache: &PreviewCache,
    decoder: &mut Option<PreviewDecoder>,
    runtime_dir: &Path,
    target: &str,
    headers: &[(String, String)],
    time_seconds: f64,
) -> Result<PreviewFrame, String> {
    let target_ms = preview_target_ms(time_seconds);
    if let Some(bytes) = cache.get(target_ms) {
        return Ok(preview_frame(bytes));
    }
    if decoder.is_none() {
        *decoder = Some(PreviewDecoder::open(runtime_dir, target, headers)?);
    }
    let (_, bytes) = decoder
        .as_mut()
        .ok_or_else(|| String::from("No se pudo iniciar el decodificador de previews."))?
        .frame_at(target_ms)?;
    cache.store(target_ms, bytes.clone())?;
    Ok(preview_frame(bytes))
}

fn preview_target_ms(time_seconds: f64) -> i64 {
    (time_seconds.max(0.0) / (PREVIEW_ZONE_MS as f64 / 1_000.0)).floor() as i64 * PREVIEW_ZONE_MS
}

fn preview_position_in_zone(position: f64, start_seconds: f64, end_seconds: f64) -> bool {
    position.is_finite() && position >= start_seconds && position < end_seconds
}

fn frame_alignment_tolerance_seconds(frame_rate: Option<f64>) -> f64 {
    frame_rate
        .filter(|fps| fps.is_finite() && (0.1..=240.0).contains(fps))
        .map(|fps| {
            (0.5 / fps + 0.015).clamp(
                MIN_FRAME_ALIGNMENT_TOLERANCE_SECONDS,
                MAX_FRAME_ALIGNMENT_TOLERANCE_SECONDS,
            )
        })
        .unwrap_or(0.25)
}

fn preview_frame(bytes: Vec<u8>) -> PreviewFrame {
    PreviewFrame {
        data_url: format!("data:image/jpeg;base64,{}", BASE64.encode(bytes)),
    }
}

#[derive(Default)]
pub struct SeekPreviewState {
    active: Mutex<Option<Arc<SeekPreviewSession>>>,
}

impl SeekPreviewState {
    pub fn begin(&self, session: SeekPreviewSession) {
        if let Ok(mut active) = self.active.lock() {
            *active = Some(Arc::new(session));
        }
    }

    pub fn clear(&self) {
        if let Ok(mut active) = self.active.lock() {
            *active = None;
        }
    }

    pub fn session(&self) -> Result<Arc<SeekPreviewSession>, String> {
        self.active
            .lock()
            .map_err(|_| String::from("No se pudo consultar la sesión de previews."))?
            .clone()
            .ok_or_else(|| String::from("Las previews no están disponibles para esta fuente."))
    }
}

fn sanitize_header_value(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_control())
        .map(|ch| if ch == ',' { ' ' } else { ch })
        .take(MAX_HEADER_VALUE_BYTES)
        .collect::<String>()
        .trim()
        .to_string()
}

fn is_header_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::{AtomicBool, Ordering},
    };

    #[test]
    fn cache_fingerprint_is_not_the_source_url() {
        let root =
            std::env::temp_dir().join(format!("aetherio-preview-test-{}", std::process::id()));
        let cache =
            PreviewCache::new(root.clone(), "https://cdn.example/video?token=secret").unwrap();
        assert_ne!(
            cache.source_dir.file_name().unwrap().to_string_lossy(),
            "https://cdn.example/video?token=secret"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn preview_cache_does_not_reuse_a_neighboring_frame() {
        let root = std::env::temp_dir().join(format!(
            "aetherio-preview-cache-exact-{}",
            std::process::id()
        ));
        let cache = PreviewCache::new(root.clone(), "exact-frame-test").unwrap();
        cache.store(12_400, vec![1, 2, 3]).unwrap();

        assert_eq!(cache.get(12_400), Some(vec![1, 2, 3]));
        assert_eq!(cache.get(12_500), None);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn preview_cache_lazily_loads_older_zones_from_disk() {
        let root = std::env::temp_dir().join(format!(
            "aetherio-preview-cache-disk-{}",
            std::process::id()
        ));
        let cache = PreviewCache::new(root.clone(), "disk-zone-test").unwrap();
        cache.store(30_000, vec![4, 5, 6]).unwrap();
        cache.frames.lock().unwrap().clear();

        assert_eq!(cache.get(30_000), Some(vec![4, 5, 6]));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn preview_requests_use_five_second_zones_like_the_frontend_cache() {
        assert_eq!(preview_target_ms(30.0), 30_000);
        assert_eq!(preview_target_ms(34.99), 30_000);
        assert_eq!(preview_target_ms(35.0), 35_000);
    }

    #[test]
    fn keyframe_preview_is_only_accepted_from_its_requested_zone() {
        assert!(preview_position_in_zone(30.0, 30.0, 35.0));
        assert!(preview_position_in_zone(34.999, 30.0, 35.0));
        assert!(!preview_position_in_zone(29.999, 30.0, 35.0));
        assert!(!preview_position_in_zone(35.0, 30.0, 35.0));
    }

    #[test]
    fn preview_encoder_returns_the_small_thumbnail_dimensions() {
        let row_stride = ((PREVIEW_WIDTH * 4 + 63) / 64) * 64;
        let mut rgba = vec![0u8; row_stride * PREVIEW_HEIGHT];
        for (index, pixel) in rgba.chunks_exact_mut(4).enumerate() {
            pixel[0] = (index % 255) as u8;
            pixel[1] = ((index / 3) % 255) as u8;
            pixel[2] = ((index / 7) % 255) as u8;
        }

        let jpeg = encode_preview_rgba(&rgba, row_stride).unwrap();
        let image = image::load_from_memory(&jpeg).unwrap();
        assert_eq!(
            image.dimensions(),
            (PREVIEW_WIDTH as u32, PREVIEW_HEIGHT as u32)
        );
    }

    #[test]
    fn seek_accuracy_tracks_frame_rate_instead_of_accepting_half_a_second() {
        assert!((frame_alignment_tolerance_seconds(Some(24.0)) - 0.035_833_333_333).abs() < 0.001);
        assert_eq!(frame_alignment_tolerance_seconds(Some(2.0)), 0.265);
        assert_eq!(frame_alignment_tolerance_seconds(None), 0.25);
    }

    #[test]
    #[ignore = "requiere libmpv empaquetado y AETHERIO_SEEK_PREVIEW_TEST_VIDEO"]
    fn native_decoder_extracts_local_and_http_frames() {
        let target = std::env::var("AETHERIO_SEEK_PREVIEW_TEST_VIDEO")
            .expect("define una ruta de video local para el smoke test nativo");
        let runtime_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin/mpv");
        let local_open_started = Instant::now();
        let mut decoder = PreviewDecoder::open(&runtime_dir, &target, &[]).unwrap();
        let local_open_elapsed = local_open_started.elapsed();
        let local_frame_started = Instant::now();
        let (actual_time_ms, jpeg) = decoder.frame_at(2_000).unwrap();
        eprintln!(
            "PREVIEW_BENCH local open_ms={} first_frame_ms={} jpeg_bytes={}",
            local_open_elapsed.as_millis(),
            local_frame_started.elapsed().as_millis(),
            jpeg.len()
        );
        let image = image::load_from_memory(&jpeg).unwrap();

        assert!((0..5_000).contains(&actual_time_ms));
        assert_eq!(
            image.dimensions(),
            (PREVIEW_WIDTH as u32, PREVIEW_HEIGHT as u32)
        );
        let first_rgb = image.to_rgb8();
        let first_pixel = *first_rgb.get_pixel(0, 0);
        assert!(first_rgb.pixels().any(|pixel| *pixel != first_pixel));
        let (later_time_ms, later_jpeg) = decoder.frame_at(7_000).unwrap();
        let later_image = image::load_from_memory(&later_jpeg).unwrap().to_rgb8();
        assert!((5_000..10_000).contains(&later_time_ms));
        assert_eq!(
            later_image.dimensions(),
            (PREVIEW_WIDTH as u32, PREVIEW_HEIGHT as u32)
        );
        drop(decoder);

        let video_bytes = std::fs::read(&target).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let header_seen = Arc::new(AtomicBool::new(false));
        let server_stopped = Arc::new(AtomicBool::new(false));
        let server_header_seen = Arc::clone(&header_seen);
        let request_log = Arc::new(Mutex::new(Vec::<String>::new()));
        let server_request_log = Arc::clone(&request_log);
        let server_stopped_flag = Arc::clone(&server_stopped);
        let server = std::thread::spawn(move || {
            while !server_stopped_flag.load(Ordering::Acquire) {
                let Ok((mut connection, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                };
                let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                let mut request = Vec::new();
                let mut buffer = [0u8; 2_048];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let Ok(count) = connection.read(&mut buffer) else {
                        break;
                    };
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..count]);
                }
                let request = String::from_utf8_lossy(&request);
                if let Ok(mut requests) = server_request_log.lock() {
                    requests.push(request.lines().take(8).collect::<Vec<_>>().join(" | "));
                }
                if request
                    .lines()
                    .any(|line| line.eq_ignore_ascii_case("X-Preview-Test: visible"))
                {
                    server_header_seen.store(true, Ordering::Release);
                }
                if request.starts_with("HEAD ") {
                    let _ = write!(
                        connection,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                        video_bytes.len()
                    );
                    continue;
                }

                let range = request.lines().find_map(|line| {
                    let lower = line.to_ascii_lowercase();
                    if !lower.starts_with("range: bytes=") {
                        return None;
                    }
                    let (start, end) = lower[13..].trim().split_once('-')?;
                    Some((start.parse::<usize>().ok()?, end.parse::<usize>().ok()))
                });
                let (start, end, status) = if let Some((start, end)) = range {
                    let start = start.min(video_bytes.len().saturating_sub(1));
                    let end = end
                        .unwrap_or(video_bytes.len().saturating_sub(1))
                        .min(video_bytes.len().saturating_sub(1));
                    (start, end.max(start), "206 Partial Content")
                } else {
                    (0, video_bytes.len().saturating_sub(1), "200 OK")
                };
                let body = &video_bytes[start..=end];
                if status.starts_with("206") {
                    let _ = write!(
                        connection,
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{end}/{}\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                        body.len(),
                        video_bytes.len()
                    );
                } else {
                    let _ = write!(
                        connection,
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                }
                let _ = connection.write_all(body);
            }
        });

        let http_url = format!("http://{address}/preview.mp4");
        let http_headers = vec![(String::from("X-Preview-Test"), String::from("visible"))];
        let http_open_started = Instant::now();
        let mut http_decoder = match PreviewDecoder::open(&runtime_dir, &http_url, &http_headers) {
            Ok(decoder) => decoder,
            Err(error) => {
                server_stopped.store(true, Ordering::Release);
                server.join().unwrap();
                let requests = request_log
                    .lock()
                    .map(|requests| requests.join("\n"))
                    .unwrap_or_default();
                panic!("{error}; peticiones HTTP recibidas:\n{requests}");
            }
        };
        let http_open_elapsed = http_open_started.elapsed();
        let http_frame_started = Instant::now();
        let (http_time_ms, http_jpeg) = http_decoder.frame_at(2_000).unwrap();
        eprintln!(
            "PREVIEW_BENCH http open_ms={} first_frame_ms={} jpeg_bytes={}",
            http_open_elapsed.as_millis(),
            http_frame_started.elapsed().as_millis(),
            http_jpeg.len()
        );
        let http_image = image::load_from_memory(&http_jpeg).unwrap();
        assert!((0..5_000).contains(&http_time_ms));
        assert_eq!(
            http_image.dimensions(),
            (PREVIEW_WIDTH as u32, PREVIEW_HEIGHT as u32)
        );
        assert!(header_seen.load(Ordering::Acquire));
        server_stopped.store(true, Ordering::Release);
        server.join().unwrap();
        drop(http_decoder);

        for variable in [
            "AETHERIO_SEEK_PREVIEW_VP9_TEST_VIDEO",
            "AETHERIO_SEEK_PREVIEW_HEVC_TEST_VIDEO",
        ] {
            let Ok(codec_target) = std::env::var(variable) else {
                continue;
            };
            let mut codec_decoder = PreviewDecoder::open(&runtime_dir, &codec_target, &[]).unwrap();
            let (_, codec_jpeg) = codec_decoder.frame_at(2_000).unwrap();
            let codec_image = image::load_from_memory(&codec_jpeg).unwrap();
            assert_eq!(
                codec_image.dimensions(),
                (PREVIEW_WIDTH as u32, PREVIEW_HEIGHT as u32),
                "falló la muestra de codec {variable}"
            );
        }

        let cancel_cache_root = std::env::temp_dir().join(format!(
            "aetherio-preview-cancel-smoke-{}",
            std::process::id()
        ));
        let cancel_session = SeekPreviewSession::new(
            runtime_dir.clone(),
            target.clone(),
            None,
            cancel_cache_root.clone(),
        )
        .unwrap();
        // Let decoder startup enter its disposable warm-frame seek, then make
        // sure the user's request interrupts it instead of waiting in line.
        std::thread::sleep(Duration::from_millis(150));
        let cancel_request_started = Instant::now();
        let cancel_worker_frame = cancel_session.frame_at(2.0).unwrap();
        eprintln!(
            "PREVIEW_BENCH cancelled_warmup_request_ms={}",
            cancel_request_started.elapsed().as_millis()
        );
        let cancel_encoded = cancel_worker_frame
            .data_url
            .strip_prefix("data:image/jpeg;base64,")
            .unwrap();
        let cancel_rgb = image::load_from_memory(&BASE64.decode(cancel_encoded).unwrap())
            .unwrap()
            .to_rgb8();
        assert_eq!(cancel_rgb, first_rgb);
        drop(cancel_session);
        let _ = std::fs::remove_dir_all(cancel_cache_root);

        let cache_root = std::env::temp_dir().join(format!(
            "aetherio-preview-worker-smoke-{}",
            std::process::id()
        ));
        let session_start = Instant::now();
        let session =
            SeekPreviewSession::new(runtime_dir, target, None, cache_root.clone()).unwrap();
        let session_create_ms = session_start.elapsed().as_millis();
        // Model the playback startup interval in which the worker can open
        // in parallel before a viewer first hovers over the timeline.
        std::thread::sleep(Duration::from_millis(1_000));
        let first_request_started = Instant::now();
        let worker_frame = session.frame_at(2.0).unwrap();
        eprintln!(
            "PREVIEW_BENCH warmed_session setup_ms={} first_request_after_1000ms_ms={}",
            session_create_ms,
            first_request_started.elapsed().as_millis()
        );
        let encoded = worker_frame
            .data_url
            .strip_prefix("data:image/jpeg;base64,")
            .unwrap();
        let worker_jpeg = BASE64.decode(encoded).unwrap();
        let worker_image = image::load_from_memory(&worker_jpeg).unwrap();
        assert_eq!(
            worker_image.dimensions(),
            (PREVIEW_WIDTH as u32, PREVIEW_HEIGHT as u32)
        );
        let cached_frame = session.frame_at(2.04).unwrap();
        assert_eq!(cached_frame.data_url, worker_frame.data_url);
        let different_frame = session.frame_at(2.4).unwrap();
        assert_ne!(different_frame.data_url, worker_frame.data_url);
        let later_worker_frame = session.frame_at(5.0).unwrap();
        assert_ne!(later_worker_frame.data_url, worker_frame.data_url);
        drop(session);
        let _ = std::fs::remove_dir_all(cache_root);
    }

    #[test]
    fn preview_header_sanitization_removes_controls_and_commas() {
        assert_eq!(
            sanitize_header_value("x\r\nInjected: yes, ok"),
            "xInjected: yes  ok"
        );
    }

    #[test]
    fn header_name_uses_http_token_characters() {
        assert!("X-Client-Id".bytes().all(is_header_name_byte));
        assert!(!"X-Test: injected".bytes().all(is_header_name_byte));
    }
}
