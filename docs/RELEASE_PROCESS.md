# Proceso de release de Aetherio

Esta es la fuente de verdad para publicar una versión estable de Aetherio para
Windows. Está escrita para personas y agentes que trabajen en este repositorio.

El updater actual es interno:

- La aplicación consulta el endpoint de Cloudflare configurado en
  `src-tauri/tauri.conf.json`.
- Cloudflare D1 conserva la versión, URL, tamaño, SHA-256 y firmas.
- GitHub Releases almacena gratuitamente el instalador y sus firmas.
- No se genera ni se publica `latest.json`.
- La publicación completa la realiza `.github/workflows/release.yml`.
- La web obtiene la versión publicada desde D1 y descarga mediante
  `/download/windows`; un release normal no requiere desplegar nuevamente la
  web.

## Reglas obligatorias

1. Publicar solamente desde `main`.
2. No crear el tag hasta que las validaciones locales terminen correctamente.
3. No publicar con cambios sin revisar o archivos locales accidentales.
4. Usar exactamente la misma versión SemVer en:
   - `package.json`
   - `package-lock.json`
   - `src-tauri/Cargo.toml`
   - el paquete `aetherio` de `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json`
5. El tag siempre es `v<versión>` y debe apuntar al commit que contiene esa
   misma versión.
6. Nunca leer, imprimir, copiar, regenerar ni subir claves privadas.
7. Nunca reemplazar una clave del updater: rompería la actualización de
   instalaciones existentes.
8. No usar `scripts/publish-release.ps1` para producción. Es un flujo heredado
   de la época de `latest.json`.

## Secretos requeridos en GitHub Actions

Solo hay que comprobar que estos nombres existan en la configuración del
repositorio. Sus valores no deben mostrarse:

- `TAURI_SIGNING_PRIVATE_KEY`: firma usada por las instalaciones actuales.
- `TAURI_SIGNING_PRIVATE_KEY_LEGACY`: firma compatible con instalaciones
  anteriores.
- `AETHERIO_RELEASE_TOKEN`: autoriza el registro del release en el Worker.

Comprobación segura:

```powershell
gh secret list --repo trklll/aetherio
```

## Secretos requeridos en Cloudflare

El Worker conserva, entre otros, los secretos OAuth, el token de publicación y
`PASSWORD_PEPPER`. Este último protege las pruebas de contraseña almacenadas en
D1 y no puede regenerarse: hacerlo impediría iniciar sesión a las cuentas
convencionales existentes.

Comprobar únicamente los nombres, nunca sus valores:

```powershell
Set-Location website
npx wrangler secret list
```

La lista debe incluir:

- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`;
- `ANILIST_CLIENT_ID` y `ANILIST_CLIENT_SECRET`;
- `OAUTH_TOKEN_ENCRYPTION_KEY`;
- `PASSWORD_PEPPER`;
- `RELEASE_PUBLISH_TOKEN`.

## Flujo normal

### 1. Sincronizar el repositorio

```powershell
git switch main
git fetch origin --prune
git status --short --branch
```

Si `main` remoto contiene commits que no están localmente, integrar esos
cambios antes de continuar. No usar `reset --hard` ni descartar trabajo ajeno.

### 2. Revisar lo que entrará al release

```powershell
git status --short
git diff --stat
git log --oneline origin/main..HEAD
```

Excluir capturas, archivos temporales, builds, cachés, claves, `.env`, skills
locales y cualquier otro archivo que no forme parte de Aetherio.

### 3. Elegir y aplicar la versión

Para una versión como `0.4.5`, actualizar los cinco lugares indicados en las
reglas. Después confirmar:

```powershell
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); if(p.version!==l.version||p.version!==l.packages[''].version) process.exit(1); console.log(p.version)"
cargo metadata --manifest-path src-tauri/Cargo.toml --no-deps --format-version 1
```

No modificar números de versión de dependencias que casualmente coincidan en
`Cargo.lock`; solo la entrada del paquete `aetherio`.

### 4. Validar el proyecto

Ejecutar en este orden:

```powershell
npm run providers:build
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

