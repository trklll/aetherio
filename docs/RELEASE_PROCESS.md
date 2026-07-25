# Proceso de release — Aetherio (Tauri 2 + GitHub updater)

Guía paso a paso para compilar un `.exe` firmado, generar `latest.json` sin BOM y publicar el release en GitHub de modo que el updater interno de la app lo detecte y lo verifique.

> **Reglas críticas**
> - `latest.json` debe escribirse **sin UTF-8 BOM**. Un BOM rompe el parser del updater en Tauri 2 (error "decoding response body").
> - La clave de firma **privada** NUNCA se incluye en el repo ni en el `latest.json`. Solo sale la firma pública (ya embebida en `tauri.conf.json`).
> - No publiques un release hasta que el usuario lo confirme explícitamente.

---

## Requisitos previos (una sola vez por máquina)

1. **Node + npm** instalados.
2. **Rust toolchain** (`cargo`, `rustc`).
3. **Tauri CLI** accesible vía `npm run tauri` (ya en `package.json`).
4. **GitHub CLI** (`gh`) autenticado con permisos `repo` en `trklll/aetherio`.
5. **Clave de firma privada** en:
   ```
   C:\Users\Administrator\.aetherio\tauri-signing-private.key
   ```
   - Password: un único espacio `" "` (sin las comillas).
   - Si no exists, regenera con `tauri signer generate` y vuelca la **pública** en `tauri.conf.json` > `plugins.updater.pubkey`. La privada queda solo en disco local.

6. El endpoint del updater ya configurado en `src-tauri/tauri.conf.json`:
   ```
   "endpoints": ["https://github.com/trklll/aetherio/releases/latest/download/latest.json"]
   ```
   - Esa URL sirve el `latest.json` del release marcado como **latest** (el último tag de versión creado).

---

## Pasos del release

### 1. Subir versión en los 3 archivos

La versión debe coincidir en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`. Por ejemplo para `0.3.22`:

- `package.json` → `"version": "0.3.22"`
- `src-tauri/tauri.conf.json` → `"version": "0.3.22"`
- `src-tauri/Cargo.toml` → `version = "0.3.22"`

**NO uses** `Set-Content -NoNewline` para reemplazar (colapsa los saltos de línea del TOML/JSON y rompe el parseo). Usa el tool de edición de archivos o `Set-Content` **sin** `-NoNewline` (preserva `\r\n`).

### 2. Verificar typecheck

```powershell
npx tsc --noEmit --pretty
```
Debe salir sin output. Si hay errores, arréglalos antes de seguir.

### 3. Compilar con firma

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY          = Get-Content -Raw "C:\Users\Administrator\.aetherio\tauri-signing-private.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = " "
npm run tauri build
```

Salida esperada (carpetas):
- `src-tauri\target\release\aetherio.exe` (binario, no se sube)
- `src-tauri\target\release\bundle\nsis\aetherio_0.3.22_x64-setup.exe` ← instalador
- `src-tauri\target\release\bundle\nsis\aetherio_0.3.22_x64-setup.exe.sig` ← firma base64
- `src-tauri\target\release\bundle\msi\aetherio_0.3.22_x64_en-US.msi` (opcional)
- `src-tauri\target\release\bundle\msi\aetherio_0.3.22_x64_en-US.msi.sig`

> Si solo haces cambios TS/JSX, no recompila Rust (tarda 3 min). Pero si hay cambios Rust o version bump de `Cargo.toml`, hay que recompilar.

### 4. Commit + push

```powershell
git add -A
git commit -m "v0.3.22: <resumen breve de cambios>"
git push origin main
git tag v0.3.22
git push origin v0.3.22
```

### 5. Crear release en GitHub

```powershell
gh release create v0.3.22 `
  --title "v0.3.22" `
  --notes "v0.3.22: <descripción>"
```
> Sin `--verify-tag` si ya creaste el tag localmente y lo subiste (acelerado). Con `--verify-tag` solo funcionaría si el tag ya llega a GitHub.

### 6. Subir binarios (`.exe` + `.sig`)

```powershell
gh release upload v0.3.22 `
  "src-tauri\target\release\bundle\nsis\aetherio_0.3.22_x64-setup.exe" `
  "src-tauri\target\release\bundle\nsis\aetherio_0.3.22_x64-setup.exe.sig" `
  "src-tauri\target\release\bundle\msi\aetherio_0.3.22_x64_en-US.msi" `
  "src-tauri\target\release\bundle\msi\aetherio_0.3.22_x64_en-US.msi.sig"
```

### 7. Generar `latest.json` SIN BOM

El archivo `.sig` ya es base64 de una sola línea. Toma su contenido y arma el JSON así:

