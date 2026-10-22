package expo.modules.notefusionlisten

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.io.File

/**
 * "Listen from anywhere" (boards r-listen R1–R3): the foreground service behind the floating button, the
 * quiet notification and the Listen tile. It draws the button over other apps (`OverlayUi`), records a
 * take when asked (`TakeRecorder`) and hands the finished file to the app's send queue through a headless
 * JS task (`ListenTakeHeadlessService` → lib/listenTake.ts → lib/outbox), so a take from here is sent
 * exactly as one from the Record screen, and the ready push the app already sends brings the person back.
 *
 * It runs while the floating button is on (and allowed) or the quiet notification is on, and for the
 * length of a take started from the tile when neither is. Its foreground type is `specialUse` while it
 * only waits (a button over other apps), with `microphone` or `mediaProjection` added for the take.
 *
 * Starting the microphone with the app not in front is what Android 14+ restricts. Three ways in, each
 * one the system allows: the notification's Listen action (a notification's own PendingIntent), the
 * floating button (the app holds "Display over other apps" and the button is on screen), and the tile,
 * which passes through `ListenTakeActivity`, a translucent activity that is in front for the moment the
 * recording starts — and where "This phone's sound" asks Android's consent, which only an activity can.
 * If the direct start is refused all the same, the button's tap goes through that activity too.
 */
