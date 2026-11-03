//! Proceso local de Sports (basado en el addon upstream de Nuvio).
//!
//! El addon se empaqueta desde un checkout local cuya licencia se valida en
//! `scripts/stage-nuvio.ps1`. Se inicia al entrar en Sports y se cierra con
//! Aetherio. Tanto el addon como su resolver interno quedan limitados a loopback.

use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

const PORT: u16 = 7310;
const RESOLVER_PORT: u16 = 7311;
const HOST: &str = "127.0.0.1";
const READY_TIMEOUT: Duration = Duration::from_secs(25);
const PROBE_EVERY: Duration = Duration::from_millis(250);
const MANIFEST_ID: &str = "community.nuvio.live-sports";

struct NuvioServer {
    child: Child,
}

static NUVIO_SERVER: Mutex<Option<NuvioServer>> = Mutex::new(None);
static NUVIO_START_LOCK: Mutex<()> = Mutex::new(());

/// Job Object propio: Node inicia un resolver hijo, así que ambos deben morir
/// incluso si Windows cierra Aetherio de forma abrupta.
#[cfg(windows)]
static NUVIO_JOB: Mutex<Option<isize>> = Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NuvioServerStatus {
    pub running: bool,
    pub ready: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub detail: Option<String>,
}

#[cfg(windows)]
fn attach_to_kill_on_close_job(child: &Child) {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    unsafe {
        let job = match NUVIO_JOB.lock() {
            Ok(mut guard) => match *guard {
                Some(raw) => raw as HANDLE,
                None => {
                    let created = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                    if created.is_null() {
                        return;
                    }
                    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    if SetInformationJobObject(
                        created,
                        JobObjectExtendedLimitInformation,
                        std::ptr::addr_of!(info).cast(),
                        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    ) == 0
                    {
                        CloseHandle(created);
                        return;
                    }
                    *guard = Some(created as isize);
                    created
                }
            },
            Err(_) => return,
        };

        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, child.id());
        if process.is_null() {
            return;
        }
        let _ = AssignProcessToJobObject(job, process as HANDLE);
        CloseHandle(process);
    }
}

#[cfg(not(windows))]
fn attach_to_kill_on_close_job(_child: &Child) {}

#[cfg(windows)]
fn terminate_job() {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::TerminateJobObject;

    if let Some(raw) = NUVIO_JOB.lock().ok().and_then(|mut guard| guard.take()) {
        unsafe {
            let job = raw as HANDLE;
            let _ = TerminateJobObject(job, 1);
            CloseHandle(job);
        }
    }
}

#[cfg(not(windows))]
fn terminate_job() {}

fn candidate_roots<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    // In dev, staging updates the workspace, not Cargo's previously copied
    // resources. Prefer the current staged package over a stale debug copy.
    #[cfg(debug_assertions)]
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let mut root = parent.to_path_buf();
            for _ in 0..=4 {
                roots.push(root.clone());
                let Some(up) = root.parent() else { break };
                root = up.to_path_buf();
            }
        }
    }
    roots.push(PathBuf::from("."));
    roots
}

fn resolve_in_roots(roots: &[PathBuf], suffixes: &[&[&str]]) -> Option<PathBuf> {
    roots.iter().find_map(|root| {
        suffixes.iter().find_map(|suffix| {
            let candidate = suffix
                .iter()
                .fold(root.clone(), |path, part| path.join(part));
            // A relative entrypoint would resolve against writable AppData
            // after current_dir() changes, not against this candidate root.
            candidate.is_file().then(|| std::path::absolute(candidate).ok()).flatten()
        })
    })
}

fn find_entrypoint<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    const SUFFIXES: &[&[&str]] = &[
        &["resources", "nuvio-live-sports", "dist", "index.js"],
        &["nuvio-live-sports", "dist", "index.js"],
        &[
            "src-tauri",
            "resources",
            "nuvio-live-sports",
            "dist",
            "index.js",
        ],
    ];
    resolve_in_roots(&candidate_roots(app), SUFFIXES)
}

