#requires -Version 5.1
<#
.SYNOPSIS
  Empaqueta un checkout local licenciado de Nuvio Live Sports para Aetherio.

.DESCRIPTION
  Por defecto obtiene una revisión fijada del repositorio oficial dentro de
  vendor/nuvio-live-sports. NUVIO_SOURCE (o -Source) puede apuntar a un fork
  autorizado. Comprueba la licencia, instala dependencias y compila el addon;
  solo los artefactos de producción se copian a src-tauri/resources/nuvio-live-sports.
#>
[CmdletBinding()]
param(
    [string] $Source = $env:NUVIO_SOURCE,
    [string] $Target
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$defaultSource = Join-Path $repoRoot "vendor\nuvio-live-sports"
$upstreamUrl = "https://github.com/rajhodedara/live-sport-plugin.git"
$upstreamRevision = "50611f7157571878e70582da310bbf2a8e538ed7"
$usingDefaultSource = [string]::IsNullOrWhiteSpace($Source)
if ($usingDefaultSource) {
    $Source = $defaultSource
}
if ([string]::IsNullOrWhiteSpace($Target)) {
    $Target = Join-Path $repoRoot "src-tauri\resources\nuvio-live-sports"
}

function Stop-WithMessage([string] $Message) {
    throw "[nuvio:stage] $Message"
}

if ($usingDefaultSource -and -not (Test-Path -LiteralPath $Source -PathType Container)) {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) { Stop-WithMessage "Se necesita Git para obtener la revisión fijada de Nuvio."
    }
    $sourceParent = Split-Path -Parent $Source
    New-Item -ItemType Directory -Force -Path $sourceParent | Out-Null
    $sourceTemp = Join-Path $sourceParent ".nuvio-source-$([guid]::NewGuid().ToString('N'))"
    try {
        New-Item -ItemType Directory -Path $sourceTemp | Out-Null
        & $git.Source -C $sourceTemp init | Out-Null
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "No se pudo inicializar el checkout local de Nuvio." }
        & $git.Source -C $sourceTemp remote add origin $upstreamUrl
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "No se pudo configurar el origen oficial de Nuvio." }
        & $git.Source -C $sourceTemp fetch --depth 1 origin $upstreamRevision
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "No se pudo descargar la revisión fijada de Nuvio ($upstreamRevision)." }
        & $git.Source -C $sourceTemp checkout --detach FETCH_HEAD
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "No se pudo preparar el checkout fijado de Nuvio." }
        Move-Item -LiteralPath $sourceTemp -Destination $Source
        Write-Host "[nuvio:stage] Checkout oficial fijado en $upstreamRevision."
    } catch {
        if (Test-Path -LiteralPath $sourceTemp) { Remove-Item -LiteralPath $sourceTemp -Recurse -Force }
        throw
    }
}
if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    Stop-WithMessage "No existe el checkout indicado en NUVIO_SOURCE: $Source"
}
$sourceRoot = (Resolve-Path -LiteralPath $Source).Path

if ($usingDefaultSource) {
    $git = Get-Command git -ErrorAction SilentlyContinue
    $revision = if ($git) { & $git.Source -C $sourceRoot rev-parse HEAD 2>$null } else { $null }
    if ($LASTEXITCODE -ne 0 -or $revision.Trim() -ne $upstreamRevision) {
        Stop-WithMessage "El checkout vendor no coincide con la revisión fijada. Usa NUVIO_SOURCE para señalar un fork autorizado o restaura la revisión $upstreamRevision."
    }
}

$packagePath = Join-Path $sourceRoot "package.json"
$lockPath = Join-Path $sourceRoot "package-lock.json"
$nodeModules = Join-Path $sourceRoot "node_modules"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    Stop-WithMessage "El checkout no contiene package.json."
}
if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    Stop-WithMessage "El checkout debe incluir package-lock.json para un staging reproducible."
}
try {
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
} catch {
    Stop-WithMessage "No se pudo leer package.json: $($_.Exception.Message)"
}
$license = [string] $package.license
if ([string]::IsNullOrWhiteSpace($license) -or $license -match '^(?i:UNLICENSED|SEE LICENSE IN|\*)') {
    Stop-WithMessage "package.json debe declarar un identificador de licencia distribuible."
}
$licenseFile = Get-ChildItem -LiteralPath $sourceRoot -File |
    Where-Object { $_.Name -match '^(?i:LICENSE)(?:[-_.].*)?$' -and $_.Length -gt 0 } |
    Select-Object -First 1
