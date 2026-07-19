package com.administrator.aetherio.player

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import app.tauri.plugin.JSObject
import org.json.JSONArray

class AetherioPlayerActivity : Activity() {
    private var player: ExoPlayer? = null
    private var target: String = ""

    private val stopReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finish()
        }
    }

    private val commandReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            handleCommand(intent?.getStringExtra(EXTRA_COMMAND_JSON).orEmpty())
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        target = intent.getStringExtra(EXTRA_TARGET).orEmpty()
        if (target.isBlank()) {
            finish()
            return
        }

        registerPlaybackReceiver(stopReceiver, IntentFilter(ACTION_STOP))
        registerPlaybackReceiver(commandReceiver, IntentFilter(ACTION_COMMAND))

        val headers = readHeaders(intent.getBundleExtra(EXTRA_HEADERS))
        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(headers["User-Agent"] ?: "Aetherio Android TV")
            .setDefaultRequestProperties(headers)

        val exoPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(httpFactory))
            .build()

        val mediaItem = buildMediaItem(
            target = target,
            subtitle = intent.getStringExtra(EXTRA_SUBTITLE),
        )

        val playerView = PlayerView(this).apply {
            useController = true
            controllerAutoShow = true
            controllerHideOnTouch = false
            player = exoPlayer
            isFocusable = true
            isFocusableInTouchMode = true
        }

        setContentView(FrameLayout(this).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            addView(
                playerView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
        })

        player = exoPlayer
        exoPlayer.setMediaItem(mediaItem)
        exoPlayer.prepare()

        val startTimeMs = intent.getLongExtra(EXTRA_START_TIME_MS, 0L)
        if (startTimeMs > 0) exoPlayer.seekTo(startTimeMs)
        exoPlayer.playWhenReady = true
        playerView.requestFocus()
    }

    override fun onPause() {
        saveSession()
        super.onPause()
    }

    override fun onDestroy() {
        saveSession()
        try {
            unregisterReceiver(stopReceiver)
            unregisterReceiver(commandReceiver)
        } catch (_: IllegalArgumentException) {
            // Receiver was already unregistered by Android lifecycle cleanup.
        }
        player?.release()
        player = null
        super.onDestroy()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            finish()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun registerPlaybackReceiver(receiver: BroadcastReceiver, filter: IntentFilter) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(receiver, filter)
        }
    }

    private fun handleCommand(rawJson: String) {
        if (rawJson.isBlank()) return
        val command = runCatching { JSONArray(rawJson) }.getOrNull() ?: return
        val name = command.optString(0)
        val exoPlayer = player ?: return
        when (name) {
            "set_property" -> handleSetProperty(exoPlayer, command)
            "seek" -> {
                val amount = command.optDouble(1, 0.0)
                val mode = command.optString(2)
                val targetMs = if (mode == "relative") {
                    exoPlayer.currentPosition + (amount * 1000.0).toLong()
                } else {
                    (amount * 1000.0).toLong()
                }
                exoPlayer.seekTo(targetMs.coerceAtLeast(0L))
            }
        }
    }

    private fun handleSetProperty(exoPlayer: ExoPlayer, command: JSONArray) {
        when (command.optString(1)) {
            "pause" -> {
                if (command.optBoolean(2, false)) exoPlayer.pause() else exoPlayer.play()
            }
            "volume" -> {
                val volume = (command.optDouble(2, 100.0) / 100.0).toFloat()
                exoPlayer.volume = volume.coerceIn(0f, 1f)
            }
            "speed" -> {
                val speed = command.optDouble(2, 1.0).toFloat()
                exoPlayer.setPlaybackSpeed(speed.coerceIn(0.25f, 3.0f))
            }
        }
    }

    private fun saveSession() {
        val exoPlayer = player ?: return
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString("target", target)
            .putLong("timePosMs", exoPlayer.currentPosition)
            .putLong("durationMs", if (exoPlayer.duration == C.TIME_UNSET) 0L else exoPlayer.duration)
            .putBoolean("pause", !exoPlayer.isPlaying)
            .putBoolean("fileLoaded", exoPlayer.playbackState != Player.STATE_IDLE)
            .apply()
    }

    companion object {
        const val EXTRA_TARGET = "aetherio.extra.TARGET"
        const val EXTRA_SUBTITLE = "aetherio.extra.SUBTITLE"
        const val EXTRA_HEADERS = "aetherio.extra.HEADERS"
        const val EXTRA_START_TIME_MS = "aetherio.extra.START_TIME_MS"
        const val EXTRA_FILE_IDX = "aetherio.extra.FILE_IDX"
        const val EXTRA_COMMAND_JSON = "aetherio.extra.COMMAND_JSON"
        const val ACTION_STOP = "com.administrator.aetherio.player.STOP"
        const val ACTION_COMMAND = "com.administrator.aetherio.player.COMMAND"
        private const val PREFS_NAME = "aetherio_player_session"

        fun readLastSession(context: Context): JSObject {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val ret = JSObject()
            ret.put("timePos", prefs.getLong("timePosMs", 0L).toDouble() / 1000.0)
            ret.put("duration", prefs.getLong("durationMs", 0L).toDouble() / 1000.0)
            ret.put("pause", prefs.getBoolean("pause", true))
            ret.put("fileLoaded", prefs.getBoolean("fileLoaded", false))
            ret.put("tracks", JSONArray())
            return ret
        }

        private fun readHeaders(bundle: Bundle?): Map<String, String> {
            if (bundle == null) return emptyMap()
            return bundle.keySet()
                .mapNotNull { key -> bundle.getString(key)?.let { value -> key to value } }
                .toMap()
        }

        private fun buildMediaItem(target: String, subtitle: String?): MediaItem {
            val builder = MediaItem.Builder().setUri(Uri.parse(target))
            if (!subtitle.isNullOrBlank()) {
                val subtitleConfig = MediaItem.SubtitleConfiguration.Builder(Uri.parse(subtitle))
                    .setMimeType(guessSubtitleMimeType(subtitle))
                    .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                    .build()
                builder.setSubtitleConfigurations(listOf(subtitleConfig))
            }
            return builder.build()
        }

        private fun guessSubtitleMimeType(url: String): String {
            val lower = url.lowercase()
            return when {
                lower.endsWith(".vtt") || lower.contains(".vtt?") -> MimeTypes.TEXT_VTT
                lower.endsWith(".ttml") || lower.contains(".ttml?") -> MimeTypes.APPLICATION_TTML
                else -> MimeTypes.APPLICATION_SUBRIP
            }
        }
    }
}