fn find_node<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    const SUFFIXES: &[&[&str]] = &[
        &["resources", "bin", "node.exe"],
        &["bin", "node.exe"],
        &["src-tauri", "resources", "bin", "node.exe"],
        &["resources", "bin", "node"],
        &["bin", "node"],
        &["src-tauri", "resources", "bin", "node"],
    ];
    resolve_in_roots(&candidate_roots(app), SUFFIXES)
}

fn path_with_node(node: &PathBuf) -> Result<OsString, String> {
    let parent = node
        .parent()
        .ok_or_else(|| String::from("La ruta del runtime Node no es válida."))?;
    let mut paths = vec![parent.to_path_buf()];
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    std::env::join_paths(paths)
        .map_err(|error| format!("No se pudo preparar PATH para Node: {error}"))
}

fn manifest_url() -> String {
    format!("http://{HOST}:{PORT}/manifest.json")
}

fn probe_ready() -> bool {
    let client = match reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(1500))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    client
        .get(manifest_url())
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .and_then(|response| response.json::<serde_json::Value>())
        .map(|manifest| manifest.get("id").and_then(serde_json::Value::as_str) == Some(MANIFEST_ID))
        .unwrap_or(false)
}

fn open_log_file(path: &Path) -> std::io::Result<File> {
    if std::fs::metadata(path).map(|info| info.len() > 1_048_576).unwrap_or(false) {
        let previous = path.with_file_name("service.previous.log");
        if previous.exists() {
            std::fs::remove_file(&previous)?;
        }
        std::fs::rename(path, previous)?;
    }
    OpenOptions::new().create(true).append(true).open(path)
}

fn stop_locked() {
    if let Some(mut server) = NUVIO_SERVER.lock().ok().and_then(|mut guard| guard.take()) {
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
    terminate_job();
}

pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<NuvioServerStatus, String> {
    let _start_guard = NUVIO_START_LOCK
        .lock()
        .map_err(|_| String::from("No se pudo sincronizar el inicio de Sports."))?;

    if probe_ready() {
        return Ok(NuvioServerStatus {
            running: true,
            ready: true,
            pid: NUVIO_SERVER
                .lock()
                .ok()
                .and_then(|guard| guard.as_ref().map(|server| server.child.id())),
            port: PORT,
            detail: Some(String::from(
                "La instancia local de Sports ya estaba activa.",
            )),
        });
    }

    let working_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo localizar AppData para Sports: {error}"))?
        .join("nuvio-live-sports");
    std::fs::create_dir_all(working_dir.join("data")).map_err(|error| {
        format!("No se pudo preparar el almacenamiento local de Sports: {error}")
    })?;
    let log_path = working_dir.join("service.log");
    if our_child_alive() {
        let pid = NUVIO_SERVER.lock().ok()
            .and_then(|guard| guard.as_ref().map(|server| server.child.id()))
            .ok_or("El proceso de Sports cambió durante la comprobación.")?;
        return wait_for_ready(pid, &log_path);
    }
    stop_locked();

    let entrypoint = find_entrypoint(app).ok_or_else(|| {
        String::from(
            "No se encontró Sports empaquetado. Ejecuta `npm run nuvio:stage` y vuelve a compilar Aetherio.",
        )
    })?;
    let node = find_node(app).ok_or_else(|| {
        String::from("No se encontró Node empaquetado. Comprueba src-tauri/resources/bin/node.exe.")
    })?;
    let node_path = path_with_node(&node)?;
    let mut log = open_log_file(&log_path).map_err(|error| {
        format!("No se pudo abrir el registro de Sports ({}): {error}", log_path.display())
    })?;
    let _ = writeln!(log, "\n[Aetherio] Node: {}; addon: {}", node.display(), entrypoint.display());
    let output = log.try_clone().map_err(|error| format!("No se pudo preparar el registro de Sports: {error}"))?;

    let mut command = Command::new(&node);
    command
        .arg(&entrypoint)
        .current_dir(&working_dir)
        // No filtramos al addon las credenciales ni variables de entorno de Aetherio.
        .env_clear()
        .env("PORT", PORT.to_string())
        .env("RESOLVER_PORT", RESOLVER_PORT.to_string())
        .env("HOST", HOST)
        .env("IP", HOST)
        .env("ADDON_URL", format!("http://{HOST}:{PORT}"))
        .env("NODE_ENV", "production")
        .env("PATH", node_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output))
        .stderr(Stdio::from(log));

    // El runtime de Windows y la carpeta temporal siguen siendo necesarios
    // aunque el proceso no herede el resto del entorno de Aetherio.
    for key in ["SYSTEMROOT", "WINDIR", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("No se pudo iniciar el servidor local de Sports: {error}"))?;
    let pid = child.id();
    attach_to_kill_on_close_job(&child);
    if let Ok(mut guard) = NUVIO_SERVER.lock() {
        *guard = Some(NuvioServer { child });
    }

    wait_for_ready(pid, &log_path)
}

