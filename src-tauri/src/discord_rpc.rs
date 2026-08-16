use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::Duration;

use discord_rich_presence::activity::{self, ActivityType};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

const DISCORD_CLIENT_ID: &str = "1531888157715468398";
const POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPayload {
    #[serde(default)]
    pub details: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub start_timestamp: Option<i64>,
    #[serde(default)]
    pub end_timestamp: Option<i64>,
    #[serde(default)]
    pub large_image_key: Option<String>,
    #[serde(default)]
    pub large_image_text: Option<String>,
    #[serde(default)]
    pub small_image_key: Option<String>,
    #[serde(default)]
    pub small_image_text: Option<String>,
    #[serde(default)]
    pub buttons: Vec<ActivityButton>,
}

#[derive(Debug, Clone, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityButton {
    pub label: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub custom_id: Option<String>,
}

enum DiscordRpcCommand {
    Set(ActivityPayload),
    Clear,
    Stop,
}

struct DiscordRpcHandle {
    tx: Sender<DiscordRpcCommand>,
    #[allow(dead_code)]
    thread: JoinHandle<()>,
}

pub struct DiscordRpcState {
    handle: Mutex<Option<DiscordRpcHandle>>,
}

impl DiscordRpcState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }
}

impl Default for DiscordRpcState {
    fn default() -> Self {
        Self::new()
    }
}

fn build_activity(payload: &ActivityPayload) -> activity::Activity<'_> {
    let mut act = activity::Activity::new();
    if !payload.details.is_empty() {
        act = act.details(&payload.details);
    }
    if !payload.state.is_empty() {
        act = act.state(&payload.state);
    }

    let has_start = payload.start_timestamp.is_some_and(|v| v > 0);
    let has_end = payload.end_timestamp.is_some_and(|v| v > 0);
    if has_start || has_end {
        let mut ts = activity::Timestamps::new();
        if has_start {
            ts = ts.start(payload.start_timestamp.unwrap());
        }
        if has_end {
            ts = ts.end(payload.end_timestamp.unwrap());
        }
        act = act.timestamps(ts);
    }

    let large_key: &str = payload
        .large_image_key
        .as_deref()
        .filter(|v| !v.is_empty())
        .unwrap_or("aetherio");
    let large_text: &str = payload
        .large_image_text
        .as_deref()
        .filter(|v| !v.is_empty())
        .unwrap_or("Aetherio");

    let mut assets = activity::Assets::new()
        .large_image(large_key)
        .large_text(large_text);

    if let Some(small_key) = payload.small_image_key.as_deref().filter(|v| !v.is_empty()) {
        assets = assets.small_image(small_key);
        if let Some(small_text) = payload.small_image_text.as_deref().filter(|v| !v.is_empty()) {
            assets = assets.small_text(small_text);
        }
    }
    act = act.assets(assets);

    if !payload.buttons.is_empty() {
        let buttons: Vec<activity::Button<'_>> = payload
            .buttons
            .iter()
            .filter(|b| {
                !b.label.is_empty()
                    && (!b.url.is_empty() || b.custom_id.as_deref().is_some_and(|c| !c.is_empty()))
            })
            .take(2)
            .map(|b| match b.custom_id.as_deref().filter(|c| !c.is_empty()) {
                Some(custom_id) => activity::Button::new_custom(&b.label, custom_id),
                None => activity::Button::new(&b.label, &b.url),
            })
            .collect();
        if !buttons.is_empty() {
            act = act.buttons(buttons);
        }
    }

    act = act.activity_type(ActivityType::Watching);
    act
}

fn error_message(err: Box<dyn std::error::Error>) -> String {
    format!("Discord RPC: {err}")
}

