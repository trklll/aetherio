# Aetherio

Aetherio es una aplicación multimedia de escritorio construida con React, TypeScript y Tauri 2.

## Desarrollo en Windows

Requisitos:

- Node.js LTS
- Rust estable
- PowerShell

Instala las dependencias y prepara el runtime local de MPV:

```powershell
npm ci
./scripts/install-mpv.ps1
```

Inicia la aplicación:

```powershell
npm run tauri dev
```

La compilación del frontend se valida con:

```powershell
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Actualizaciones mediante Aetherio Web

La aplicación consulta el endpoint dinámico de Aetherio Web alojado en Cloudflare. El registro de versiones, hashes SHA-256 y firmas vive en Cloudflare D1; GitHub Releases se utiliza únicamente como almacenamiento gratuito de los instaladores. No se necesita `latest.json`.

Cuando encuentra una versión SemVer superior, Aetherio muestra el popup, descarga el instalador, valida la firma minisign incluida en el registro interno, lo instala y reinicia. El pipeline comprueba antes de publicar que la firma fue creada por la misma clave pública incluida en la aplicación.

El sitio público está disponible en [aetherio.aetherio.workers.dev](https://aetherio.aetherio.workers.dev). Su código vive en [`website/`](website/) y el mismo Worker sirve la web, la descarga del instalador y el endpoint del updater.

El workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) compila el instalador, publica sus firmas y registra el release en Aetherio Web. GitHub debe tener configurados `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_LEGACY` y `AETHERIO_RELEASE_TOKEN`.

La clave privada:

- nunca debe añadirse al repositorio;
- debe conservarse en una copia de seguridad segura;
- no puede reemplazarse sin romper las actualizaciones de instalaciones existentes.

La clave pública sí vive en `src-tauri/tauri.conf.json` y únicamente sirve para verificar firmas.

La clave estable de Aetherio es `A0C57F8E4D799EDB`. Las instalaciones `0.3.0–0.4.0` incluyeron por error otra clave pública mientras sus releases seguían firmándose con la clave estable. Esas instalaciones requieren descargar una vez el instalador de reparación desde Aetherio Web. Después de reinstalar, vuelven al canal interno normal.

### Publicar una versión

1. Actualiza el mismo número SemVer en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`.
2. Actualiza los lockfiles y valida la compilación.
3. Crea el commit de la versión.
4. Crea y sube una etiqueta que coincida con esa versión:

```powershell
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

La etiqueta inicia el workflow. Cuando termina, la Release pública contiene el instalador y su firma; Aetherio Web detecta la nueva versión y las instalaciones anteriores reciben el popup.

> No publiques una etiqueta cuya versión sea distinta de la configurada en la aplicación.

## Cuentas de Aetherio

La cuenta global de Aetherio es opcional. Tanto los usuarios anteriores como los nuevos pueden continuar en modo local; sus perfiles, preferencias y progreso permanecen en el dispositivo. Quien prefiera sincronizar su identidad puede usar correo y contraseña, Google o Discord. Las cuentas y sesiones globales se guardan en Cloudflare D1.

El backend de autenticación vive en [`website/worker/auth.ts`](website/worker/auth.ts) y ofrece registro, inicio de sesión, restauración de sesión y cierre de sesión. Las contraseñas se derivan con PBKDF2 y sal aleatoria; la base sólo conserva el hash. Los tokens de sesión también se guardan como hashes y expiran después de 30 días.

Para aplicar nuevas migraciones y desplegar:

```powershell
cd website
npx wrangler d1 migrations apply aetherio-users --remote
npm run deploy
```

### Activar Google y Discord

Configura estas URL de redirección en las consolas de cada proveedor:

- Google: `https://aetherio.aetherio.workers.dev/api/auth/oauth/google/callback`
- Discord: `https://aetherio.aetherio.workers.dev/api/auth/oauth/discord/callback`

Después guarda las credenciales exclusivamente como secretos del Worker:

```powershell
cd website
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
```

No añadas estos valores al repositorio. El Worker realiza el intercambio OAuth y devuelve a la aplicación un código de un solo uso mediante `aetherio://auth/callback`.
