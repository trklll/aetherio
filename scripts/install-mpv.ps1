param(
  [string]$ArchivePath,
  [string]$Url = "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260412/mpv-x86_64-20260412-git-062f4bf.7z"
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
New-Item -ItemType Directory -Force -Path $target | Out-Null

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("aetherio-mpv-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $temp | Out-Null

try {
  tar -xf $resolvedArchive -C $temp
  $mpv = Get-ChildItem -Path $temp -Recurse -Filter mpv.exe | Select-Object -First 1
  if (-not $mpv) {
    throw "The zip does not contain mpv.exe"
  }

  $source = $mpv.Directory.FullName
  Get-ChildItem -Path $source -File | Copy-Item -Destination $target -Force

  Write-Host "MPV runtime installed into $target"
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force
  if (-not $ArchivePath -and (Test-Path -LiteralPath $resolvedArchive)) {
    Remove-Item -LiteralPath $resolvedArchive -Force
  }
}
