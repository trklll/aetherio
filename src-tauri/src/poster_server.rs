//! Servidor de posters (SpatialPosters) como proceso hijo de la app.
//!
//! SpatialPosters es un server Next.js y necesita Node para correr. Node y el
//! build standalone viajan como recursos (`scripts/stage-spatialposters.ps1`),
//! asi que el usuario no instala nada: al abrir Aetherio el server ya esta.
//!
//! Ciclo de vida: arranca con la app y se mata con ella. Nunca queda un proceso
//! huérfano ocupando el puerto 3000 ni RAM.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// Puerto fijo. Debe coincidir con DEFAULT_SPATIAL_POSTER_INSTANCE_URL.
const PORT: u16 = 3000;
const HOST: &str = "127.0.0.1";

/// Proxy de TMDB de Aetherio. La clave real vive como secret del Worker; aca va
/// un texto fijo porque el Worker descarta cualquier api_key del cliente.
const TMDB_BASE_URL: &str = "https://trkll.aetherio.workers.dev/api/tmdb";
const TMDB_API_KEY: &str = "via-proxy-no-se-usa";

/// Quanto esperamos a que el server responda antes de rendirse.
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const PROBE_EVERY: Duration = Duration::from_millis(250);

struct PosterServer {
    child: Child,
}

static POSTER_SERVER: Mutex<Option<PosterServer>> = Mutex::new(None);

/// Job Object de Windows que ata el node.exe a la vida de Aetherio.
///
/// Sin esto, si Aetherio crashea (o lo matan a la fuerza) queda un node.exe
/// huerfano ocupando el puerto 3000 y unos 200 MB de RAM para siempre. Con
/// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE el SO se encarga solo.
///
/// Se guarda en un static para que el handle viva mientras la app este
/// corriendo: al cerrarse el proceso, el handle se cierra y el job mata a los
/// hijos.
#[cfg(windows)]
static POSTER_JOB: Mutex<Option<isize>> = Mutex::new(None);

/// Aplica el child al Job Object. Silencioso si la API falla: es una red de
/// seguridad, no una funcion critica (si falla, el proceso se sigue managing
/// con kill() explicito en el camino normal).
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
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::addr_of!(info).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            CloseHandle(job);
            return;
        }

        // Child no expone el HANDLE de forma estable en todas las versiones,
        // asi que se reabre el proceso por id con los permisos minimos.
        let pid = child.id();
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process.is_null() {
            CloseHandle(job);
            return;
        }

        let assigned = AssignProcessToJobObject(job, process as HANDLE) != 0;
        CloseHandle(process);
        if assigned {
            if let Ok(mut guard) = POSTER_JOB.lock() {
                *guard = Some(job as isize);
            }
        } else {
            CloseHandle(job);
        }
    }
}

#[cfg(not(windows))]
fn attach_to_kill_on_close_job(_child: &Child) {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosterServerStatus {
    pub running: bool,
    /// El server esta corriendo Y respondiendo.
    pub ready: bool,
    pub pid: Option<u32>,
    pub port: u16,
    /// El usuario configuro la cache persistente en Cloudflare R2.
    pub r2_enabled: bool,
    /// Para diagnostico cuando algo falla (recurso no empaquetado, etc).
    pub detail: Option<String>,
}

/// Credenciales de la cache persistente en Cloudflare R2.
///
/// Vienen del almacen de credenciales de Windows, no del binario. Si faltan,
/// el server arranca igual y SpatialPosters sigue con su cache en memoria: R2
/// es una mejora, no un requisito.
fn r2_credentials() -> (bool, Vec<(&'static str, String)>) {
    let read = |key: &str| {
        crate::secure_credentials::read_credential(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };

    // Las tres piezas hacen falta: sin account+access+secret no hay firma
    // SigV4 valida, y R2 a medias es peor que no tenerlo.
    let (Some(account), Some(access), Some(secret)) = (
        read("r2-account-id"),
        read("r2-access-key-id"),
        read("r2-secret-access-key"),
    ) else {
        return (false, Vec::new());
    };

    let bucket = read("r2-bucket-name").unwrap_or_else(|| "spatialposters".to_string());
    (
        true,
        vec![
            ("R2_ACCOUNT_ID", account),
            ("R2_ACCESS_KEY_ID", access),
            ("R2_SECRET_ACCESS_KEY", secret),
            ("R2_BUCKET_NAME", bucket),
        ],
    )
}

/// Carpetas donde puede estar el runtime empaquetado.
///
/// El primer hit en produccion es `resource_dir()/resources/...`. Los demas son
/// solo para `tauri dev`, donde los recursos no se montan en un resource_dir.
fn candidate_roots<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
            // src-tauri/target/debug -> repo
            for up in [3usize, 4] {
                let mut p = parent.to_path_buf();
                for _ in 0..up {
                    p = match p.parent() {
                        Some(x) => x.to_path_buf(),
                        None => break,
                    };
                }
                roots.push(p);
            }
        }
    }
    roots.push(PathBuf::from("."));
    roots
}

