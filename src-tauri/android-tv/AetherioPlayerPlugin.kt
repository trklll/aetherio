package com.administrator.aetherio.player

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray

@InvokeArg
class OpenPlayerArgs {
    lateinit var target: String
    var subtitle: String? = null
    var startTime: Double? = null
    var fileIdx: Int? = null
    var headers: Map<String, String>? = null
}

@InvokeArg
class PlayerCommandArgs {
    var command: Array<Any>? = null
}

@TauriPlugin
class AetherioPlayerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun open(invoke: Invoke) {
        val args = invoke.parseArgs(OpenPlayerArgs::class.java)
        if (args.target.isBlank()) {
            invoke.reject("La fuente no tiene URL reproducible.")
            return
        }

        val intent = Intent(activity, AetherioPlayerActivity::class.java)
            .putExtra(AetherioPlayerActivity.EXTRA_TARGET, args.target)
            .putExtra(AetherioPlayerActivity.EXTRA_SUBTITLE, args.subtitle)
            .putExtra(AetherioPlayerActivity.EXTRA_START_TIME_MS, ((args.startTime ?: 0.0) * 1000.0).toLong())
            .putExtra(AetherioPlayerActivity.EXTRA_FILE_IDX, args.fileIdx ?: -1)

        args.headers?.let { headers ->
            val bundle = Bundle()
            headers.forEach { (key, value) ->
                if (key.isNotBlank() && value.isNotBlank()) bundle.putString(key, value)
            }
            intent.putExtra(AetherioPlayerActivity.EXTRA_HEADERS, bundle)
        }

        activity.startActivity(intent)
        val ret = JSObject()
        ret.put("backend", "android-media3")
        ret.put("resolvedTarget", args.target)
        ret.put("pid", null)
        invoke.resolve(ret)
    }

    @Command
    fun stop(invoke: Invoke) {
        activity.sendBroadcast(Intent(AetherioPlayerActivity.ACTION_STOP))
        invoke.resolve(JSObject())
    }

    @Command
    fun command(invoke: Invoke) {
        val args = invoke.parseArgs(PlayerCommandArgs::class.java)
        val command = JSONArray()
        args.command?.forEach { command.put(it) }
        val intent = Intent(AetherioPlayerActivity.ACTION_COMMAND)
        intent.putExtra(AetherioPlayerActivity.EXTRA_COMMAND_JSON, command.toString())
        activity.sendBroadcast(intent)
        invoke.resolve(JSObject())
    }

    @Command
    fun getLastSession(invoke: Invoke) {
        invoke.resolve(AetherioPlayerActivity.readLastSession(activity))
    }
}
