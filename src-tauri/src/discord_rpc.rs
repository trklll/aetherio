use std::sync::Mutex;

use discord_rich_presence::activity::{self, ActivityType};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

const DISCORD_CLIENT_ID: &str = "1531888157715468398";

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
    pub url: String,
}

pub struct DiscordRpcState {
    client: Mutex<Option<DiscordIpcClient>>,
}

impl DiscordRpcState {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
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
            .filter(|b| !b.label.is_empty() && !b.url.is_empty())
            .take(2)
            .map(|b| activity::Button::new(&b.label, &b.url))
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

#[tauri::command]
pub fn discord_rpc_start(state: tauri::State<'_, DiscordRpcState>) -> Result<(), String> {
    let mut guard = state
        .client
        .lock()
        .map_err(|_| "Discord RPC mutex poisoned.".to_string())?;

    if guard.is_some() {
        return Ok(());
    }

    let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID).map_err(error_message)?;
    client.connect().map_err(error_message)?;
    *guard = Some(client);
    Ok(())
}

#[tauri::command]
pub fn discord_rpc_stop(state: tauri::State<'_, DiscordRpcState>) -> Result<(), String> {
    let mut guard = state
        .client
        .lock()
        .map_err(|_| "Discord RPC mutex poisoned.".to_string())?;

    if let Some(mut client) = guard.take() {
        let _ = client.clear_activity();
        let _ = client.close();
    }
    Ok(())
}

#[tauri::command]
pub fn discord_rpc_set_activity(
    state: tauri::State<'_, DiscordRpcState>,
    payload: ActivityPayload,
) -> Result<(), String> {
    let mut guard = state
        .client
        .lock()
        .map_err(|_| "Discord RPC mutex poisoned.".to_string())?;

    if guard.is_none() {
        let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID).map_err(error_message)?;
        client.connect().map_err(error_message)?;
        *guard = Some(client);
    }

    if let Some(client) = guard.as_mut() {
        let activity = build_activity(&payload);
        client.set_activity(activity).map_err(error_message)?;
    }
    Ok(())
}

#[tauri::command]
pub fn discord_rpc_clear(state: tauri::State<'_, DiscordRpcState>) -> Result<(), String> {
    let mut guard = state
        .client
        .lock()
        .map_err(|_| "Discord RPC mutex poisoned.".to_string())?;

    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
    }
    Ok(())
}