if (-not $licenseFile) {
    $readmePath = Join-Path $sourceRoot "README.md"
    $readmeText = if (Test-Path -LiteralPath $readmePath -PathType Leaf) { Get-Content -LiteralPath $readmePath -Raw } else { "" }
    $mitDeclaredByOfficialSource = $usingDefaultSource -and $license -eq "MIT" `
        -and $readmeText -match "(?i)License: MIT" `
        -and $readmeText -match "(?i)open-source under the MIT license"
    if (-not $mitDeclaredByOfficialSource) {
        Stop-WithMessage "No se encontró un archivo LICENSE no vacío. Para distribuir este fork se requiere su licencia verificable."
    }
    Write-Warning "[nuvio:stage] El upstream declara MIT en package.json y README, pero omite LICENSE; se añadirá el aviso MIT al paquete con la atribución del propietario del repositorio."
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "src\index.js") -PathType Leaf)) {
    Stop-WithMessage "El checkout no parece ser el addon Nuvio esperado: falta src/index.js."
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) { Stop-WithMessage "No se encontró npm en PATH. Instala Node.js para preparar el checkout."
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
if (-not $node) { Stop-WithMessage "No se encontró Node.js 22 o superior en PATH."
}
$nodeVersion = (& $node.Source --version).Trim()
if ($nodeVersion -notmatch '^v?(\d+)\.') { Stop-WithMessage "No se pudo determinar la versión de Node.js ($nodeVersion)." }
if ([int] $Matches[1] -lt 22) { Stop-WithMessage "Nuvio requiere Node.js 22 o superior; se encontró $nodeVersion." }

function Get-InstalledProxyAddrVersion {
    Push-Location $sourceRoot
    try {
        $version = & $node.Source -p "require('./node_modules/proxy-addr/package.json').version" 2>$null
        if ($LASTEXITCODE -ne 0) { return "" }
        return ([string] $version).Trim()
    } finally {
        Pop-Location
    }
}

# GHSA-jqcg-44mw-7w3h: Express pide proxy-addr ~2.0.7, vulnerable a
# spoofing IPv4-mapped IPv6. Fijar el override en el checkout antes de npm ci y
# del build para que la corrección alcance tanto node_modules como el bundle ncc.
$packageHashBefore = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
$lockHashBefore = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
Push-Location $sourceRoot
try {
    & $npm.Source pkg set "overrides.proxy-addr=2.0.8"
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "No se pudo fijar el override seguro de proxy-addr en package.json." }
    & $npm.Source install --package-lock-only --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "No se pudo actualizar package-lock.json con proxy-addr 2.0.8." }
} finally {
    Pop-Location
}

$proxyLockCheck = @'
const fs = require("node:fs");
const path = require("node:path");
const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"));
const entries = Object.entries(lock.packages || {}).filter(([path]) =>
  path === "node_modules/proxy-addr" || path.endsWith("/node_modules/proxy-addr"),
);
if (entries.length === 0 || entries.some(([, pkg]) => pkg.version !== "2.0.8")) {
  console.error("El lockfile no resuelve todas las copias de proxy-addr exactamente a 2.0.8:", entries.map(([path, pkg]) => `${path}@${pkg.version}`).join(", ") || "ninguna");
  process.exit(1);
}
console.log(`Lockfile verificado: ${entries.length} copia(s) de proxy-addr en 2.0.8.`);
'@
$proxyLockCheckPath = Join-Path $env:TEMP "aetherio-nuvio-proxy-lock-check-$PID.js"
[System.IO.File]::WriteAllText($proxyLockCheckPath, $proxyLockCheck, (New-Object System.Text.UTF8Encoding($false)))
Push-Location $sourceRoot
try {
    & $node.Source $proxyLockCheckPath
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "El lockfile debe resolver todas las copias de proxy-addr exactamente a 2.0.8." }
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $proxyLockCheckPath) { Remove-Item -LiteralPath $proxyLockCheckPath -Force }
}

$packageHashAfter = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
$lockHashAfter = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
$installedProxyVersion = Get-InstalledProxyAddrVersion
if (-not (Test-Path -LiteralPath $nodeModules -PathType Container) -or
    $packageHashBefore -ne $packageHashAfter -or $lockHashBefore -ne $lockHashAfter -or
    $installedProxyVersion -ne "2.0.8") {
    Write-Host "[nuvio:stage] Instalando dependencias y aplicando proxy-addr 2.0.8."
    Push-Location $sourceRoot
    try {
        & $npm.Source ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "npm ci falló al aplicar la corrección de proxy-addr (código $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
}

$installedProxyVersion = Get-InstalledProxyAddrVersion
if ($installedProxyVersion -ne "2.0.8") {
    Stop-WithMessage "La instalación no quedó protegida: se esperaba proxy-addr 2.0.8 y se encontró '$installedProxyVersion'."
}
Write-Host "[nuvio:stage] Verificado proxy-addr $installedProxyVersion (GHSA-jqcg-44mw-7w3h corregida)."

& $node.Source (Join-Path $PSScriptRoot "prepare-nuvio-desktop.mjs") $sourceRoot
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "No se pudo preparar el perfil de Nuvio para escritorio." }

Write-Host "[nuvio:stage] Construyendo $($package.name) $($package.version) ($license) desde el checkout indicado."
Push-Location $sourceRoot
try {
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "npm run build falló en el checkout licenciado (código $LASTEXITCODE)." }
} finally {
    Pop-Location
}