```powershell
$sig      = (Get-Content -Raw "src-tauri\target\release\bundle\nsis\aetherio_0.3.22_x64-setup.exe.sig").Trim()
$pubDate  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$url      = "https://github.com/trklll/aetherio/releases/download/v0.3.22/aetherio_0.3.22_x64-setup.exe"

$latestJson = @{
  version  = "0.3.22"
  notes    = "v0.3.22: <descripción>"
  pub_date = $pubDate
  platforms = @{
    "windows-x86_64" = @{
      signature = $sig
      url       = $url
    }
  }
} | ConvertTo-Json -Depth 10 -Compress

# ESCRIBIR SIN BOM — vital
[System.IO.File]::WriteAllText(
  "src-tauri\target\release\bundle\nsis\latest.json",
  $latestJson,
  (New-Object System.Text.UTF8Encoding $false)   # <-- $false = no BOM
)
```

### 8. Verificar que no tiene BOM

```powershell
$bytes = [System.IO.File]::ReadAllBytes("src-tauri\target\release\bundle\nsis\latest.json")
if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
  Write-Output "BOM FOUND (BAD)"
} else {
  Write-Output "No BOM (GOOD)"
}
Get-Content -Raw "src-tauri\target\release\bundle\nsis\latest.json"
```

### 9. Subir `latest.json` al release

```powershell
gh release upload v0.3.22 "src-tauri\target\release\bundle\nsis\latest.json" --clobber
```

### 10. Verificar endpoint público

```powershell
(Invoke-WebRequest -Uri "https://github.com/trklll/aetherio/releases/latest/download/latest.json" -Method Head -UseBasicParsing).StatusCode
# 200 = OK
```

El release queda como "latest" automáticamente (el tag más nuevo). El updater de cualquier instalación de Aetherio existente tirará de esa URL, descargará el `.exe`, verificará la firma con la **pubkey** embebida en `tauri.conf.json`, y ofrecerá la actualización.

---

## Estructura del `latest.json`

```json
{
  "version": "0.3.22",
  "notes": "v0.3.22: ...",
  "pub_date": "2026-07-25T10:30:00.000Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contenido crudo del .sig, base64 de una línea>",
      "url": "https://github.com/trklll/aetherio/releases/download/v0.3.22/aetherio_0.3.22_x64-setup.exe"
    }
  }
}
```

> El campo `signature` recibe **el contenido completo del archivo `.sig`** (es ya base64). No hay que decodificarlo ni transformarlo.

---

## Seguridad: por qué esto es seguro (confirmar al usuario si pregunta)

1. La **clave privada** nunca se incluye en ningún artefacto público. Solo la pública va embebida en `tauri.conf.json`.
2. La firma del `.exe` es criptográfica (minisign). El updater la valida antes de instalar — aunque alguien manipulara el `latest.json` o intercambiara el `.exe` por uno malicioso, la firma no coincidiriría y Tauri rechazaría la actualización silenciosamente.
3. Las GitHub releases son HTTPS e inmutables por tag.
4. El `latest.json` en el repo público es el estándar oficial de Tauri para auto-update — no expone nada sensible.

---

## Atajos / troubleshooting

- **`Set-Content -NoNewline` rompió `Cargo.toml`/`tauri.conf.json`** (todo en una línea, falla `cargo`/`tauri build`):
  ```powershell
  git checkout -- src-tauri\Cargo.toml src-tauri\tauri.conf.json
  ```
  y re-aplica el cambio de versión con un editor real (Edit tool, no `Set-Content -NoNewline`).

- **`A public key has been found, but no private key`** → faltan las env vars `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Exportalas antes de `npm run tauri build`.

- **El updater no detecta la nueva versión** → revisa que:
  - La versión en `latest.json` sea mayor que la instalada (comparación semver, no string).
  - El tag del release sea el último (GitHub marca "latest" automáticamente por tag más reciente).
  - La URL del `.exe` en `latest.json` apunte al asset correcto (descarga directa, no API).
  - No haya BOM (ver paso 8).

- **`latest.json` con caracteres `Ã` en lugar de `ó`/`ñ`** → se generó con encoding incorrecto. Vuelve a generarlo con `[System.IO.File]::WriteAllText` y `UTF8Encoding($false)`.

---

## Plantilla de commit
```
v0.3.<N>: <resumen corto separado por comas>
```
Ejemplos reales del repo:
- `v0.3.13: installer async launch, window controls, catalog fixes, volume boost 200%, contextmenu block, trailer fallback`
- `v0.3.21: anime characters (Jikan) en Detail, card->detail FLIP overlay, scroll restoration, hover animations, window controls auto-hide, rounded arrows, marcar como visto, streaming logo enrichment`

## Plantilla de notas del release
Texto libre, típicamente igual que el mensaje de commit. Evita emojis a menos que el usuario los pida.