Además, verificar que el runtime de MPV usado por CI siga disponible:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-mpv.ps1 -VerifyOnly
```

Si el script no admite `-VerifyOnly`, revisar el pin y sus URLs sin modificar
el runtime instalado. No iniciar un release con una URL de MPV rota.

### 5. Crear el commit de release

Agregar únicamente los archivos revisados:

```powershell
git add <archivos-revisados>
git status --short
git diff --cached --stat
git diff --cached --check
git commit -m "release: prepare Aetherio 0.4.5"
```

El commit debe incluir la guía actualizada, el cambio de versión y todos los
cambios funcionales destinados al release.

### 6. Subir `main`

```powershell
git push origin main
```

Confirmar que el push terminó antes de crear el tag.

### 7. Crear y subir el tag

```powershell
git tag -a v0.4.5 -m "Aetherio v0.4.5"
git push origin v0.4.5
```

El tag dispara automáticamente `.github/workflows/release.yml`.

### 8. Supervisar GitHub Actions

```powershell
gh run list --repo trklll/aetherio --workflow release.yml --limit 5
gh run watch <run-id> --repo trklll/aetherio --exit-status
```

El workflow debe completar estas etapas:

1. Instalar dependencias y el runtime MPV.
2. Verificar la línea de la clave actual.
3. Compilar el instalador NSIS/MSI y publicar GitHub Release.
4. Generar la firma actual y la firma heredada.
5. Subir la firma heredada como asset.
6. Registrar versión, URL, tamaño, SHA-256 y ambas firmas en Cloudflare.
7. Comprobar que la web anuncia la nueva versión y que
   `/download/windows` redirige al instalador `.exe` de ese release.

Si falla, no mover ni recrear el tag. Corregir el problema en un nuevo commit y
volver a ejecutar el workflow sobre el mismo tag solamente si el commit del tag
no necesita cambiar. Si cambia el código del release, eliminar y recrear el tag
requiere confirmar primero que no hubo una publicación utilizable.

### 9. Verificar el release publicado

```powershell
gh release view v0.4.5 --repo trklll/aetherio
gh release view v0.4.5 --repo trklll/aetherio --json assets,url,isDraft,isPrerelease
```

Debe existir al menos:

- instalador `*_x64-setup.exe`;
- firma actual `*.exe.sig`;
- firma heredada `*.legacy.sig`;
- MSI y su firma, si el bundle lo produjo.

No debe existir `latest.json`.

### 10. Verificar el updater interno

Consultar como una instalación anterior:

```powershell
$response = Invoke-WebRequest `
  -Uri "https://aetherio.aetherio.workers.dev/api/update/windows/x86_64/0.4.4" `
  -UseBasicParsing
$response.StatusCode
$response.Content
```

La respuesta debe anunciar `0.4.5`, contener una URL HTTPS al instalador y una
firma no vacía. La URL del instalador debe responder correctamente:

```powershell
$payload = $response.Content | ConvertFrom-Json
(Invoke-WebRequest -Uri $payload.url -Method Head -UseBasicParsing).StatusCode
```

Finalmente, probar desde una instalación anterior:

1. abrir Aetherio;
2. esperar la detección de la actualización;
3. descargar;
4. instalar;
5. reiniciar;
6. confirmar que la versión instalada es la nueva.

## Web y descarga directa

Los dos botones de descarga de la web deben usar siempre esta ruta estable:

```text
https://aetherio.aetherio.workers.dev/download/windows
```

El Worker consulta D1 y responde con una redirección al asset
`Aetherio_<versión>_x64-setup.exe`. No enlazar los botones a
`/releases/latest`: esa URL abre la página de GitHub en lugar de iniciar la
descarga.

La automatización está integrada en `.github/workflows/release.yml`. Cada
release registra la versión en D1 y, en el mismo job, comprueba que la web
anuncie esa versión y que la descarga apunte al `.exe` correcto. No hay que
editar ni volver a desplegar la web solo para cambiar el número de versión.

Si cambia el código o el diseño de `website/`, desplegar ese cambio desde una
sesión autorizada de Wrangler:

```powershell
Set-Location website
npm ci
npm run deploy
```

Verificación de la web:

```powershell
$release = Invoke-RestMethod `
  -Uri "https://aetherio.aetherio.workers.dev/api/release"
$release.version
$release.downloadUrl

curl.exe -sS -D - -o NUL --max-redirs 0 `
  "https://aetherio.aetherio.workers.dev/download/windows"
```

`downloadUrl` debe ser `/download/windows`; la segunda respuesta debe ser
`302` y su cabecera `Location` debe terminar en `_x64-setup.exe`.

## Reintentos y fallos

### La firma fue creada con otra clave

No regenerar claves. Confirmar que el workflow tenga ambos secretos de firma y
que la etapa `Verify updater key lineage` termine correctamente. El Worker
elige la firma compatible según la versión instalada.

### El Worker rechaza el release

Revisar la etapa `Publish release to Aetherio updater`. Las causas habituales
son:

- `AETHERIO_RELEASE_TOKEN` ausente o incorrecto;
- firma vacía o inválida;
- SHA-256 o tamaño incorrectos;
- versión no SemVer;
- URL que no usa HTTPS.

### GitHub Release existe, pero la app no detecta la actualización

Comprobar:

- que el workflow terminó también la etapa de Cloudflare;
- que la versión solicitada al endpoint sea menor;
- que el endpoint configurado en `tauri.conf.json` sea el interno;
- que la respuesta corresponda a la arquitectura solicitada;
- que el release en D1 esté marcado como publicado.

### El build falla instalando MPV

Verificar el pin de `scripts/install-mpv.ps1` y que todos sus assets respondan
HTTP 200. No cambiar el pin a una versión inventada.

## Checklist final

- [ ] `main` revisado y sincronizado.
- [ ] Versión idéntica en los cinco lugares.
- [ ] `npm run providers:build`.
- [ ] `npm run build`.
- [ ] `cargo check`.
- [ ] `git diff --check`.
- [ ] Commit de release subido a `main`.
- [ ] Tag anotado `v<versión>` sobre el commit correcto.
- [ ] GitHub Actions completado.
- [ ] Assets y ambas firmas presentes.
- [ ] Registro interno de Cloudflare completado.
- [ ] Web anunciando la versión nueva.
- [ ] `/download/windows` redirigiendo al instalador `.exe`.
- [ ] Endpoint probado desde una versión anterior.
- [ ] Actualización real probada desde la aplicación.
