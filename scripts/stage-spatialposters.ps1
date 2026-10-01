#requires -Version 5.1
<#
.SYNOPSIS
  Prepara SpatialPosters + el runtime Node como recursos de Aetherio.

.DESCRIPTION
 Deja en src-tauri/resources/ lo que la app necesita para levantar el servidor de
  posters sola, sin que el usuario tenga que instalar Node ni clonar nada:

    src-tauri/resources/spatialposters/   -> server standalone de Next.js
    src-tauri/resources/bin/node.exe      -> runtime Node portable

  Sigue la misma convencion que install-mpv.ps1: los artefactos pesados NO se
  commitean, se generan. La app resuelve todo desde resource_dir().

  En un bundle de produccion estos archivos se marcan como recursos, asi que la
  carpeta resources/ se copia tal cual dentro del directorio de instalacion.
#>
[CmdletBinding()]
param(
    # Carpeta donde vive el codigo fuente de SpatialPosters.
    [string] $Source,

    # Destino dentro de src-tauri.
    [string] $Target,

    # Refresca aunque el destino ya exista.
    [switch] $Force
)

$ErrorActionPreference = "Stop"

# Ojo: $PSScriptRoot todavia no es confiable en los defaults del param con
# powershell -File, asi que las rutas se resuelven aca en el cuerpo.
$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not $Target) {
    $Target = Join-Path $RepoRoot "src-tauri\resources"
}

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    !   $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    X   $msg" -ForegroundColor Red; exit 1 }

if (-not $Source) {
    # El CI puede sobreescribir la ruta. Antes era la unica forma de compilar en
    # GitHub Actions; ahora puede faltarle y aun asi cae al vendor.
    $Source = $env:SPATIALPOSTERS_SOURCE
}
if (-not $Source) {
    # Por defecto se compila el SpatialPosters que viaja en `vendor/`, que es
    # parte de este repo y por lo tanto esta siempre en la version que se
    # publico. Antes el default era el clon hermano y el CI clonaba el repo
    # upstream pineado a un commit: los cambios hechos en local no llegaban al
    # instalador sin que nadie se enterara, que es como se perdio una release
    # entera de badges.
    $Source = Join-Path $RepoRoot "vendor\spatialposters"
}
if (-not (Test-Path -LiteralPath $Source)) {
    # Fallback: un clon hermano, por si se esta trabajando sobre SpatialPosters
    # fuera del vendor y se quiere probar sin stagear. En el CI esto no aplica,
    # porque ahi `vendor/` viene en el checkout.
    $Sibling = Join-Path $RepoRoot "..\SpatialPosters"
    if (Test-Path -LiteralPath $Sibling) {
        Write-Warn "No existe vendor/spatialposters; se usa el clon hermano $Sibling."
        $Source = $Sibling
    }
}
$Source = [System.IO.Path]::GetFullPath($Source)

$ServerDir = Join-Path $Target "spatialposters"
$NodeDir   = Join-Path $Target "bin"
$NodeExe   = Join-Path $NodeDir "node.exe"

Write-Step "SpatialPosters -> recursos de Aetherio"
Write-Host "    origen: $Source"
Write-Host "    destino: $ServerDir"

if (-not (Test-Path -LiteralPath $Source)) {
    Write-Fail "No existe la carpeta de SpatialPosters: $Source"
}

# ---------------------------------------------------------------- Node portable
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Write-Fail "Hace falta Node 22+ en el PATH para empaquetar el runtime." }
$nodeMajor = [int]((& node -p "process.versions.node").Split(".")[0])
if ($nodeMajor -lt 22) { Write-Fail "Node $nodeMajor es demasiado viejo; hace falta 22 o superior." }

if ((Test-Path -LiteralPath $NodeExe) -and -not $Force) {
    Write-Ok "Node ya empaquetado ($([Math]::Round((Get-Item $NodeExe).Length / 1MB)) MB)"
} else {
    New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
    $nodeSize = (Get-Item -LiteralPath $nodeCmd.Source).Length
    Write-Step "Copiando node.exe ($([Math]::Round($nodeSize / 1MB)) MB)"
    Copy-Item -LiteralPath $nodeCmd.Source -Destination $NodeExe -Force
    Write-Ok "node.exe $((& $NodeExe -v).Trim())"
}

