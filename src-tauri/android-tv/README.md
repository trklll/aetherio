# Android TV native player handoff

This folder is the checked-in Android TV native layer for Aetherio. It is kept outside
`src-tauri/gen/android` because the official Tauri Android scaffold could not be generated
until the local Android NDK is installed.

After `npm run tauri -- android init --ci --skip-targets-install` succeeds:

1. Copy `AetherioPlayerPlugin.kt` and `AetherioPlayerActivity.kt` into the generated app
   Kotlin source tree using package `com.administrator.aetherio.player`.
2. Register `AetherioPlayerPlugin` in the generated Android Tauri plugin list.
3. Merge `AndroidManifest.tv-snippet.xml` into the generated `AndroidManifest.xml`.
4. Add `build.gradle.media3-snippet.kts` dependencies to the generated app Gradle file.
5. Add a 320x180 TV banner at `src-tauri/gen/android/app/src/main/res/drawable/banner.png`.

The web side already calls the Android plugin through:

- `plugin:aetherio-player|open`
- `plugin:aetherio-player|stop`
- `plugin:aetherio-player|command`
- `plugin:aetherio-player|getLastSession`

Desktop Windows continues to use the existing MPV/libmpv commands.
