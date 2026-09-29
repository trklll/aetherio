<#
.SYNOPSIS
  Instala, configura y arranca SpatialPosters para Aetherio.

.DESCRIPTION
  Deja SpatialPosters funcionando como proceso hermano, accesible por HTTP, sin que
  nadie tenga que crear ni guardar una clave de TMDB: la instancia usa el proxy
  server-side que Aetherio ya tiene (que inyecta la clave del lado seguro y descarta
  la que envíe el cliente).

  Config que escribe en .env.local:
    TMDB_BASE_URL = <proxy de Aetherio>   ->SpatialPosters no necesita clave propia
    TMDB_API_KEY  = via-proxy-no-se-usa    -> valor ficticio; solo evita que el
                                               catálogo de ranking salga antes de tiempo
  Ese segundo valor NO es una credencial: el proxy borra cualquier api_key antes de
  hablar con TMDB. Está ahí porque la ruta de catálogo de SpatialPosters hace
  "if (!apiKey) return { metas: [] }" y aborta sin él.

.PARAMETER Command
  setup   Instala (clona si falta, npm install, .env.local, build)
  start   Arranca en producción (o -Dev para desarrollo)
  stop    Detiene
  status  Estado + health check

.EXAMPLE
  .\scripts\spatialposters.ps1 setup
  .\scripts\spatialposters.ps1 start
  .\scripts\spatialposters.ps1 status
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('setup', 'start', 'stop', 'status')]
  [string] $Command = 'status',

  [string] $Path = '',
  [string] $Repo = 'https://github.com/TheAceOfficials/SpatialPosters.git',
  [string] $Proxy = 'https://trkll.aetherio.workers.dev/api/tmdb',
  [int]    $Port = 3000,
  [string] $KvUrl = $env:SPATIALPOSTERS_KV_URL,
  [string] $KvToken = $env:SPATIALPOSTERS_KV_TOKEN,
  [switch] $Dev,
  [switch] $Force
)

$ErrorActionPreference = 'Stop'
$MIN_NODE_MAJOR = 22

# $PSScriptRoot no llega poblado al bloque param cuando se invoca con -File en
# Windows PowerShell 5.1, asi que la ruta por defecto se resuelve aqui.
if (-not $Path) {
  $scriptDir = $PSScriptRoot
  if (-not $scriptDir) { $scriptDir = Split-Path $MyInvocation.MyCommand.Path -Parent }
  # scripts/ -> aetherio/ -> Projects/ : SpatialPosters queda como repo hermano,
  # no anidado (anidar un .git dentro de otro repo da problemas).
  $repoRoot = Split-Path $scriptDir -Parent
  $parent = Split-Path $repoRoot -Parent
  $Path = Join-Path $parent 'SpatialPosters'
}

function Write-Step($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "    !   $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "    X   $msg" -ForegroundColor Red }

function Get-NodeMajor {
  try {
    $raw = (& node --version 2>$null)
    if (-not $raw) { return 0 }
    return [int](($raw.Trim() -replace '^v', '').Split('.')[0])
  } catch { return 0 }
}

function Assert-Node {
  $major = Get-NodeMajor
  if ($major -lt $MIN_NODE_MAJOR) {
    Write-Fail "Node $MIN_NODE_MAJOR+ necesario (instalado: $(& node --version 2>$null))"
    Write-Fail "SpatialPosters usa sharp/resvg, que no funcionan en versiones anteriores."
    exit 1
  }
  Write-Ok "Node $(& node --version)"
}

function Get-SpatialPid {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conn) { return $conn[0].OwningProcess }
  return $null
}

# OJO: /api/health NO sirve como liveness probe. Solo lee la clave del header
# `x-api-key` (a proposito, para no dejarla en la query que queda en los logs) y
# nunca del entorno, asi que sin ese header marca todo como 401 y responde 503
# aunque el server este perfecto. Por eso "contesta algo HTTP" = arrancado.
function Test-SpatialUp {
  try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 5
    return $true
  } catch {
    # 503 tambien significa "el server respondio".
    if ($_.Exception.Response) { return $true }
    return $false
  }
}

# Verificacion funcional de verdad: un poster renderizado.
function Test-SpatialPoster {
  $url = "http://127.0.0.1:$Port/api/poster/movie/155?region=MX&lang=es&bs=shadow&rs=default&gradHeight=30&blur=5&bf=60&bd=40"
  try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 120
    $sw.Stop()
    if ($r.StatusCode -eq 200) {
      return @{ ok = $true; ms = $sw.ElapsedMilliseconds; bytes = $r.RawContentLength }
    }
    return @{ ok = $false; ms = $sw.ElapsedMilliseconds; bytes = 0; status = $r.StatusCode }
  } catch {
    return @{ ok = $false; ms = 0; bytes = 0; error = $_.Exception.Message }
  }
}

