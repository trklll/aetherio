const SERVICE_NAME: &str = "Aetherio";
const ALLOWED_KEYS: [&str; 2] = ["account-session", "anilist-access-token"];

fn validate_key(key: &str) -> Result<(), String> {
    if ALLOWED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err("Unsupported secure credential key.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn entry(key: &str) -> Result<keyring::Entry, String> {
    validate_key(key)?;
    keyring::Entry::new(SERVICE_NAME, key).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secure_credential_set(key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    if value.is_empty() {
        return Err("Secure credential value cannot be empty.".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        return entry(&key)?
            .set_password(&value)
            .map_err(|error| error.to_string());
    }
    #[cfg(not(target_os = "windows"))]
    Err("Secure credential storage is not available on this platform.".to_string())
}

#[tauri::command]
pub fn secure_credential_get(key: String) -> Result<Option<String>, String> {
    validate_key(&key)?;
    #[cfg(target_os = "windows")]
    {
        return match entry(&key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        };
    }
    #[cfg(not(target_os = "windows"))]
    Err("Secure credential storage is not available on this platform.".to_string())
}

#[tauri::command]
pub fn secure_credential_delete(key: String) -> Result<(), String> {
    validate_key(&key)?;
    #[cfg(target_os = "windows")]
    {
        return match entry(&key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }
    #[cfg(not(target_os = "windows"))]
    Err("Secure credential storage is not available on this platform.".to_string())
}
