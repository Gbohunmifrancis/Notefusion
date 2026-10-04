package expo.modules.notefusionlisten

import android.Manifest
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS face of the listener: starts and stops {@link KeyListenerService}, forwards its PCM chunks and
 * status as events, and keeps the tile and widget informed.
 */
class NotefusionListenModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private val main = Handler(Looper.getMainLooper())

  /** The start() call waiting for the service to say it is capturing (or why it cannot). */
  private var pendingStart: Promise? = null
  private var startTimeout: Runnable? = null

  private val listener = object : KeyListenerService.Listener {
    override fun onBuffer(samples: FloatArray, sampleRate: Int) {
      // Off the capture thread: the JS bridge is reached from the main queue, as expo-audio does.
      main.post { sendEvent("onBuffer", mapOf("samples" to samples, "sampleRate" to sampleRate)) }
    }

    override fun onStatus(running: Boolean, reason: String, code: String?, message: String?) {
      main.post {
        settleStart(running, code, message)
        sendEvent("onStatus", mapOf("running" to running, "reason" to reason, "code" to code))
      }
    }
  }

  private fun settleStart(running: Boolean, code: String?, message: String?) {
    val promise = pendingStart ?: return
    pendingStart = null
    startTimeout?.let { main.removeCallbacks(it) }
    startTimeout = null
    if (running) promise.resolve(null) else promise.reject(code ?: "E_START_FAILED", message, null)
  }

  override fun definition() = ModuleDefinition {
    Name("NotefusionListen")

    Events("onBuffer", "onStatus")

    OnCreate { KeyListenerService.listener = listener }

    OnDestroy {
      // JS is gone, so nothing could read the buffers: stop rather than listen for nothing.
      KeyListenerService.listener = null
      KeyListenerService.stop()
    }

    AsyncFunction("start") { promise: Promise ->
      if (KeyListenerService.isRunning()) {
        promise.resolve(null)
        return@AsyncFunction
      }
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("E_NO_MIC_PERMISSION", "Microphone permission has not been granted", null)
        return@AsyncFunction
      }
      // Android 14+ only lets a microphone service start under a visible activity. Checked here so the
      // refusal is a stable code rather than a SecurityException from the system.
      val activity = appContext.currentActivity
      val resumed = (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true
      if (!resumed) {
        promise.reject("E_NOT_IN_FOREGROUND", "The app has to be on screen to start listening", null)
        return@AsyncFunction
      }
      if (pendingStart != null) {
        promise.reject("E_ALREADY_STARTING", "Already starting", null)
        return@AsyncFunction
      }
      pendingStart = promise
      startTimeout = Runnable { settleStart(false, "E_START_TIMEOUT", "The microphone service did not start") }
        .also { main.postDelayed(it, 8_000) }
      try {
        KeyListenerService.start(context)
      } catch (e: Exception) {
        // startForegroundService itself refuses (ForegroundServiceStartNotAllowedException on API 31+
        // when the app slipped into the background): settle here, or the timeout would reject twice.
        main.post { settleStart(false, "E_NOT_ALLOWED", e.message) }
      }
    }

    Function("stop") {
      KeyListenerService.stop()
    }

    Function("isRunning") {
      KeyListenerService.isRunning()
    }

    Function("updateNotification") { title: String, body: String ->
      KeyListenerService.update(title, body)
    }

    Function("setListening") { listening: Boolean ->
      ShortcutState.setListening(context, listening)
    }

    Function("setLastKey") { key: String, doh: String ->
      ShortcutState.setLastKey(context, key, doh)
      ListenWidgetProvider.refreshAll(context)
    }

    AsyncFunction("requestAddTile") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      val sbm = context.getSystemService(StatusBarManager::class.java)
      sbm.requestAddTileService(
        ComponentName(context, ListenTileService::class.java),
        context.getString(R.string.nf_tile_label),
        Icon.createWithResource(context, R.drawable.nf_tile_icon),
        context.mainExecutor
      ) { result ->
        promise.resolve(
          when (result) {
            StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "added"
            StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "already_added"
            StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> "declined"
            else -> "error"
          }
        )
      }
    }
  }
}