function Stop-Spatial {
  $pid_ = Get-SpatialPid
  if ($pid_) {
    Write-Step "Deteniendo SpatialPosters (PID $pid_)"
    Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Ok 'Detenido'
  } else {
    Write-Ok "Nada escuchando en el puerto $Port"
  }
}

function Write-EnvLocal {
  $envPath = Join-Path $Path '.env.local'
  $lines = @(
    '# Generado por scripts/spatialposters.ps1'
    '# No pongas claves de TMDB aqui: la instancia usa el proxy de Aetherio,'
    '# que ya inyecta la credencial del lado seguro.'
    "TMDB_BASE_URL=$Proxy"
    'TMDB_API_KEY=via-proxy-no-se-usa'
    'LOG_LEVEL=info'
  )
  if ($KvUrl -and $KvToken) {
    $lines += ''
    $lines += '# Cache persistente: sin esto cada arranque vuelve a renderizar todo.'
    $lines += "KV_REST_API_URL=$KvUrl"
    $lines += "KV_REST_API_TOKEN=$KvToken"
  }
  $content = ($lines -join "`n") + "`n"
  [System.IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok '.env.local escrito (sin claves reales)'
}

function Install-Spatial {
  Assert-Node

  if ($Force -and (Test-Path $Path)) {
    Write-Step "Borrando instalacion previa ($Path)"
    Remove-Item -Recurse -Force $Path
  }

  if (Test-Path (Join-Path $Path '.git')) {
    Write-Ok "Ya esta clonado en $Path"
  } else {
    if (Test-Path $Path) {
      Write-Fail "$Path existe pero no es un repo git. Borralo o usa -Force."
      exit 1
    }
    Write-Step "Clonando desde $Repo"
    & git clone --depth 1 $Repo $Path
    if ($LASTEXITCODE -ne 0) { Write-Fail 'git clone fallo'; exit 1 }
    Write-Ok 'Clonado'
  }

  Write-Step 'Instalando dependencias'
  Push-Location $Path
  try {
    & npm install --no-audit --no-fund | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail 'npm install fallo'; exit 1 }
    Write-Ok 'Dependencias instaladas'
  } finally { Pop-Location }

  Write-EnvLocal

  if (-not $KvUrl -or -not $KvToken) {
    Write-Warn 'Sin cache persistente (KV). Cada arranque re-renderiza: ~2s por poster.'
    Write-Warn 'Opcional: $env:SPATIALPOSTERS_KV_URL / $env:SPATIALPOSTERS_KV_TOKEN (Upstash, plan gratis).'
  }
}

function Read-EnvLocal {
  $map = @{}
  $envPath = Join-Path $Path '.env.local'
  if (-not (Test-Path $envPath)) { return $map }
  foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $k, $v = $line -split '=', 2
    $map[$k.Trim()] = $v.Trim()
  }
  return $map
}

function Get-StandaloneDir {
  $p = Join-Path $Path '.next\standalone'
  if (-not (Test-Path $p)) { return $null }
  return $p
}

# Next genera `output: standalone` (lo usa su Dockerfile). Eso significa que
# `next start` no funciona: hay que ensamblar el runtime como hace el Dockerfile
# (standalone como raiz, + .next/static y public dentro) y arrancar server.js.
function Ensure-StandaloneRuntime {
  $sa = Get-StandaloneDir
  if (-not $sa) { return $null }
  if (-not (Test-Path (Join-Path $sa 'server.js'))) { return $null }

  $staticSrc = Join-Path $Path '.next\static'
  $staticDst = Join-Path $sa '.next\static'
  if ((Test-Path $staticSrc) -and -not (Test-Path $staticDst)) {
    New-Item -ItemType Directory -Path (Split-Path $staticDst -Parent) -Force | Out-Null
    Copy-Item -Recurse -Force $staticSrc $staticDst
  }

  $publicSrc = Join-Path $Path 'public'
  $publicDst = Join-Path $sa 'public'
  if ((Test-Path $publicSrc) -and -not (Test-Path $publicDst)) {
    Copy-Item -Recurse -Force $publicSrc $publicDst
  }
  return $sa
}

