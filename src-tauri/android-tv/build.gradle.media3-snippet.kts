// Add these dependencies to src-tauri/gen/android/app/build.gradle.kts after `tauri android init`.
dependencies {
    val media3Version = "1.10.0"
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-exoplayer-hls:$media3Version")
    implementation("androidx.media3:media3-exoplayer-dash:$media3Version")
    implementation("androidx.media3:media3-ui:$media3Version")
}