$dist = Join-Path $sourceRoot "dist"
if (-not (Test-Path -LiteralPath (Join-Path $dist "index.js") -PathType Leaf)) {
    Stop-WithMessage "El build terminó sin generar dist/index.js."
}
if (-not (Test-Path -LiteralPath (Join-Path $dist "src\server.js") -PathType Leaf)) {
    Stop-WithMessage "El build no contiene dist/src/server.js, requerido por el resolver interno de Nuvio."
}
if (-not (Test-Path -LiteralPath (Join-Path $nodeModules "sharp") -PathType Container)) {
    Stop-WithMessage "Falta node_modules/sharp, dependencia externa del bundle de Nuvio. Ejecuta npm ci en el checkout."
}

$targetParent = Split-Path -Parent $Target
New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
$stage = Join-Path $targetParent ".nuvio-stage-$([guid]::NewGuid().ToString('N'))"
$markerName = ".aetherio-nuvio-stage.json"
$placeholderName = ".aetherio-nuvio-placeholder"
$previousTarget = $null

try {
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item -LiteralPath $dist -Destination (Join-Path $stage "dist") -Recurse
    Copy-Item -LiteralPath $packagePath -Destination (Join-Path $stage "package.json")
    Copy-Item -LiteralPath $lockPath -Destination (Join-Path $stage "package-lock.json")
    if ($licenseFile) {
        Copy-Item -LiteralPath $licenseFile.FullName -Destination (Join-Path $stage "LICENSE.txt")
    } else {
        $mitText = @"
MIT License

Copyright (c) 2026 rajhodedara

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"@
        Set-Content -LiteralPath (Join-Path $stage "LICENSE.txt") -Value $mitText -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $stage "THIRD-PARTY-NOTICE.txt") -Value "Source: $upstreamUrl`nRevision: $upstreamRevision`nLicense claimed upstream in package.json and README: MIT`nThe upstream repository does not include a LICENSE file; the MIT notice above is generated from that declaration and attributed to its GitHub owner." -Encoding UTF8
    }

    # Instalar solo producción desde el lockfile: copiar TODO node_modules y
    # podarlo después duplicaba gigabytes de compiladores/tests en disco y
    # tardaba varios minutos en Windows. npm reutiliza su caché de paquetes.
    Push-Location $stage
    try {
        & $npm.Source ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "No se pudieron instalar las dependencias de producción del paquete."
        }
    } finally {
        Pop-Location
    }

    $marker = [ordered]@{
        managedBy = "Aetherio stage-nuvio.ps1"
        package = [string] $package.name
        version = [string] $package.version
        license = $license
        source = if ($usingDefaultSource) { $upstreamUrl } else { $sourceRoot }
        revision = if ($usingDefaultSource) { $upstreamRevision } else { $null }
        licenseNoticeGenerated = [bool] (-not $licenseFile)
        desktopProfileVersion = 2
    } | ConvertTo-Json
    Set-Content -LiteralPath (Join-Path $stage $markerName) -Value $marker -Encoding UTF8

    if (Test-Path -LiteralPath $Target) {
        $managedTarget = Test-Path -LiteralPath (Join-Path $Target $markerName) -PathType Leaf
        $placeholderTarget = Test-Path -LiteralPath (Join-Path $Target $placeholderName) -PathType Leaf
        if (-not $managedTarget -and $placeholderTarget) {
            $entries = @(Get-ChildItem -LiteralPath $Target -Force)
            $placeholderOnly = $entries.Count -eq 1 -and $entries[0].Name -eq $placeholderName
            if (-not $placeholderOnly) {
                Stop-WithMessage "El placeholder del destino tiene archivos adicionales; se conserva intacto: $Target"
            }
        }
        if (-not $managedTarget -and -not $placeholderTarget) {
            Stop-WithMessage "El destino ya existe y no fue creado por este script; se conserva intacto: $Target"
        }
        # Nunca borrar el destino archivo por archivo: un DLL abierto podía
        # dejar el paquete anterior a medio borrar. Primero renombrar y permitir
        # rollback si la promoción falla.
        $previousTarget = Join-Path $targetParent ".nuvio-previous-$([guid]::NewGuid().ToString('N'))"
        Move-Item -LiteralPath $Target -Destination $previousTarget
    }
    try {
        Move-Item -LiteralPath $stage -Destination $Target
    } catch {
        if ($previousTarget -and -not (Test-Path -LiteralPath $Target)) {
            Move-Item -LiteralPath $previousTarget -Destination $Target
        }
        throw
    }
    if ($previousTarget -and (Test-Path -LiteralPath $previousTarget)) {
        try { Remove-Item -LiteralPath $previousTarget -Recurse -Force } catch {
            Write-Warning "[nuvio:stage] El nuevo paquete está listo, pero hay recursos anteriores todavía abiertos en $previousTarget. Cierra Aetherio antes de eliminarlos."
        }
    }
    Write-Host "[nuvio:stage] Recursos locales listos en $Target"
} catch {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    throw
}