# ------------------------------------------------- ¿Hay que recompilar?
# "Ya existe" no es sinonimo de "esta al dia". Si el source cambio (un commit
# de SpatialPosters, un .env.local nuevo) hay que rehacer el build, o la app
# sigue sirviendo el server viejo sin que nadie se entere.
function Get-NewestSourceWrite {
    $newest = [datetime]::MinValue
    $now = [datetime]::UtcNow

    # Codigo fuente completo: cualquier .ts/.tsx/.js/.mjs bajo src.
    $srcDir = Join-Path $Source "src"
    if (Test-Path -LiteralPath $srcDir) {
        Get-ChildItem -LiteralPath $srcDir -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in @(".ts", ".tsx", ".js", ".mjs", ".json") } |
            ForEach-Object { if ($_.LastWriteTimeUtc -gt $newest) { $newest = $_.LastWriteTimeUtc } }
    }

    # Config de raiz: next.config.ts, package.json, tsconfig.json... Se listan
    # por extension y no por nombre, asi que un next.config.ts nuevo no se
    # escapa por olvidarse en esta lista.
    Get-ChildItem -LiteralPath $Source -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @(".ts", ".tsx", ".js", ".mjs", ".json") } |
        ForEach-Object { if ($_.LastWriteTimeUtc -gt $newest) { $newest = $_.LastWriteTimeUtc } }

    # node_modules no se mira: se rearma entero con npm ci, no archivo por archivo.
    return $newest
}

# Next.js arma `.next/standalone` replicando la ruta del proyecto respecto de la
# raiz del repo. Cuando el source esta en un subdirectorio (que es el caso del
# vendor, en `vendor/spatialposters/`), el server no queda en
# `.next/standalone/server.js` sino en `.next/standalone/vendor/spatialposters/
# server.js`. Buscarlo solo en la raiz daba "no se encontro server.js" y hacia
# fallar el build aunque el standalone estuviera perfecto.
$standaloneRoot = Join-Path $Source ".next\standalone"
$standalone = Join-Path $standaloneRoot "server.js"
if (-not (Test-Path -LiteralPath $standalone)) {
    $nested = Get-ChildItem -LiteralPath $standaloneRoot -Filter "server.js" -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } |
        Select-Object -First 1
    if ($nested) {
        $standalone = $nested.FullName
        Write-Host "    (server standalone encontrado en $($nested.FullName.Substring($standaloneRoot.Length + 1)))"
    }
}
$staged = Join-Path $ServerDir "server.js"
$needsBuild = $true
$reason = "no hay build standalone"

if (Test-Path -LiteralPath $standalone) {
    $needsBuild = $false
    $reason = "el build ya esta al dia"
    $newest = Get-NewestSourceWrite
    $newestUtc = (Get-Item -LiteralPath $standalone).LastWriteTimeUtc
    if ($newest -ne [datetime]::MinValue -and $newest -gt $newestUtc.AddSeconds(1)) {
        $needsBuild = $true
        $reason = "el source cambio despues del ultimo build"
    }
}

if ($Force) {
    $needsBuild = $true
    $reason = "se pidio -Force"
}