class ListenOverlayService : Service(), OverlayUi.Host, TakeRecorder.Listener {
  private val main = Handler(Looper.getMainLooper())
  private var overlay: OverlayUi? = null
  private var recorder: TakeRecorder? = null
  private var projection: MediaProjection? = null
  private var projectionCallback: MediaProjection.Callback? = null
  @Volatile private var listening = false
  private var elapsed = 0
  private var source = ListenPrefs.SOURCE_ROOM
  private var from = "bubble"
  private var viaActivity = false
  private var capReached = false
  private var takeFile: File? = null
  /** A take is on its way through JS: the process is kept in the foreground until it says so (or 10 min). */
  private var pendingTask = false
  private var pendingTaskTimeout: Runnable? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    ensureChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_TAKE_START -> beginTake(intent)
      ACTION_TAKE_STOP -> finishTake(send = true)
      ACTION_TAKE_CANCEL -> finishTake(send = false)
      ACTION_HIDE_NOTIFICATION -> {
        ListenPrefs.setNotificationOn(this, false)
        applyState()
      }
      ACTION_TAKE_DONE -> {
        pendingTask = false
        applyState()
      }
      else -> applyState()
    }
    return START_STICKY
  }

  /** What keeps the service: the button on and allowed, the notification on, a take, or one being sent. */
  private fun kept(): Boolean =
    (ListenPrefs.buttonOn(this) && ListenPrefs.overlayPermitted(this)) || ListenPrefs.notificationOn(this) || listening || pendingTask

  private fun applyState() {
    if (!kept()) {
      shutdown()
      return
    }
    if (!enterForeground()) {
      shutdown()
      return
    }
    syncOverlay()
  }

  private fun syncOverlay() {
    val wanted = ListenPrefs.buttonOn(this) && ListenPrefs.overlayPermitted(this)
    if (wanted) {
      val ui = overlay ?: OverlayUi(this, this).also { overlay = it }
      if (!ui.shown) ui.show()
      ui.setListening(listening, if (listening) line(ListenPrefs.allowance(this)) else "")
    } else {
      overlay?.hide()
      overlay = null
    }
  }

  /** The service's types right now: `specialUse` to wait, `microphone` / `mediaProjection` for the take. */
  private fun foregroundTypes(): Int {
    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    if (listening) {
      if (source == ListenPrefs.SOURCE_PHONE) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      }
    }
    return types
  }

  /** Promotes (or re-promotes, with the take's type) the service. False when Android refused. */
  private fun enterForeground(): Boolean =
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), foregroundTypes())
      true
    } catch (e: Exception) {
      false
    }

  private fun shutdown() {
    overlay?.hide()
    overlay = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (listening) finishTake(send = false)
    overlay?.hide()
    overlay = null
    if (instance === this) instance = null
    super.onDestroy()
  }

  // ── A take ────────────────────────────────────────────────────────────────

  private fun beginTake(intent: Intent) {
    // In the foreground first with the waiting type: a start refused below must still leave a promoted service.
    if (!listening && !enterForeground()) {
      shutdown()
      settleStart(false, "E_NOT_ALLOWED")
      return
    }
    if (listening) {
      settleStart(true, null)
      return
    }
    source = intent.getStringExtra(EXTRA_SOURCE) ?: ListenPrefs.source(this)
    from = intent.getStringExtra(EXTRA_FROM) ?: "bubble"
    viaActivity = intent.getBooleanExtra(EXTRA_VIA_ACTIVITY, false)
    val projectionCode = intent.getIntExtra(EXTRA_PROJECTION_CODE, 0)
    @Suppress("DEPRECATION")
    val projectionData: Intent? = intent.getParcelableExtra(EXTRA_PROJECTION_DATA)
    syncOverlay()

    if (!ListenPrefs.signedIn(this)) {
      say(getString(R.string.nf_take_signed_out), OverlayUi.Card.PROBLEM, 6_000)
      settleStart(false, "E_SIGNED_OUT")
      return
    }
    val allowance = ListenPrefs.allowance(this)
    if (!allowance.canSend) {
      noneLeft(allowance)
      settleStart(false, "E_NONE_LEFT")
      return
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      say(getString(R.string.nf_take_no_mic), OverlayUi.Card.PROBLEM, 6_000)
      settleStart(false, "E_NO_MIC_PERMISSION")
      return
    }
    if (source == ListenPrefs.SOURCE_PHONE && projectionData == null) {
      // Android's consent for the phone's sound needs an activity: the trampoline asks and comes back here.
      settleStart(true, null)
      launchActivity()
      return
    }
    if (KeyListenerService.isRunning()) KeyListenerService.stop()

    listening = true
    elapsed = 0
    capReached = false
    if (!enterForeground()) {
      listening = false
      enterForeground()
      if (!viaActivity && source == ListenPrefs.SOURCE_ROOM) {
        // The microphone refused from here (the app is not in front): once through the activity, which is.
        settleStart(true, null)
        launchActivity()
        return
      }
      say(getString(R.string.nf_take_not_allowed), OverlayUi.Card.PROBLEM, 6_000)
      settleStart(false, "E_NOT_ALLOWED")
      return
    }

    if (source == ListenPrefs.SOURCE_PHONE && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val mpm = getSystemService(MediaProjectionManager::class.java)
      val p = runCatching { mpm.getMediaProjection(projectionCode, projectionData!!) }.getOrNull()
      if (p == null) {
        // The consent came back unusable: the room instead, said so.
        source = ListenPrefs.SOURCE_ROOM
        if (!enterForeground()) {
          listening = false
          enterForeground()
          say(getString(R.string.nf_take_not_allowed), OverlayUi.Card.PROBLEM, 6_000)
          settleStart(false, "E_NOT_ALLOWED")
          return
        }
        say(getString(R.string.nf_take_capture_blocked), OverlayUi.Card.PROBLEM, 6_000)
      } else {
        val cb = object : MediaProjection.Callback() {
          override fun onStop() {
            // The system (or the user, from the status bar) ended the projection: the take ends with it.
            main.post { if (listening && projection != null) finishTake(send = true) }
          }
        }
        runCatching { p.registerCallback(cb, main) }
        projection = p
        projectionCallback = cb
      }
    }

    if (!startRecorder(allowance)) {
      settleStart(false, "E_MIC_UNAVAILABLE")
      return
    }
    settleStart(true, null)
  }

  private fun startRecorder(allowance: ListenPrefs.Allowance): Boolean {
    val file = File(File(cacheDir, TAKE_DIR), "take-${System.currentTimeMillis()}.m4a")
    val bitRate = if (ListenPrefs.dataSaver(this)) 32_000 else 128_000
    val r = TakeRecorder(this, source, projection, file, bitRate, allowance.capSeconds, this)
    if (!r.start()) {
      listening = false
      releaseProjection()
      enterForeground()
      return false
    }
    recorder = r
    takeFile = file
    ListenPrefs.setTakeListening(this, true)
    ListenPrefs.setTakeElapsed(this, 0)
    requestTileState()
    overlay?.setListening(true, line(allowance))
    tick()
    return true
  }

  private fun settleStart(ok: Boolean, code: String?) {
    val l = takeStartListener ?: return
    takeStartListener = null
    l(ok, code)
  }

  private fun launchActivity() {
    runCatching {
      startActivity(ListenTakeActivity.intent(this, source, from).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }.onFailure { say(getString(R.string.nf_take_not_allowed), OverlayUi.Card.PROBLEM, 6_000) }
  }

  private fun finishTake(send: Boolean) {
    val r = recorder ?: return
    recorder = null
    val result = r.stop()
    releaseProjection()
    listening = false
    ListenPrefs.setTakeListening(this, false)
    requestTileState()
    overlay?.setListening(false, "")
    val file = takeFile
    takeFile = null
    if (!send || file == null) {
      file?.delete()
      applyState()
      return
    }
    if (!result.ok || result.durationSec < MIN_TAKE_SEC) {
      file.delete()
      say(getString(R.string.nf_take_too_short), OverlayUi.Card.PROBLEM, 6_000)
      applyState()
      return
    }
    pendingTask = true
    pendingTaskTimeout?.let { main.removeCallbacks(it) }
    pendingTaskTimeout = Runnable {
      pendingTask = false
      applyState()
    }.also { main.postDelayed(it, PENDING_TASK_MAX_MS) }
    applyState()
    val handed = startHeadless(file, result.durationSec)
    val cap = OverlayUi.formatClock(ListenPrefs.allowance(this).capSeconds)
    val text = when {
      !handed -> getString(R.string.nf_take_kept)
      capReached -> getString(R.string.nf_take_cap_sent, cap)
      online() -> getString(R.string.nf_take_sent)
      else -> getString(R.string.nf_take_kept)
    }
    say(text, OverlayUi.Card.SENT, 4_000)
  }

  /** Hands the file to JS (lib/listenTake.ts). A file still in the take folder later is one JS never got: the app sweeps it in. */
  private fun startHeadless(file: File, durationSec: Double): Boolean {
    val i = Intent(this, ListenTakeHeadlessService::class.java)
      .putExtra("uri", Uri.fromFile(file).toString())
      .putExtra("fileName", file.name)
      .putExtra("durationSec", durationSec)
      .putExtra("source", source)
      .putExtra("from", from)
    return runCatching { startService(i) }.isSuccess
  }

  private fun releaseProjection() {
    val p = projection ?: return
    projection = null
    projectionCallback?.let { runCatching { p.unregisterCallback(it) } }
    projectionCallback = null
    runCatching { p.stop() }
  }

  private fun tick() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) getSystemService(VibratorManager::class.java)?.defaultVibrator
      else @Suppress("DEPRECATION") getSystemService(Vibrator::class.java)
      runCatching { v?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)) }
    }
  }

  private fun online(): Boolean {
    val cm = getSystemService(ConnectivityManager::class.java) ?: return true
    val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }

  private fun requestTileState() {
    runCatching {
      android.service.quicksettings.TileService.requestListeningState(
        this,
        android.content.ComponentName(this, ListenTakeTileService::class.java)
      )
    }
  }

  // ── Words ─────────────────────────────────────────────────────────────────

  /** The pill's second line (R1 "The words"). */
  private fun line(a: ListenPrefs.Allowance): String {
    val cap = OverlayUi.formatClock(a.capSeconds)
    return when {
      a.isPro || !a.known -> getString(R.string.nf_take_line_pro, cap)
      a.freeLeft > 0 -> getString(R.string.nf_take_line_free, a.freeLeft, a.freePerWeek, cap)
      else -> getString(R.string.nf_take_line_bought, a.boughtLeft, cap)
    }
  }

  private fun noneLeft(a: ListenPrefs.Allowance) {
    val text = getString(R.string.nf_take_none_left, a.back)
    val ui = overlay
    if (ui != null && ui.shown) ui.showCard(OverlayUi.Card.NONE_LEFT, text, 8_000)
    else Toast.makeText(this, "$text · ${getString(R.string.nf_take_buy_song)}", Toast.LENGTH_LONG).show()
  }

  /** On the bubble's card when it is on screen, otherwise as Android's own toast (the tile and notification paths). */
  private fun say(text: String, kind: OverlayUi.Card, durationMs: Long) {
    val ui = overlay
    if (ui != null && ui.shown) ui.showCard(kind, text, durationMs)
    else Toast.makeText(this, text, Toast.LENGTH_LONG).show()
  }

  // ── OverlayUi.Host ────────────────────────────────────────────────────────

  override fun onTap() {
    if (listening) return
    val src = ListenPrefs.source(this)
    if (src == ListenPrefs.SOURCE_PHONE) {
      source = src
      from = "bubble"
      launchActivity()
      return
    }
    beginTake(Intent().putExtra(EXTRA_SOURCE, src).putExtra(EXTRA_FROM, "bubble"))
  }

  override fun onStop() {
    finishTake(send = true)
  }

  override fun onHidden() {
    ListenPrefs.setButtonOn(this, false)
    Toast.makeText(this, getString(R.string.nf_bubble_hidden), Toast.LENGTH_LONG).show()
    applyState()
  }

  override fun onBuySong() {
    runCatching {
      startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse("notefusion://upgrade?single=1"))
          .setPackage(packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }
  }

  // ── TakeRecorder.Listener ─────────────────────────────────────────────────

  override fun onLevel(level: Float) {
    overlay?.setLevel(level)
  }

  override fun onElapsed(seconds: Int) {
    if (!listening) return
    elapsed = seconds
    overlay?.setClock(seconds)
    ListenPrefs.setTakeElapsed(this, seconds)
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
    requestTileState()
  }

  override fun onCapReached() {
    capReached = true
    finishTake(send = true)
  }

  override fun onCaptureSilent() {
    // The app opted out of capture: the same take again, from the room.
    val r = recorder ?: return
    recorder = null
    r.stop()
    takeFile?.delete()
    takeFile = null
    releaseProjection()
    source = ListenPrefs.SOURCE_ROOM
    if (!enterForeground()) {
      listening = false
      ListenPrefs.setTakeListening(this, false)
      requestTileState()
      overlay?.setListening(false, "")
      enterForeground()
      say(getString(R.string.nf_take_not_allowed), OverlayUi.Card.PROBLEM, 6_000)
      return
    }
    if (startRecorder(ListenPrefs.allowance(this))) {
      say(getString(R.string.nf_take_capture_blocked), OverlayUi.Card.PROBLEM, 6_000)
    }
  }

  override fun onFailed(code: String, message: String?) {
    if (listening) {
      finishTake(send = false)
    }
    say(getString(R.string.nf_take_failed), OverlayUi.Card.PROBLEM, 6_000)
  }

  // ── Notification ──────────────────────────────────────────────────────────

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, getString(R.string.nf_anywhere_channel), NotificationManager.IMPORTANCE_LOW).apply {
        description = getString(R.string.nf_anywhere_channel_description)
        setShowBadge(false)
      }
    )
  }

  private fun pendingFlags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  private fun serviceAction(action: String, requestCode: Int): PendingIntent {
    val i = Intent(this, ListenOverlayService::class.java).setAction(action)
    return PendingIntent.getService(this, requestCode, i, pendingFlags())
  }

  /** Listen: the microphone straight from the notification (its own exemption); the phone's sound through the activity's consent. */
  private fun listenAction(): PendingIntent {
    val src = ListenPrefs.source(this)
    if (src == ListenPrefs.SOURCE_PHONE) return ListenTakeActivity.pendingIntent(this, src, "notification", 21)
    val i = Intent(this, ListenOverlayService::class.java)
      .setAction(ACTION_TAKE_START)
      .putExtra(EXTRA_SOURCE, src)
      .putExtra(EXTRA_FROM, "notification")
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) PendingIntent.getForegroundService(this, 22, i, pendingFlags())
    else PendingIntent.getService(this, 22, i, pendingFlags())
  }

  private fun openApp(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(this, 23, launch, pendingFlags())
  }

  private fun buildNotification(): Notification {
    val b = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.nf_mark)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    if (listening) {
      val cap = OverlayUi.formatClock(ListenPrefs.allowance(this).capSeconds)
      val from = getString(if (source == ListenPrefs.SOURCE_PHONE) R.string.nf_take_from_phone else R.string.nf_take_from_room)
      b.setContentTitle("${getString(R.string.nf_bubble_listening)} · ${OverlayUi.formatClock(elapsed)}")
        .setContentText(getString(R.string.nf_take_notification_body, from, cap))
        .addAction(0, getString(R.string.nf_take_stop_send), serviceAction(ACTION_TAKE_STOP, 24))
        .addAction(0, getString(R.string.nf_take_cancel), serviceAction(ACTION_TAKE_CANCEL, 25))
    } else {
      b.setContentTitle(getString(R.string.nf_anywhere_title))
      when {
        ListenPrefs.notificationOn(this) -> {
          b.setContentText(getString(R.string.nf_anywhere_body))
            .addAction(0, getString(R.string.nf_anywhere_listen), listenAction())
            .addAction(0, getString(R.string.nf_anywhere_hide), serviceAction(ACTION_HIDE_NOTIFICATION, 26))
        }
        pendingTask -> b.setContentText(getString(R.string.nf_anywhere_sending))
        else -> b.setContentText(getString(R.string.nf_anywhere_button_on))
      }
    }
    openApp()?.let { b.setContentIntent(it) }
    return b.build()
  }

  companion object {
    const val ACTION_SYNC = "expo.modules.notefusionlisten.ANYWHERE_SYNC"
    const val ACTION_TAKE_START = "expo.modules.notefusionlisten.TAKE_START"
    const val ACTION_TAKE_STOP = "expo.modules.notefusionlisten.TAKE_STOP"
    const val ACTION_TAKE_CANCEL = "expo.modules.notefusionlisten.TAKE_CANCEL"
    const val ACTION_HIDE_NOTIFICATION = "expo.modules.notefusionlisten.HIDE_NOTIFICATION"
    const val ACTION_TAKE_DONE = "expo.modules.notefusionlisten.TAKE_DONE"
    const val EXTRA_SOURCE = "source"
    const val EXTRA_FROM = "from"
    const val EXTRA_VIA_ACTIVITY = "viaActivity"
    const val EXTRA_PROJECTION_CODE = "projectionCode"
    const val EXTRA_PROJECTION_DATA = "projectionData"
    /** Where a take is written before JS moves it into the send queue's own storage. */
    const val TAKE_DIR = "listen-takes"
    private const val CHANNEL_ID = "listen_anywhere"
    private const val NOTIFICATION_ID = 7202
    /** Under this a take is not sent: the pill was tapped by mistake. */
    private const val MIN_TAKE_SEC = 3.0
    private const val PENDING_TASK_MAX_MS = 10L * 60_000L

    @Volatile var instance: ListenOverlayService? = null
    /** Whoever asked for a take and waits to hear it started (the activity, so it can finish). */
    @Volatile var takeStartListener: ((Boolean, String?) -> Unit)? = null

    fun isListening(): Boolean = instance?.listening == true

    /** Starts or stops the service as the switches (and the overlay permission) say. */
    fun sync(context: Context) {
      val keep = (ListenPrefs.buttonOn(context) && ListenPrefs.overlayPermitted(context)) || ListenPrefs.notificationOn(context)
      if (keep) {
        runCatching {
          ContextCompat.startForegroundService(context, Intent(context, ListenOverlayService::class.java).setAction(ACTION_SYNC))
        }
      } else {
        instance?.let { if (!it.listening && !it.pendingTask) it.shutdown() }
      }
    }

    fun startTake(context: Context, source: String, from: String, viaActivity: Boolean, projectionCode: Int = 0, projectionData: Intent? = null) {
      val i = Intent(context, ListenOverlayService::class.java)
        .setAction(ACTION_TAKE_START)
        .putExtra(EXTRA_SOURCE, source)
        .putExtra(EXTRA_FROM, from)
        .putExtra(EXTRA_VIA_ACTIVITY, viaActivity)
        .putExtra(EXTRA_PROJECTION_CODE, projectionCode)
      if (projectionData != null) i.putExtra(EXTRA_PROJECTION_DATA, projectionData)
      ContextCompat.startForegroundService(context, i)
    }

    /** Direct, not a second startService: the tile's process is this one. */
    fun stopTake(send: Boolean): Boolean {
      val s = instance ?: return false
      if (!s.listening) return false
      s.main.post { s.finishTake(send) }
      return true
    }

    /** JS has queued (or given up on) the take: nothing keeps the process for it any more. */
    fun takeHandled(context: Context) {
      instance?.let { s ->
        s.main.post {
          s.pendingTaskTimeout?.let { s.main.removeCallbacks(it) }
          s.pendingTaskTimeout = null
          s.pendingTask = false
          s.applyState()
        }
      }
    }
  }
}