/// Busca un recurso en una lista de raices. Aislado para poder testearlo sin
/// levantar Tauri.
fn resolve_in_roots(roots: &[PathBuf], rel: &[&str]) -> Option<PathBuf> {
    roots.iter().find_map(|root| {
        let mut path = root.clone();
        for part in rel {
            path = path.join(part);
        }
        path.exists().then_some(path)
    })
}

fn find_first<R: Runtime>(app: &AppHandle<R>, rel: &[&str]) -> Option<PathBuf> {
    resolve_in_roots(&candidate_roots(app), rel)
}

/// Un GET best-effort a /manifest.json. No necesita credenciales y no llama a TMDB.
fn probe_ready() -> bool {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(1500))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(format!("http://{HOST}:{PORT}/manifest.json"))
        .send()
        .map(|r| r.status().is_success() || r.status().is_client_error())
        .unwrap_or(false)
}

fn stop_locked() {
    if let Some(mut server) = POSTER_SERVER.lock().ok().and_then(|mut g| g.take()) {
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
}

/// Arranca el server si no esta corriendo. Es idempotente: si ya hay un proceso
/// sano en el puerto, no hace nada.
///
/// Se bloquea hasta que responde o se agota `READY_TIMEOUT`, para que el primer
/// sondeo de disponibilidad del frontend ya lo encuentre vivo.
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<PosterServerStatus, String> {
    // Ya hay alguien escuchando: es nuestro server de una corrida anterior o
    // una instancia manual del usuario. No lo matamos ni lo reclamamos.
    if probe_ready() {
        return Ok(PosterServerStatus {
            running: true,
            ready: true,
            pid: None,
            port: PORT,
            r2_enabled: r2_credentials().0,
            detail: Some("ya hay un servidor de posters escuchando en el puerto".into()),
        });
    }

    let app_dir = find_first(app, &["resources", "spatialposters", "server.js"]);
    let app_dir = match app_dir {
        Some(p) => p,
        None => {
            return Err(
                "No se encontro el runtime de SpatialPosters. Falta correr \
                 `npm run posters:stage` para empaquetarlo."
                    .into(),
            )
        }
    };
    let app_dir = app_dir
        .parent()
        .ok_or("Ruta de SpatialPosters invalida")?
        .to_path_buf();

    let node = find_first(app, &["resources", "bin", "node.exe"])
        .or_else(|| find_first(app, &["bin", "node.exe"]))
        .or_else(|| find_first(app, &["resources", "bin", "node"]))
        .ok_or(
            "No se encontro el runtime Node empaquetado. Falta correr \
             `npm run posters:stage`."
                .to_string(),
        )?;

    let (r2_enabled, r2_env) = r2_credentials();

    let mut command = Command::new(&node);
    command
        .arg("server.js")
        .current_dir(&app_dir)
        .env("PORT", PORT.to_string())
        .env("HOSTNAME", HOST)
        .env("NODE_ENV", "production")
        .env("TMDB_BASE_URL", TMDB_BASE_URL)
        .env("TMDB_API_KEY", TMDB_API_KEY)
        // Sin esto Next podria intentar escribir .next/cache y fallar en un
        // directorio de solo lectura.
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Cache persistente de posters. Si el usuario no la configuro, el server
    // arranca igual con su cache en memoria.
    for (key, value) in r2_env {
        command.env(key, value);
    }

    // Sin este flag, cada vez que Aetherio abre su Ventana de consola salta
    // delante de la app con el titulo "next-server". El usuario la ve, le
    // molesta, y no hay forma de cerrarla sin matar el server de posters.
    // CREATE_NO_WINDOW = 0x0800_0000: crea el proceso sin consola, igual que
    // si se hubiera lanzado desde un proceso que ya era GUI.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command.spawn().map_err(|e| format!("No se pudo lanzar Node: {e}"))?;

    let pid = child.id();
    attach_to_kill_on_close_job(&child);
    if let Ok(mut guard) = POSTER_SERVER.lock() {
        *guard = Some(PosterServer { child });
    }

    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline {
        if probe_ready() {
            return Ok(PosterServerStatus {
                running: true,
                ready: true,
            pid: Some(pid),
            port: PORT,
            r2_enabled,
            detail: None,
            });
        }
        // Si el proceso murio, no esperemos los 20 s de ahi para nada.
        if !our_child_alive() {
            stop_locked();
            return Err("El servidor de posters arranco y se cerro de inmediato.".into());
        }
        std::thread::sleep(PROBE_EVERY);
    }

    // No respondio: no lo dejamos ocupando el puerto a ciegas.
    stop_locked();
    Err(format!(
        "El servidor de posters no respondio en {} s.",
        READY_TIMEOUT.as_secs()
    ))
}

/// URL por defecto: la instancia local que levanta la propia app.
const DEFAULT_INSTANCE_URL: &str = "http://localhost:3000";

/// Normaliza a `host:puerto` para comparar dos URLs sin que estorben el
/// esquema, la barra final o las mayusculas.
fn host_port_of(url: &str) -> Option<String> {
    let rest = url
        .trim()
        .strip_prefix("http://")
        .or_else(|| url.trim().strip_prefix("https://"))?
        .trim_end_matches('/');
    (!rest.is_empty()).then(|| rest.to_ascii_lowercase())
}

/// ¿El usuario dejo la instancia donde viene, o la movio a otro lado?
pub fn uses_default_instance(configured_url: &str) -> bool {
    let configured = configured_url.trim();
    if configured.is_empty() {
        return true;
    }
    host_port_of(configured).as_deref() == host_port_of(DEFAULT_INSTANCE_URL).as_deref()
}

/// Arranca el cache de posters en disco cuando la instancia sigue en su sitio.
///
/// Si el usuario movio la instancia (NAS, otra PC, otro puerto) no metemos mano:
/// se respeta su eleccion y sus posters no pasan por nuestro disco.
pub fn start_cache_if_default<R: Runtime>(app: &AppHandle<R>, configured_url: &str) -> bool {
    if !uses_default_instance(configured_url) {
        return false;
    }
    let Some(dir) = app.path().app_data_dir().ok() else {
        return false;
    };
    crate::poster_cache::start(dir.join("poster-cache")).is_ok()
}

pub fn stop() {
    stop_locked();
}

pub fn status() -> PosterServerStatus {
    let pid = POSTER_SERVER
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.child.id()));
    let ready = probe_ready();
    PosterServerStatus {
        running: pid.is_some() || ready,
        ready,
        pid,
        port: PORT,
        r2_enabled: r2_credentials().0,
        detail: None,
    }
}

