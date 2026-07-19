param(
  [string]$ArchivePath,
  [string]$DevArchivePath,
  [string]$Url = "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260412/mpv-x86_64-20260412-git-062f4bf.7z",
  [string]$DevUrl = "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260412/mpv-dev-x86_64-20260412-git-062f4bf.7z"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root "src-tauri\bin\mpv"

if ($ArchivePath) {
  $resolvedArchive = Resolve-Path -LiteralPath $ArchivePath
} else {
  $resolvedArchive = Join-Path ([System.IO.Path]::GetTempPath()) "aetherio-mpv.7z"
  Invoke-WebRequest -Uri $Url -OutFile $resolvedArchive
}
if ($DevArchivePath) {
  $resolvedDevArchive = Resolve-Path -LiteralPath $DevArchivePath
} else {
  $resolvedDevArchive = Join-Path ([System.IO.Path]::GetTempPath()) "aetherio-mpv-dev.7z"
  Invoke-WebRequest -Uri $DevUrl -OutFile $resolvedDevArchive
}
New-Item -ItemType Directory -Force -Path $target | Out-Null

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("aetherio-mpv-" + [System.Guid]::NewGuid())
$devTemp = Join-Path ([System.IO.Path]::GetTempPath()) ("aetherio-mpv-dev-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $temp | Out-Null
New-Item -ItemType Directory -Force -Path $devTemp | Out-Null

try {
  tar -xf $resolvedArchive -C $temp
  $mpv = Get-ChildItem -Path $temp -Recurse -Filter mpv.exe | Select-Object -First 1
  if (-not $mpv) {
    throw "The zip does not contain mpv.exe"
  }

  $source = $mpv.Directory.FullName
  Get-ChildItem -Path $source -File |
    Where-Object { $_.Extension -ieq ".dll" -or $_.Name -ieq "yt-dlp.exe" } |
    Copy-Item -Destination $target -Force

  if (-not (Test-Path -LiteralPath (Join-Path $target "libmpv-2.dll"))) {
    tar -xf $resolvedDevArchive -C $devTemp
    $libmpv = Get-ChildItem -Path $devTemp -Recurse -Filter libmpv-2.dll | Select-Object -First 1
    if (-not $libmpv) {
      throw "The dev archive does not contain libmpv-2.dll"
    }
    Copy-Item -LiteralPath $libmpv.FullName -Destination $target -Force
  }

  if (-not (Test-Path -LiteralPath (Join-Path $target "libmpv-2.dll"))) {
    throw "libmpv-2.dll was not installed"
  }
  foreach ($unused in @("mpv.exe", "mpv.com", "updater.bat")) {
    $unusedPath = Join-Path $target $unused
    if (Test-Path -LiteralPath $unusedPath) {
      Remove-Item -LiteralPath $unusedPath -Force
    }
  }

  Write-Host "libmpv runtime installed into $target"
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force
  Remove-Item -LiteralPath $devTemp -Recurse -Force
  if (-not $ArchivePath -and (Test-Path -LiteralPath $resolvedArchive)) {
    Remove-Item -LiteralPath $resolvedArchive -Force
  }
  if (-not $DevArchivePath -and (Test-Path -LiteralPath $resolvedDevArchive)) {
    Remove-Item -LiteralPath $resolvedDevArchive -Force
  }
}