if ($needsBuild) {
    Write-Step "Compilando SpatialPosters (standalone) - $reason; puede tardar un par de minutos"
    Push-Location $Source
    try {
        & npm run build --if-present
        if ($LASTEXITCODE -ne 0) { Write-Fail "Falló el build de SpatialPosters (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
} else {
    Write-Ok "Build standalone al dia ($reason)"
}

if (-not (Test-Path -LiteralPath $standalone)) {
    Write-Fail "No se encontró .next\standalone\server.js tras el build."
}

# El staging tambien se saltea si el destino esta mas nuevo que el origen: en un
# build de release es solo copiar 60 MB, pero en `tauri dev` se llama cada vez.
if ((-not $Force) -and (Test-Path -LiteralPath $staged)) {
    $stagedUtc = (Get-Item -LiteralPath $staged).LastWriteTimeUtc
    $builtUtc = (Get-Item -LiteralPath $standalone).LastWriteTimeUtc
    if ($stagedUtc -ge $builtUtc) {
        Write-Ok "Recursos ya actualizados, no hace falta volver a copiar"
        Write-Step "Listo"
        exit 0
    }
}

# ---------------------------------------------------------------- staging
# Next standalone no trae ni .next/static ni public: hay que copiarlos al lado
# de server.js o el HTML sale sin CSS/JS y los posters 404.
$staging = Join-Path $env:TEMP "aetherio-spatialposters-stage"
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Write-Step "Copiando runtime standalone"
Copy-Item -LiteralPath (Join-Path $Source ".next\standalone") -Destination $staging -Recurse -Force

# .next/standalone puede traer un server.js en la raiz o un nivel mas abajo
# segun el monorepo; se busca el que realmente exista.
$stagedServer = Get-ChildItem -Path $staging -Recurse -Filter "server.js" -File |
    Select-Object -First 1
if (-not $stagedServer) { Write-Fail "El staging no contiene ningun server.js." }
$appRoot = $stagedServer.Directory.FullName
if ($appRoot -ne $staging) {
    Write-Host "    (server.js anidado en $($appRoot.Replace($staging, '<stage>')))"
    # Aplanar: el runtime se sirve siempre desde la raiz del recurso.
    Get-ChildItem -LiteralPath $appRoot -Force | ForEach-Object {
        Move-Item -LiteralPath $_.FullName -Destination $staging -Force
    }
}

foreach ($pair in @(
    @{ From = ".next\static"; To = ".next\static" },
    @{ From = "public";         To = "public" }
)) {
    $from = Join-Path $Source $pair.From
    if (Test-Path -LiteralPath $from) {
        $to = Join-Path $staging $pair.To
        New-Item -ItemType Directory -Force -Path (Split-Path $to -Parent) | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
        Write-Ok "copiado $($pair.From)"
    } else {
        Write-Warn "no existe $($pair.From), se omite"
    }
}

# ------------------------------------------------- Binarios nativos de sharp
# El tracer de Next copia el .node pero NO las DLL de libvips. En el proyecto
# original esto no se nota porque Node sube desde .next/standalone hasta el
# node_modules completo de la raiz; aca no hay padre y el server muere con
# ERR_DLOPEN_FAILED -> /api/poster responde 500. Hay que copiarlos enteros.
Write-Step "Copiando binarios nativos de sharp"
$nativePkgs = @("sharp", "@img\sharp-win32-x64", "@img\sharp-libvips-win32-x64", "@img\sharp-linux-x64", "@img\sharp-darwin-x64", "@img\sharp-arm64")
$copiedNative = $false
foreach ($pkg in $nativePkgs) {
    $from = Join-Path $Source "node_modules\$pkg"
    if (-not (Test-Path -LiteralPath $from)) { continue }
    $to = Join-Path $staging "node_modules\$pkg"
    if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $to -Parent) | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
    $size = (Get-ChildItem $to -Recurse -File | Measure-Object -Property Length -Sum).Sum
    Write-Ok "$pkg  ($([Math]::Round($size / 1MB, 1)) MB)"
    $copiedNative = $true
}
if (-not $copiedNative) {
    Write-Fail "No se encontro ningun paquete nativo de sharp en $Source\node_modules."
}

# ------------------------------------------------------------- Volcar al destino
if (Test-Path -LiteralPath $ServerDir) { Remove-Item -LiteralPath $ServerDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ServerDir | Out-Null
Write-Step "Volcando a src-tauri\resources\spatialposters"
Copy-Item -Path (Join-Path $staging "*") -Destination $ServerDir -Recurse -Force
Remove-Item -LiteralPath $staging -Recurse -Force

$files = Get-ChildItem $ServerDir -Recurse -File
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
Write-Ok "server staged: $($files.Count) archivos, $([Math]::Round($bytes / 1MB)) MB"

if (-not (Test-Path -LiteralPath (Join-Path $ServerDir "server.js"))) {
    Write-Fail "El destino no quedo con server.js en la raiz. Revisar el monorepo de SpatialPosters."
}

Write-Step "Listo"
Write-Host "    El servidor de posters viaja dentro de Aetherio. No hace falta Node"
Write-Host "    ni clonar nada: la app lo levanta sola al abrirse."