fn wait_for_ready(pid: u32, log_path: &Path) -> Result<NuvioServerStatus, String> {
    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline {
        if probe_ready() {
            return Ok(NuvioServerStatus {
                running: true,
                ready: true,
                pid: Some(pid),
                port: PORT,
                detail: None,
            });
        }
        if !our_child_alive() {
            stop_locked();
            return Err(format!(
                "El servidor local de Sports se cerró durante el arranque. Detalles en {}.", log_path.display(),
            ));
        }
        std::thread::sleep(PROBE_EVERY);
    }

    stop_locked();
    Err(format!(
        "Sports no respondió en {} segundos. Detalles en {}.",
        READY_TIMEOUT.as_secs(), log_path.display()
    ))
}

pub fn stop() {
    if let Ok(_start_guard) = NUVIO_START_LOCK.lock() {
        stop_locked();
    }
}

pub fn status() -> NuvioServerStatus {
    let pid = NUVIO_SERVER
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|server| server.child.id()));
    let ready = probe_ready();
    NuvioServerStatus {
        running: ready || our_child_alive(),
        ready,
        pid,
        port: PORT,
        detail: None,
    }
}

fn our_child_alive() -> bool {
    match NUVIO_SERVER.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(server) => matches!(server.child.try_wait(), Ok(None)),
            None => false,
        },
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn start_nuvio_sports_server(app: AppHandle) -> Result<NuvioServerStatus, String> {
    tauri::async_runtime::spawn_blocking(move || start(&app))
        .await
        .map_err(|error| format!("Falló el inicio del servidor local de Sports: {error}"))?
}

#[tauri::command]
pub fn stop_nuvio_sports_server() {
    stop();
}

#[tauri::command]
pub fn nuvio_sports_server_status() -> NuvioServerStatus {
    status()
}

#[cfg(test)]
mod tests {
    use super::{manifest_url, open_log_file, resolve_in_roots, stop, PORT};
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn addon_probe_is_bound_to_ipv4_loopback() {
        assert_eq!(manifest_url(), "http://127.0.0.1:7310/manifest.json");
        assert_eq!(PORT, 7310);
    }

    #[test]
    fn finds_only_files_inside_candidate_roots() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "aetherio-nuvio-test-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        let nested = root.join("resources/nuvio-live-sports/dist/index.js");
        std::fs::create_dir_all(nested.parent().unwrap()).unwrap();
        std::fs::write(&nested, "").unwrap();

        let found = resolve_in_roots(
            &[root.clone()],
            &[&["resources", "nuvio-live-sports", "dist", "index.js"]],
        );
        assert_eq!(found, Some(nested));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stop_is_idempotent_without_a_started_child() {
        stop();
        stop();
    }

    #[test]
    fn startup_logs_are_persistent_and_rotated_before_the_next_launch() {
        let root = std::env::temp_dir().join(format!("aetherio-nuvio-log-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let log = root.join("service.log");
        std::fs::write(&log, vec![b'x'; 1_048_577]).unwrap();
        let mut file = open_log_file(&log).unwrap();
        writeln!(file, "next startup").unwrap();
        drop(file);
        assert_eq!(std::fs::metadata(root.join("service.previous.log")).unwrap().len(), 1_048_577);
        assert!(std::fs::read_to_string(&log).unwrap().contains("next startup"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
