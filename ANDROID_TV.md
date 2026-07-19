# Aetherio Android TV

## Estado actual

- El repo mantiene React/Vite + Tauri 2 para desktop y Android.
- La frontera de plataforma vive en `src/runtime/platform.ts`.
- Windows desktop sigue usando MPV/libmpv y el contrato `open_mpv`.
- Android TV usa el plugin nativo `aetherio-player` y abre `AetherioPlayerActivity`.
- Player Android v1 usa Media3/ExoPlayer para HTTPS, HLS y DASH.
- P2P/torrent queda fuera de Android v1; el stack `librqbit` solo compila en desktop.

## Archivos Android principales

- `src-tauri/gen/android/app/src/main/java/com/administrator/aetherio/player/AetherioPlayerActivity.kt`
- `src-tauri/gen/android/app/src/main/java/com/administrator/aetherio/player/AetherioPlayerPlugin.kt`
- `src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- `src-tauri/gen/android/app/build.gradle.kts`
- `src-tauri/gen/android/app/src/main/res/drawable/banner.png`

## Comandos normales

```powershell
npm run build
npm run android:dev
npm run android:build:apk
```

El APK release normal queda en:

```text
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

Ese APK release queda sin firma si no hay keystore configurado. Para sideload rapido usa el
APK release firmado con la debug keystore local:

```powershell
npm run android:build:apk:sideload
```

```text
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-sideload.apk
```

## Fallback en Windows sin symlinks

Si `npm run android:build:apk` falla con `Creation symbolic link is not allowed for this system`,
usa:

```powershell
npm run android:build:apk:fallback
```

Ese script compila Rust con Tauri, copia `libaetherio_lib.so` a `jniLibs/arm64-v8a` y ejecuta
Gradle directo para generar el APK arm64 universal. En esta maquina el JBR valido esta en:

```text
C:\Program Files\Android\Android Studio1\jbr
```

## Sideload

Con un emulador Android TV o TV fisica conectada:

```powershell
adb devices
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-sideload.apk
adb shell monkey -p com.administrator.aetherio 1
```

## Checklist manual

- La app aparece en el launcher Android TV por `LEANBACK_LAUNCHER`.
- No requiere touchscreen y arranca en landscape.
- D-pad navega Home, Detalle, Fuentes y Ajustes con foco visible.
- Back vuelve desde Player sin cerrar la app.
- HTTPS/HLS/DASH abre en `AetherioPlayerActivity`.
- Pausa, seek y subtitulos externos funcionan en Media3.
- Desktop sigue abriendo MPV y no usa el plugin Android.

## Regla de mantenimiento

- No asumir que un cambio de PC debe tocar Android TV. Solo hacerlo cuando se pida explicitamente.
- Todo codigo compartido debe mantenerse compatible con ambos targets.
- Android TV no debe reutilizar MPV/libmpv ni `open_mpv`.