/// Parses a button `custom_id` (e.g. `open:movie:550` / `details:series:tmdb:1399`)
/// into a JSON payload forwarded to the renderer.
fn parse_action_secret(secret: &str) -> serde_json::Value {
    let mut parts = secret.splitn(3, ':');
    let action = parts.next().unwrap_or("open").trim();
    let kind = parts.next().unwrap_or("").trim();
    let id = parts.next().unwrap_or("").trim();

    if !kind.is_empty() && !id.is_empty() {
        json!({ "action": action, "kind": kind, "id": id })
    } else {
        json!({ "action": if action.is_empty() { "open" } else { action } })
    }
}

/// Brings the main window to the foreground so the button click visibly
/// "opens" the app, even when it was minimized or hidden behind other windows.
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_incoming_frame(app: &AppHandle, frame: &serde_json::Value) {
    let cmd = frame.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
    let evt = frame.get("evt").and_then(|v| v.as_str()).unwrap_or("");
    if cmd != "DISPATCH" || evt != "ACTIVITY_JOIN" {
        return;
    }

    let secret = frame
        .get("data")
        .and_then(|data| data.get("secret"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if secret.is_empty() {
        return;
    }

    let payload = parse_action_secret(&secret);
    focus_main_window(app);
    let _ = app.emit("discord-action", payload);
}

fn spawn_client(app: AppHandle) -> Result<DiscordRpcHandle, String> {
    let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID).map_err(error_message)?;
    client.connect().map_err(error_message)?;

    let (tx, rx) = mpsc::channel::<DiscordRpcCommand>();
    let thread = std::thread::spawn(move || {
        loop {
            while let Ok(command) = rx.try_recv() {
                match command {
                    DiscordRpcCommand::Set(payload) => {
                        let _ = client.set_activity(build_activity(&payload));
                    }
                    DiscordRpcCommand::Clear => {
                        let _ = client.clear_activity();
                    }
                    DiscordRpcCommand::Stop => {
                        let _ = client.close();
                        return;
                    }
                }
            }

            let has_frame = match client.has_pending_frame() {
                Ok(has_frame) => has_frame,
                Err(_) => {
                    let _ = client.close();
                    return;
                }
            };
            if has_frame {
                match client.recv() {
                    Ok((_opcode, frame)) => handle_incoming_frame(&app, &frame),
                    Err(_) => {
                        let _ = client.close();
                        return;
                    }
                }
            } else {
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    });

    Ok(DiscordRpcHandle { tx, thread })
}

fn send_command(
    state: &DiscordRpcState,
    app: AppHandle,
    command: DiscordRpcCommand,
) -> Result<(), String> {
    let mut guard = state
        .handle
        .lock()
        .map_err(|_| "Discord RPC mutex poisoned.".to_string())?;

    if guard.is_none() {
        *guard = Some(spawn_client(app)?);
    }

    if let Some(handle) = guard.as_ref() {
        handle
            .tx
            .send(command)
            .map_err(|_| "Discord RPC worker detenido.".to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn discord_rpc_start(app: AppHandle, state: tauri::State<'_, DiscordRpcState>) -> Result<(), String> {
    let mut guard = state
        .handle
        .lock()
        .map_err(|_| "Discord RPC mutex poisoned.".to_string())?;

    if guard.is_none() {
        *guard = Some(spawn_client(app)?);
    }
    Ok(())
}

#[tauri::command]
pub fn discord_rpc_stop(state: tauri::State<'_, DiscordRpcState>) -> Result<(), String> {
    let mut guard = state
        .handle
        .lock()
        .map_err(|_| "Discord RPC mutex poisoned.".to_string())?;

    if let Some(handle) = guard.take() {
        let _ = handle.tx.send(DiscordRpcCommand::Stop);
    }
    Ok(())
}

#[tauri::command]
pub fn discord_rpc_set_activity(
    app: AppHandle,
    state: tauri::State<'_, DiscordRpcState>,
    payload: ActivityPayload,
) -> Result<(), String> {
    send_command(&state, app, DiscordRpcCommand::Set(payload))
}

#[tauri::command]
pub fn discord_rpc_clear(
    app: AppHandle,
    state: tauri::State<'_, DiscordRpcState>,
) -> Result<(), String> {
    send_command(&state, app, DiscordRpcCommand::Clear)
}