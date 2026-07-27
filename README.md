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

## Actualizaciones mediante Aetherio Web y GitHub Releases

La aplicación consulta el endpoint dinámico de Aetherio Web alojado en Cloudflare. El servicio revisa la última Release pública de GitHub y responde directamente con los datos que necesita el updater, sin generar ni publicar un archivo `latest.json`. Cuando encuentra una versión semántica superior, la aplicación muestra el popup de actualización, descarga el instalador firmado, valida su firma, lo instala y reinicia Aetherio.

El sitio público está disponible en [aetherio.aetherio.workers.dev](https://aetherio.aetherio.workers.dev). Su código vive en [`website/`](website/) y el mismo Worker sirve la web, la descarga del instalador y el endpoint del updater.

El workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) compila y publica el instalador y su firma de Windows. GitHub debe tener configurado el secret `TAURI_SIGNING_PRIVATE_KEY` con el contenido completo de la clave privada de Tauri.

La clave privada:

- nunca debe añadirse al repositorio;
- debe conservarse en una copia de seguridad segura;
- no puede reemplazarse sin romper las actualizaciones de instalaciones existentes.

La clave pública sí vive en `src-tauri/tauri.conf.json` y únicamente sirve para verificar firmas.

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