function Start-Spatial {
  Assert-Node
  if (-not (Test-Path (Join-Path $Path '.env.local'))) {
    Write-Fail 'No esta configurado. Ejecuta primero: setup'
    exit 1
  }

  $running = Get-SpatialPid
  if ($running) {
    Write-Warn "Ya hay algo en el puerto $Port (PID $running). Usa stop primero."
    exit 0
  }

  if (-not $Dev) {
    $sa = Get-StandaloneDir
    if (-not $sa -or -not (Test-Path (Join-Path $sa 'server.js'))) {
      Write-Step 'Compilando para produccion (standalone, la primera vez tarda)'
      Push-Location $Path
      try {
        & npm run build 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail 'npm run build fallo'; exit 1 }
      } finally { Pop-Location }
      Write-Ok 'Compilado'
    }
    $sa = Ensure-StandaloneRuntime
    if (-not $sa) {
      Write-Fail 'No se encontro .next/standalone/server.js tras compilar.'
      exit 1
    }
    $cmd = 'node server.js'
    $workDir = $sa
  } else {
    $cmd = 'npm run dev'
    $workDir = $Path
  }

  # Variables de .env.local al proceso hijo.
  foreach ($k in (Read-EnvLocal).Keys) {
    Set-Item -Path "env:$k" -Value (Read-EnvLocal)[$k]
  }
  $env:PORT = "$Port"
  $env:HOSTNAME = '127.0.0.1'
  $env:NODE_ENV = 'production'
  $env:NODE_MAX_OLD_SPACE = '2048'
  $env:SHARP_CONCURRENCY = '2'
  # Self-warmup: la cache de posteres es in-memory, asi que sin esto cada arranque
  # arranca frio. El propio entrypoint.sh del upstream lo lanza en background.
  $env:PICTORIUM_SELF_WARMUP = '0'
  $dataDir = Join-Path $Path 'data'
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
  $env:PICTORIUM_DATA_DIR = $dataDir
  $env:POSTERIUM_DATA_DIR = $dataDir

  $logDir = Join-Path $env:TEMP 'aetherio-spatialposters'
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $log = Join-Path $logDir 'server.log'
  Write-Step "Arrancando ($cmd) -> log en $log"
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "$cmd > `"$log`" 2>&1" `
    -WorkingDirectory $workDir -WindowStyle Hidden | Out-Null

  Write-Step 'Esperando a que responda'
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    if (Test-SpatialUp) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }

  if (-not $ready) {
    Write-Fail 'No respondio a tiempo. Ultimas lineas del log:'
    if (Test-Path $log) { Get-Content $log -Tail 20 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray } }
    exit 1
  }

  Write-Ok "SpatialPosters escuchando en http://localhost:$Port"

  # Calentado de los posteres mas vistos, en background y sin bloquear.
  $null = Start-Job -ScriptBlock {
    param($p)
    try { Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/warmup" -UseBasicParsing -TimeoutSec 300 | Out-Null } catch {}
  } -ArgumentList $Port
  Write-Ok 'Calentando posteres en segundo plano (/api/warmup)'

  Write-Host ''
  Write-Host '    En Aetherio: Ajustes -> SPATIALPOSTERS -> URL de la instancia' -ForegroundColor White
  Write-Host "    http://localhost:$Port" -ForegroundColor White
  exit 0
}

function Show-Status {
  $pid_ = Get-SpatialPid
  Write-Host ''
  Write-Host '  SpatialPosters' -ForegroundColor White
  Write-Host "  Ruta:      $Path" -ForegroundColor DarkGray
  Write-Host "  Puerto:    $Port" -ForegroundColor DarkGray
  if ($pid_) {
    Write-Host "  Proceso:   corriendo (PID $pid_)" -ForegroundColor Green
  } else {
    Write-Host '  Proceso:   detenido' -ForegroundColor Yellow
  }
  $envPath = Join-Path $Path '.env.local'
  if (Test-Path $envPath) {
    $raw = [System.IO.File]::ReadAllText($envPath)
    $hasProxy = $raw -match 'TMDB_BASE_URL='
    $hasKv = $raw -match 'KV_REST_API_URL='
    $hasRealKey = $raw -match 'TMDB_API_KEY=(?!via-proxy)\S+'
    Write-Host "  .env.local: $(if ($hasProxy) { 'proxy configurado' } else { 'SIN PROXY' })" -ForegroundColor $(if ($hasProxy) { 'Green' } else { 'Red' })
    Write-Host "  Cache KV:   $(if ($hasKv) { 'si (persistente)' } else { 'no (se re-renderiza cada arranque)' })" -ForegroundColor $(if ($hasKv) { 'Green' } else { 'Yellow' })
    if ($hasRealKey) {
      Write-Host '  AVISO: hay una clave de TMDB real en .env.local. No hace falta y es un riesgo.' -ForegroundColor Red
    }
  } else {
    Write-Host '  .env.local: no existe (corre setup)' -ForegroundColor Yellow
  }

  if ($pid_) {
    $t = Test-SpatialPoster
    if ($t.ok) {
      Write-Host "  Prueba:    poster OK ($($t.bytes) bytes, $($t.ms) ms)" -ForegroundColor Green
    } else {
      $why = if ($t.error) { $t.error } else { "status $($t.status)" }
      Write-Host "  Prueba:    fallo -> $why" -ForegroundColor Red
    }
  }
  Write-Host ''
}

switch ($Command) {
  'setup'  { Install-Spatial }
  'start'  { Start-Spatial }
  'stop'   { Stop-Spatial }
  'status' { Show-Status }
}