/// ¿El proceso que lanzamos nosotros sigue vivo?
fn our_child_alive() -> bool {
    match POSTER_SERVER.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(server) => matches!(server.child.try_wait(), Ok(None)),
            None => false,
        },
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_ready_es_rapido_y_no_panica_si_no_hay_server() {
        // No debe colgar aunque no haya nada escuchando.
        let start = Instant::now();
        let _ = probe_ready();
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn stop_es_idempotente() {
        stop();
        stop();
        assert!(!our_child_alive());
    }

    #[test]
    fn resuelve_el_runtime_por_debajo_de_resources() {
        let tmp = std::env::temp_dir().join("aetherio-resolve-test");
        let server = tmp.join("resources").join("spatialposters");
        std::fs::create_dir_all(&server).unwrap();
        std::fs::write(server.join("server.js"), "").unwrap();

        let found = resolve_in_roots(&[tmp.clone()], &["resources", "spatialposters", "server.js"]);
        assert_eq!(found, Some(server.join("server.js")));

        let node_dir = tmp.join("resources").join("bin");
        std::fs::create_dir_all(&node_dir).unwrap();
        std::fs::write(node_dir.join("node.exe"), "").unwrap();
        assert_eq!(
            resolve_in_roots(&[tmp.clone()], &["resources", "bin", "node.exe"]),
            Some(node_dir.join("node.exe"))
        );

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn prueba_varias_raices_y_devuelve_none_si_no_encuentra() {
        let a = std::env::temp_dir().join("aetherio-resolve-a");
        let b = std::env::temp_dir().join("aetherio-resolve-b");
        std::fs::create_dir_all(b.join("resources").join("bin")).unwrap();
        std::fs::write(b.join("resources").join("bin").join("node.exe"), "").unwrap();

        // La primera raiz no tiene nada: tiene que caer a la segunda.
        let found = resolve_in_roots(&[a.clone(), b.clone()], &["resources", "bin", "node.exe"]);
        assert_eq!(found, Some(b.join("resources").join("bin").join("node.exe")));
        assert_eq!(resolve_in_roots(&[a], &["no", "existe"]), None);

        std::fs::remove_dir_all(&b).ok();
    }
}

// ---------------------------------------------------------------- comandos Tauri

/// Levanta el server de posters. Idempotente: si ya responde, no hace nada.
///
/// `configured_url` es lo que el usuario tiene en Ajustes. Se lo pasa el
/// frontend para que Rust sepa si la instancia sigue en su sitio: si la movio
/// a otro lado, el cache propio se aparta y respeta su eleccion.
///
/// Se expone como comando async para no bloquear el hilo de la UI mientras
/// espera los primeros segundos de Node.
#[tauri::command]
pub async fn start_posters_server(
    app: tauri::AppHandle,
    configured_url: String,
) -> Result<PosterServerStatus, String> {
    let handle = app.clone();
    let status = tauri::async_runtime::spawn_blocking(move || start(&handle))
        .await
        .map_err(|e| format!("Fallo el arranque del server de posters: {e}"))??;

    // El cache va despues: necesita que el server este vivo para poder ser su
    // upstream, y si falla no importa, los posters siguen funcionando sin el.
    start_cache_if_default(&app, &configured_url);
    Ok(status)
}

#[tauri::command]
pub fn stop_posters_server() {
    stop();
}

#[tauri::command]
pub fn posters_server_status() -> PosterServerStatus {
    status()
}
