//! Utilidad de desarrollo: escribe las credenciales de R2 en el mismo almacen
//! que usa la app, para no tener que pegarlas en Ajustes a mano.
//!
//! Usa el crate `keyring` con el mismo service/user que
//! `secure_credentials.rs`, así que lo que escriba esto es exactamente lo que
//! lee el servidor de posters al arrancar.
//!
//! Uso (PowerShell):
//! ```powershell
//! $env:AETHERIO_R2_ACCOUNT_ID="..."
//! $env:AETHERIO_R2_ACCESS_KEY_ID="..."
//! $env:AETHERIO_R2_SECRET_ACCESS_KEY="..."
//! $env:AETHERIO_R2_BUCKET_NAME="spatialposters"   # opcional
//! cargo test --test r2_credentials -- --ignored --nocapture
//! ```
//!
//! Sin esas variables el test no hace nada, asi que es seguro dejarlo en el repo.

const SERVICE: &str = "Aetherio";

fn write(key: &str, value: &str) {
    let entry = keyring::Entry::new(SERVICE, key).expect("no se pudo abrir la entrada");
    match entry.set_password(value) {
        Ok(()) => println!("  OK  {key}"),
        Err(error) => println!("  X   {key}: {error}"),
    }
}

#[test]
#[ignore = "es una utilidad manual: corre solo si hay variables de entorno"]
fn escribe_credenciales_r2() {
    let fields: [(&str, &str, &str); 4] = [
        ("r2-account-id", "AETHERIO_R2_ACCOUNT_ID", "Account ID"),
        ("r2-access-key-id", "AETHERIO_R2_ACCESS_KEY_ID", "Access Key ID"),
        ("r2-secret-access-key", "AETHERIO_R2_SECRET_ACCESS_KEY", "Secret Access Key"),
        ("r2-bucket-name", "AETHERIO_R2_BUCKET_NAME", "Bucket"),
    ];

    let mut wrote = 0;
    for (key, env, label) in fields {
        match std::env::var(env) {
            Ok(value) if !value.trim().is_empty() => {
                println!("{label}:");
                write(key, value.trim());
                wrote += 1;
            }
            _ => println!("{label}: sin valor, se deja como estaba"),
        }
    }

    if wrote == 0 {
        println!("No habia ninguna variable AETHERIO_R2_* definida. No se escribio nada.");
        return;
    }

    println!("\nVerificacion (se releen del mismo almacen):");
    for (key, _, label) in fields {
        match keyring::Entry::new(SERVICE, key).and_then(|e| e.get_password()) {
            Ok(value) => {
                // No imprimir el secret entero.
                let shown = if key == "r2-secret-access-key" {
                    format!("{} ({} caracteres)", &value[..value.len().min(4)], value.len())
                } else {
                    value
                };
                println!("  {label}: {shown}");
            }
            Err(_) => println!("  {label}: (sin guardar)"),
        }
    }
}
