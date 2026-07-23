[CmdletBinding()]
param(
  [Parameter(HelpMessage="Version a publicar (ej: 0.2.99). Si se omite, usa la de package.json.")]
  [string]$Version,

  [Parameter(HelpMessage="Tipo de instalador a construir. Valores: nsis, msi, all.")]
  [ValidateSet("nsis", "msi", "all")]
  [string]$Target = "nsis",

  [Parameter(HelpMessage="Mensaje del commit de release.")]
  [string]$CommitMessage = "",

  [switch]$SkipBuild,
  [switch]$SkipCommit,
  [switch]$SkipPush,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path | Split-Path
Set-Location $root

function Write-Section($msg) { Write-Host "`n=== $msg ===`n" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "OK: $msg" -ForegroundColor Green }
function Write-Bad($msg) { Write-Host "ERR: $msg" -ForegroundColor Red; exit 1 }

function Get-Version-From-Files {
  $pkg = node -p "require('./package.json').version"
  if (-not $pkg) { Write-Bad "No se pudo leer la version de package.json" }
  return $pkg
}

function Update-Version-In-Files($ver) {
  $pkgPath = "package.json"
  $tauriPath = "src-tauri/tauri.conf.json"
  $cargoPath = "src-tauri/Cargo.toml"

  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  if ($pkg.version -ne $ver) {
    $pkg.version = $ver
    ($pkg | ConvertTo-Json -Depth 50) | Set-Content $pkgPath -NoNewline
    Write-Ok "package.json -> $ver"
  }

  $tauri = Get-Content $tauriPath -Raw
  if ($tauri -notmatch """version"":\s*""$ver""") {
    $tauri = $tauri -replace """version"":\s*""[^""]*""", """version"": ""$ver"""
    Set-Content $tauriPath -Value $tauri -NoNewline
    Write-Ok "tauri.conf.json -> $ver"
  }

  $cargo = Get-Content $cargoPath -Raw
  if ($cargo -notmatch "(?ms)^version = ""$ver""") {
    $cargo = $cargo -replace '(?ms)^version = "[^"]*"', "version = `"$ver`""
    Set-Content $cargoPath -Value $cargo -NoNewline
    Write-Ok "Cargo.toml -> $ver"
  }
}

Write-Section "Aetherio Release Publisher"

if (-not $Version) {
  $Version = Get-Version-From-Files
  Write-Host "Version detectada: $Version"
} else {
  Write-Host "Version forzada: $Version"
}

$tag = "v$Version"
Write-Host "Tag del release: $tag"

if ($DryRun) {
  Write-Host "[DryRun] Se haria:" -ForegroundColor Yellow
  Write-Host "  - Actualizar version a $Version en package.json, tauri.conf.json, Cargo.toml"
  Write-Host "  - Commit (si hay cambios) con mensaje: $($CommitMessage)"
  Write-Host "  - Push a origin/main"
  Write-Host "  - Build con target=$Target"
  Write-Host "  - Crear release $tag con .exe (y .sig/latest.json si existen)"
  exit 0
}

$repo = git remote get-url origin 2>$null
if ($repo) { Write-Host "Repo remoto: $repo" }

Write-Section "Actualizando version en archivos"
if ($SkipBuild -and $SkipCommit) {
  Write-Host "Omitido (-SkipBuild -SkipCommit)"
} else {
  Update-Version-In-Files $Version
}

Write-Section "Commit y push"
if ($SkipCommit) {
  Write-Host "Omitido (-SkipCommit)"
} else {
  git add -A
  $status = git status --porcelain
  if ($status) {
    $msg = if ($CommitMessage) { $CommitMessage } else { "release: $tag" }
    git commit -m $msg
    Write-Ok "Commit creado"
  } else {
    Write-Host "Sin cambios para commitear"
  }
  if (-not $SkipPush) {
    git push origin (git rev-parse --abbrev-ref HEAD)
    Write-Ok "Push completado"
  } else {
    Write-Host "Push omitido (-SkipPush)"
  }
}

Write-Section "Build ($Target)"
$exeName = "aetherio_$Version`_x64-setup.exe"
$exePath = "src-tauri\target\release\bundle\nsis\$exeName"

if ($SkipBuild) {
  Write-Host "Omitido (-SkipBuild)"
} else {
  $targets = switch ($Target) {
    "nsis" { "nsis"; break }
    "msi"  { "msi"; break }
    "all"  { "all"; break }
  }

  $beforeTargets = $null
  $tauriPath = "src-tauri/tauri.conf.json"
  if ($Target -ne "all") {
    $tauri = Get-Content $tauriPath -Raw
    if ($tauri -match '(?s)"targets":\s*"[^"]*"') {
      $beforeTargets = $tauri -replace '(?s)("targets":\s*)"[^"]*"', "`$1""$targets"""
    } elseif ($tauri -match '(?s)"targets":\s*\[[^\]]*\]') {
      $beforeTargets = $tauri -replace '(?s)("targets":\s*)\[[^\]]*\]', "`$1[""$targets""]"
    }
    if ($beforeTargets) {
      Set-Content $tauriPath -Value $beforeTargets -NoNewline
      Write-Ok "targets temporales -> $targets"
    }
  }

  try {
    Write-Host "Compilando Rust + empaquetando NSIS (puede tardar varios minutos)..."
    $buildOut = npm run tauri build 2>&1
    $buildDone = $false
    foreach ($line in $buildOut) {
      Write-Host $line
      if ($line -match "Finished.*bundle") { $buildDone = $true }
    }
    if (-not (Test-Path $exePath) -and $Target -eq "nsis") {
      Write-Bad "No se encontro: $exePath"
    }
    Write-Ok "Build completado"
  } finally {
    if ($Target -ne "all" -and $beforeTargets) {
      $tauri = Get-Content $tauriPath -Raw
      if ($tauri -match '(?s)"targets":\s*"[^"]*"' -or $tauri -match '(?s)"targets":\s*\[[^\]]*\]') {
        $restored = $tauri -replace '(?s)("targets":\s*)"[^"]*"', "`$1""all"""
        $restored = $restored -replace '(?s)("targets":\s*)\[[^\]]*\]', "`$1""all"""
        Set-Content $tauriPath -Value $restored -NoNewline
        Write-Ok "targets restaurados -> all"
      }
    }
  }
}

Write-Section "Crear release en GitHub"
$assets = @()
if (Test-Path $exePath) {
  $assets += $exePath
  Write-Ok "Asset encontrado: $exeName"
} else {
  Write-Bad "No se encontro el .exe en: $exePath"
}

$sigSearch = Get-ChildItem -Path "src-tauri\target\release\bundle\nsis" -Filter "*.sig" -ErrorAction SilentlyContinue
if ($sigSearch) {
  $assets += $sigSearch.FullName
  Write-Ok "Asset encontrado: $($sigSearch.Name)"
} else {
  Write-Host "No se genero .sig (falta TAURI_SIGNING_PRIVATE_KEY). Continuando sin firma."
}

$latestJson = "src-tauri\target\release\bundle\nsis\latest.json"
if (Test-Path $latestJson) {
  $assets += $latestJson
  Write-Ok "Asset encontrado: latest.json"
}

$body = @"
Aetherio $tag

Instalador para Windows ($Target). Ejecuta el .exe para instalar.

Si se incluyo el .sig y latest.json, el auto-updater de Tauri podra verificar descargar actualizaciones automaticamente.
"@

$existing = gh release view $tag 2>$null
if ($existing) {
  Write-Host "El release $tag ya existe. Subiendo assets adicionales..."
  foreach ($asset in $assets) {
    if ($asset) { gh release upload $tag $asset --clobber }
  }
  Write-Ok "Assets subidos al release existente"
} else {
  $isLatest = $true
  gh release create $tag @assets --title "Aetherio $tag" --notes $body --latest
  Write-Ok "Release $tag creado en GitHub"
}

Write-Section "Resumen"
Write-Host "Version: $Version"
Write-Host "Tag:     $tag"
Write-Host "Target:  $Target"
Write-Host "Assets:  $($assets.Count)"
foreach ($a in $assets) { Write-Host "  - $(Split-Path $a -Leaf)" }
Write-Host ""
Write-Host "URL: https://github.com/trklll/aetherio/releases/tag/$tag" -ForegroundColor Cyan
Write-Ok "Listo!"
