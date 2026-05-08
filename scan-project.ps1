$project = 'C:\Users\Administrator\Documents\Projects\aetherio'
$src     = "$project\src"
$output  = "$project\project-snapshot.txt"
$exts    = @('*.ts','*.tsx','*.js','*.json','*.css','*.sql','*.toml')
$ignore  = @('node_modules','dist','.git','target','__pycache__','.tauri')

Write-Host 'Escaneando proyecto Aetherio...' -ForegroundColor Cyan

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('=== AETHERIO PROJECT SNAPSHOT ===')
$lines.Add("Generado: $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
$lines.Add("Ruta: $project")
$lines.Add('')

# Estructura de carpetas
$lines.Add('=== ESTRUCTURA DE CARPETAS ===')
Get-ChildItem -Path $src -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $path = $_.FullName; -not ($ignore | Where-Object { $path -match $_ }) } |
  ForEach-Object {
    $rel = $_.FullName.Replace($project,'').TrimStart('\')
    $lines.Add("  $rel")
  }
$lines.Add('')

# package.json
$pkgPath = "$project\package.json"
if (Test-Path $pkgPath) {
  $lines.Add('=== package.json ===')
  try {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    $lines.Add("Nombre: $($pkg.name)  Version: $($pkg.version)")
    $lines.Add('--- dependencies ---')
    $pkg.dependencies.PSObject.Properties | ForEach-Object { $lines.Add("  $($_.Name): $($_.Value)") }
    $lines.Add('--- devDependencies ---')
    $pkg.devDependencies.PSObject.Properties | ForEach-Object { $lines.Add("  $($_.Name): $($_.Value)") }
  } catch { $lines.Add('Error leyendo package.json') }
  $lines.Add('')
}

# tauri.conf.json
$tauriConf = "$project\src-tauri\tauri.conf.json"
if (Test-Path $tauriConf) {
  $lines.Add('=== src-tauri/tauri.conf.json ===')
  $lines.Add((Get-Content $tauriConf -Raw))
  $lines.Add('')
}

# Archivos de codigo fuente
$lines.Add('=== ARCHIVOS DE CODIGO FUENTE ===')

$allFiles = Get-ChildItem -Path $project -Recurse -File -Include $exts -ErrorAction SilentlyContinue |
  Where-Object {
    $path = $_.FullName
    -not ($ignore | Where-Object { $path -match $_ })
  } |
  Sort-Object FullName

$totalFiles = 0
$skipped    = 0

foreach ($file in $allFiles) {
  $rel  = $file.FullName.Replace($project,'').TrimStart('\')
  $size = $file.Length

  if ($size -gt 80000) {
    $kb = [math]::Round($size/1024)
    $lines.Add("--- $rel [OMITIDO: ${kb}KB] ---")
    $skipped++
    continue
  }

  try {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8 -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($content)) {
      $lines.Add("--- $rel [VACIO] ---")
    } else {
      $lines.Add('')
      $lines.Add("<<< FILE: $rel >>>")
      $lines.Add($content)
      $lines.Add("<<< END: $rel >>>")
      $totalFiles++
    }
  } catch {
    $lines.Add("--- $rel [ERROR LECTURA] ---")
  }
}

$lines.Add('')
$lines.Add('=== RESUMEN ===')
$lines.Add("Archivos leidos: $totalFiles")
$lines.Add("Archivos omitidos: $skipped")

# Guardar
$lines | Out-File -FilePath $output -Encoding UTF8

$finalSizeKB = [math]::Round((Get-Item $output).Length / 1KB)
Write-Host ''
Write-Host "Snapshot generado: $output" -ForegroundColor Green
Write-Host "Archivos leidos : $totalFiles" -ForegroundColor White
Write-Host "Tamano          : ${finalSizeKB}KB" -ForegroundColor White

# Dividir si es grande
if ($finalSizeKB -gt 150) {
  Write-Host ''
  Write-Host "Archivo grande (${finalSizeKB}KB). Dividiendo en partes..." -ForegroundColor Yellow

  $allContent = Get-Content $output -Raw
  $chunkSize  = 120000
  $parts      = [math]::Ceiling($allContent.Length / $chunkSize)

  for ($i = 0; $i -lt $parts; $i++) {
    $start    = $i * $chunkSize
    $len      = [math]::Min($chunkSize, $allContent.Length - $start)
    $chunk    = $allContent.Substring($start, $len)
    $partNum  = $i + 1
    $partPath = "$project\project-snapshot-part${partNum}.txt"
    $header   = "=== PARTE $partNum de $parts ===" + "`n"
    ($header + $chunk) | Out-File $partPath -Encoding UTF8
    Write-Host "  Parte $partNum guardada -> project-snapshot-part${partNum}.txt" -ForegroundColor Green
  }
  Write-Host 'Sube cada parte al chat en orden.' -ForegroundColor Yellow
} else {
  Write-Host 'Sube project-snapshot.txt directamente al chat.' -ForegroundColor Yellow
}

# Abrir carpeta
Start-Process explorer.exe $project