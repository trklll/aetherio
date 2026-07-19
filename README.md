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

## Actualizaciones mediante GitHub Releases

La aplicación consulta automáticamente el archivo `latest.json` de la última Release de GitHub. Cuando encuentra una versión semántica superior, muestra el popup de actualización, descarga el instalador firmado, valida su firma, lo instala y reinicia Aetherio.

El workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) compila y publica los artefactos de Windows. GitHub debe tener configurado el secret `TAURI_SIGNING_PRIVATE_KEY` con el contenido completo de la clave privada de Tauri.

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

La etiqueta inicia el workflow. Cuando termina, la Release pública contiene el instalador, su firma y `latest.json`; desde ese momento las instalaciones con una versión anterior reciben el popup.

> No publiques una etiqueta cuya versión sea distinta de la configurada en la aplicación.
