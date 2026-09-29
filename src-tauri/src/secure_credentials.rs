const SERVICE_NAME: &str = "Aetherio";

/// Credenciales de la cache de posters en Cloudflare R2. Van en el almacen de
/// credenciales de Windows, no en el binario: dan lectura y escritura sobre el
/// bucket y no queremos que viajen embebidas en la app.
const R2_ACCOUNT_ID_KEY: &str = "r2-account-id";
const R2_ACCESS_KEY_ID_KEY: &str = "r2-access-key-id";
const R2_SECRET_ACCESS_KEY_KEY: &str = "r2-secret-access-key";
const R2_BUCKET_NAME_KEY: &str = "r2-bucket-name";

const ALLOWED_KEYS: [&str; 7] = [
    "account-session",
    "anilist-access-token",
    "seekr-api-key",
    R2_ACCOUNT_ID_KEY,
    R2_ACCESS_KEY_ID_KEY,
    R2_SECRET_ACCESS_KEY_KEY,
    R2_BUCKET_NAME_KEY,
];

/// Lectura directa desde el backend, para uso interno en el mismo proceso.
///
/// La consumen los comandos Tauri y el arranque del servidor de posters, que
/// necesita inyectar estas variables en el proceso hijo sin que pase por el
/// frontend (evita exponer el secret en el webview).
pub fn read_credential(key: &str) -> Option<String> {
    validate_key(key).ok()?;
    #[cfg(target_os = "windows")]
    {
        match entry(key).ok()?.get_password() {
            Ok(value) => Some(value),
            Err(_) => None,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Debe coincidir con `SecureCredentialKey` en src/auth/secureCredentialStore.ts.
    #[test]
    fn allows_every_key_the_frontend_uses() {
        for key in [
            "account-session",
            "anilist-access-token",
            "seekr-api-key",
            R2_ACCOUNT_ID_KEY,
            R2_ACCESS_KEY_ID_KEY,
            R2_SECRET_ACCESS_KEY_KEY,
            R2_BUCKET_NAME_KEY,
        ] {
            assert!(validate_key(key).is_ok(), "{key} deberia estar permitido");
        }
    }

    #[test]
    fn rejects_unknown_keys() {
        for key in ["", "seekr", "SEEKR-API-KEY", "seekr_api_key", "seekr-api-key-2", "r2"] {
            assert!(validate_key(key).is_err(), "{key} no deberia estar permitido");
        }
    }

    /// Una clave no permitida nunca debe devolver un valor, ni siquiera si
    /// estuviera guardada: `read_credential` se usa para armar el entorno del
    /// proceso hijo y no puede quedar abierto por error.
    #[test]
    fn read_credential_rejects_unknown_keys() {
        assert!(read_credential("cuenta-bancaria").is_none());
    }
}
