param(
    [switch]$SignForSideload
)

$ErrorActionPreference = "Stop"

function Resolve-JavaHome {
    $candidates = @(
        $env:JAVA_HOME,
        "C:\Program Files\Android\Android Studio1\jbr",
        "C:\Program Files\Android\Android Studio\jbr"
    ) | Where-Object { $_ -and (Test-Path (Join-Path $_ "bin\java.exe")) }

    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate "lib\jvm.cfg")) {
            return $candidate
        }
    }

    throw "No se encontro un JDK valido. Instala Android Studio/JBR o configura JAVA_HOME."
}

function Resolve-AndroidHome {
    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate "platform-tools")) {
            return $candidate
        }
    }

    throw "No se encontro Android SDK. Configura ANDROID_HOME."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$androidRoot = Join-Path $repoRoot "src-tauri\gen\android"
$profile = "release"
$profileCapitalized = "Release"
$apkFileName = "app-universal-release-unsigned.apk"
$targetSo = Join-Path $repoRoot "src-tauri\target\aarch64-linux-android\$profile\libaetherio_lib.so"
$jniDir = Join-Path $repoRoot "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"
$jniSo = Join-Path $jniDir "libaetherio_lib.so"
$apkPath = Join-Path $repoRoot "src-tauri\gen\android\app\build\outputs\apk\universal\$profile\$apkFileName"
$sideloadApkPath = Join-Path $repoRoot "src-tauri\gen\android\app\build\outputs\apk\universal\$profile\app-universal-release-sideload.apk"

Push-Location $repoRoot
try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $tauriArgs = @("run", "tauri", "--", "android", "build", "--apk", "--target", "aarch64")
        $tauriOutput = & npm @tauriArgs 2>&1
        $tauriExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($tauriExitCode -ne 0 -and -not (Test-Path $targetSo)) {
        throw "Tauri no pudo generar $targetSo.`n$($tauriOutput -join [Environment]::NewLine)"
    }
    if ($tauriExitCode -ne 0) {
        Write-Warning "Tauri compilo Rust pero Windows bloqueo el symlink. Se copiara el .so manualmente."
    }

    New-Item -ItemType Directory -Force -Path $jniDir | Out-Null
    Copy-Item -LiteralPath $targetSo -Destination $jniSo -Force

    $env:JAVA_HOME = Resolve-JavaHome
    $env:ANDROID_HOME = Resolve-AndroidHome
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"

    Push-Location $androidRoot
    try {
        & .\gradlew.bat ":app:assembleUniversal$profileCapitalized" `
            -PtargetList=aarch64 `
            -PabiList=arm64-v8a `
            -ParchList=arm64 `
            -x "rustBuildUniversal$profileCapitalized" `
            -x "rustBuildArm64$profileCapitalized"
        if ($LASTEXITCODE -ne 0) {
            throw "Gradle no pudo generar el APK."
        }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path $apkPath)) {
        throw "El build termino, pero no se encontro el APK esperado: $apkPath"
    }

    if ($SignForSideload) {
        $buildTools = Get-ChildItem (Join-Path $env:ANDROID_HOME "build-tools") -Directory |
            Sort-Object Name -Descending |
            Where-Object { Test-Path (Join-Path $_.FullName "apksigner.bat") } |
            Select-Object -First 1
        if (-not $buildTools) {
            throw "No se encontro apksigner.bat en Android SDK Build Tools."
        }

        $apksigner = Join-Path $buildTools.FullName "apksigner.bat"
        $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
        if (-not (Test-Path $keytool)) {
            throw "No se encontro keytool.exe en JAVA_HOME."
        }

        $debugKeyDir = Join-Path $env:USERPROFILE ".android"
        $debugKey = Join-Path $debugKeyDir "debug.keystore"
        if (-not (Test-Path $debugKey)) {
            New-Item -ItemType Directory -Force -Path $debugKeyDir | Out-Null
            & $keytool -genkeypair -v `
                -keystore $debugKey `
                -storepass android `
                -alias androiddebugkey `
                -keypass android `
                -keyalg RSA `
                -keysize 2048 `
                -validity 10000 `
                -dname "CN=Android Debug,O=Android,C=US"
            if ($LASTEXITCODE -ne 0) {
                throw "No se pudo crear la debug keystore."
            }
        }

        if (Test-Path $sideloadApkPath) {
            Remove-Item -LiteralPath $sideloadApkPath -Force
        }
        & $apksigner sign `
            --ks $debugKey `
            --ks-key-alias androiddebugkey `
            --ks-pass pass:android `
            --key-pass pass:android `
            --out $sideloadApkPath `
            $apkPath
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo firmar el APK para sideload."
        }
        & $apksigner verify $sideloadApkPath
        if ($LASTEXITCODE -ne 0) {
            throw "La verificacion de firma del APK fallo."
        }

        Write-Host "APK sideload generado: $sideloadApkPath"
    }
    else {
        Write-Host "APK generado: $apkPath"
    }
}
finally {
    Pop-Location
}
