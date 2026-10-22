package expo.modules.notefusionlisten

import android.Manifest
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * JS face of the listener: starts and stops {@link KeyListenerService}, forwards its PCM chunks and
 * status as events, keeps the tile and widget informed — and, for "Listen from anywhere", sets the
 * switches that {@link ListenOverlayService} reads, hands it what the account may send, and sweeps in
 * any take the headless task never got.
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

  /** The feature's state as Settings shows it. */
  private fun anywhereState(): Map<String, Any?> = mapOf(
    "button" to ListenPrefs.buttonOn(context),
    "notification" to ListenPrefs.notificationOn(context),
    "source" to ListenPrefs.source(context),
    "overlayPermitted" to ListenPrefs.overlayPermitted(context),
    "phoneSoundAvailable" to ListenPrefs.phoneSoundAvailable(),
    "tileAdded" to ListenPrefs.tileAdded(context),
    "listening" to ListenOverlayService.isListening(),
    "pro" to ListenPrefs.proActive(context),
  )

  private fun requestTile(service: Class<*>, label: String, icon: Int, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      promise.resolve("unsupported")
      return
    }
    val sbm = context.getSystemService(StatusBarManager::class.java)
    sbm.requestAddTileService(
      ComponentName(context, service),
      label,
      Icon.createWithResource(context, icon),
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

  override fun definition() = ModuleDefinition {
    Name("NotefusionListen")

    Events("onBuffer", "onStatus")

    OnCreate { KeyListenerService.listener = listener }

    // Opening the app brings back a Listen notification swiped away since, and squares the button and notice with the
    // account as the phone last heard it.
    OnActivityEntersForeground {
      runCatching {
        ListenPrefs.setNoticeDismissed(context, false)
        ListenOverlayService.sync(context)
      }
    }

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
      requestTile(ListenTileService::class.java, context.getString(R.string.nf_tile_label), R.drawable.nf_tile_icon, promise)
    }

    // ── Listen from anywhere ────────────────────────────────────────────────

    Function("getAnywhere") { anywhereState() }

    /** Sets what is given (the rest stays), then starts or stops the service to match. */
    Function("setAnywhere") { options: Map<String, Any?> ->
      (options["button"] as? Boolean)?.let { ListenPrefs.setButtonOn(context, it) }
      (options["notification"] as? Boolean)?.let { ListenPrefs.setNotificationOn(context, it) }
      (options["source"] as? String)?.let { ListenPrefs.setSource(context, it) }
      ListenOverlayService.sync(context)
      anywhereState()
    }

    Function("hasOverlayPermission") { ListenPrefs.overlayPermitted(context) }

    /** Android's own "Display over other apps" page for this app; the person switches it on there and comes back. */
    Function("openOverlaySettings") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function false
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { context.startActivity(intent) }.isSuccess
    }

    /** What the account may send, as lib/listenAnywhere writes it; null forgets it. */
    /** Also where Pro arrives or lapses for the button and the notice: they appear or go as it says. */
    Function("setAllowance") { json: String? ->
      ListenPrefs.setAllowance(context, json)
      ListenOverlayService.sync(context)
    }

    Function("setAccount") { signedIn: Boolean ->
      ListenPrefs.setSignedIn(context, signedIn)
      if (!signedIn) {
        ListenPrefs.setAllowance(context, null)
        ListenOverlayService.sync(context)
      }
    }

    /** What the native side logged since the last call, as JSON (`[{name, detail, at}]`), and the log emptied. */
    Function("drainEvents") { ListenPrefs.drainEvents(context) }

    Function("setDataSaver") { on: Boolean ->
      ListenPrefs.setDataSaver(context, on)
    }

    AsyncFunction("requestAddTakeTile") { promise: Promise ->
      requestTile(ListenTakeTileService::class.java, context.getString(R.string.nf_take_tile_label), R.drawable.nf_mark, promise)
    }

    Function("setTakeTileAdded") { added: Boolean ->
      ListenPrefs.setTileAdded(context, added)
    }

    /** The headless task is done with its take (queued, or given up): the service need not stay for it. */
    Function("takeHandled") {
      ListenOverlayService.takeHandled(context)
    }

    /**
     * Takes still in the take folder: ones the headless task never received (the process died between the
     * two). JS moves each into the send queue; what it cannot, it deletes.
     */
    Function("pendingTakes") {
      val dir = File(context.cacheDir, ListenOverlayService.TAKE_DIR)
      // Older than the headless task could still be running for (ten minutes): one it is handling now is not listed twice.
      val stale = System.currentTimeMillis() - 15L * 60_000L
      (dir.listFiles() ?: emptyArray())
        .filter { it.isFile && it.name.endsWith(".m4a") && it.length() > 0 && it.lastModified() < stale }
        .map { mapOf("uri" to Uri.fromFile(it).toString(), "fileName" to it.name) }
    }
  }
}
