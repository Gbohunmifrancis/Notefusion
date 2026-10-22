package expo.modules.notefusionlisten

import android.Manifest
import android.app.Notification
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
 * "Listen from anywhere" (boards r-listen R1–R3): the foreground service behind the floating button and every take. It
 * draws the button over other apps (`OverlayUi`), records a take when asked (`TakeRecorder`) and hands the finished file
 * to the app's send queue through a headless JS task (`ListenTakeHeadlessService` → lib/listenAnywhereBridge →
 * lib/outbox), so a take from here is sent exactly as one from the Record screen.
 *
 * It runs only while there is something to do: the floating button on screen (Pro), a take, or a take on its way to
 * JS. The Listen notification on its own runs nothing (`ListenNotice`); a tap on its Listen starts this service for the
 * take, and it stops again when the take is handed over. Its foreground type is `specialUse` while it only holds the
 * button, with `microphone` or `mediaProjection` added for a take. Nothing ticks while it waits: no timers, no wake
 * locks, no polling. During a take the clock in the notification is the system's own chronometer, and the tile and the
 * stored clock are touched every five seconds rather than every second.
 *
 * A take that runs on is looked after: a reminder at 2:00 and a minute before the cap (heads-up, with Stop & send and
 * Cancel); a first minute with nothing heard ends it unsent; the music stopping for 45 seconds after it was heard ends it
 * sent; the cap ends it sent; and a take with almost nothing heard is never sent at all.
 *
 * Starting the microphone with the app not in front is what Android 14+ restricts. Three ways in, each one the system
 * allows: the notification's Listen action (a notification's own PendingIntent), the floating button (the app holds
 * "Display over other apps" and the button is on screen), and the tile, which passes through `ListenTakeActivity`, a
 * translucent activity in front for the moment the recording starts — and where "This phone's sound" asks Android's
 * consent, which only an activity can. If the direct start is refused all the same, the button's tap goes through that
 * activity too.
 */
class ListenOverlayService : Service(), OverlayUi.Host, TakeRecorder.Listener {
  /** Why a take ended, as the console counts it. */
  private enum class End(val code: String, val send: Boolean) {
    STOP("stop", true),
    CAP("cap", true),
    MUSIC_STOPPED("music_stopped", true),
    PROJECTION_ENDED("projection_ended", true),
    NOTHING_HEARD("nothing_heard", false),
    CANCEL("cancel", false),
    FAILED("failed", false),
    KILLED("killed", false),
  }

  private val main = Handler(Looper.getMainLooper())
  private var overlay: OverlayUi? = null
  private var recorder: TakeRecorder? = null
  private var projection: MediaProjection? = null
  private var projectionCallback: MediaProjection.Callback? = null
  @Volatile private var listening = false
  @Volatile private var foreground = false
  private var elapsed = 0
  private var takeStartedAt = 0L
  private var remindersShown = 0
  private var source = ListenPrefs.SOURCE_ROOM
  private var from = "bubble"
  private var viaActivity = false
  private var takeFile: File? = null
  /** A take is on its way through JS: the process is kept in the foreground until it says so (or 10 min). */
  private var pendingTask = false
  private var pendingTaskTimeout: Runnable? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    ListenNotice.ensureChannels(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_TAKE_START -> beginTake(intent)
      ACTION_TAKE_STOP -> finishTake(End.STOP, intent.getStringExtra(EXTRA_VIA))
      ACTION_TAKE_CANCEL -> finishTake(End.CANCEL, intent.getStringExtra(EXTRA_VIA))
      ACTION_CYCLE_KIND -> cycleKind(intent.getStringExtra(EXTRA_VIA) ?: "notification")
      ACTION_TAKE_DONE -> {
        pendingTask = false
        applyState()
      }
      else -> applyState()
    }
    // Restarted after Android reclaims it only when there was a button to bring back; a take is never resumed.
    return if (ListenPrefs.buttonWanted(this)) START_STICKY else START_NOT_STICKY
  }

  /** What keeps the service: the button on screen, a take, or one being handed to JS. The notice alone keeps nothing. */
  private fun kept(): Boolean = ListenPrefs.buttonWanted(this) || listening || pendingTask

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
    if (ListenPrefs.buttonWanted(this)) {
      val ui = overlay ?: OverlayUi(this, this).also { overlay = it }
      if (!ui.shown) ui.show()
      ui.setKind(ListenPrefs.kindLabel(this, ListenPrefs.kind(this)))
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
      ServiceCompat.startForeground(this, ListenNotice.ID, buildNotification(), foregroundTypes())
      foreground = true
      true
    } catch (e: Exception) {
      false
    }

  private fun shutdown() {
    overlay?.hide()
    overlay = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    foreground = false
    stopSelf()
    // The service no longer holds the notification's id: the Listen notice (if it is on) takes it back, swipeable.
    ListenNotice.sync(this)
  }

  override fun onDestroy() {
    if (listening) finishTake(End.KILLED, null)
    overlay?.hide()
    overlay = null
    foreground = false
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
      refuse("signed_out", getString(R.string.nf_take_signed_out))
      return
    }
    // The button and the notice are Pro's; one left over from a membership that has since ended says so.
    if (from != "tile" && !ListenPrefs.proActive(this)) {
      refuse("not_pro", getString(R.string.nf_take_pro_only))
      return
    }
    val allowance = ListenPrefs.allowance(this)
    if (!allowance.canSend) {
      noneLeft(allowance)
      logRefused("none_left")
      settleStart(false, "E_NONE_LEFT")
      applyState()
      return
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      refuse("no_mic", getString(R.string.nf_take_no_mic))
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
    remindersShown = 0
    takeStartedAt = System.currentTimeMillis()
    if (!enterForeground()) {
      listening = false
      enterForeground()
      if (!viaActivity && source == ListenPrefs.SOURCE_ROOM) {
        // The microphone refused from here (the app is not in front): once through the activity, which is.
        settleStart(true, null)
        launchActivity()
        return
      }
      refuse("not_allowed", getString(R.string.nf_take_not_allowed))
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
          refuse("not_allowed", getString(R.string.nf_take_not_allowed))
          return
        }
        ListenPrefs.logEvent(this, "listen_capture_blocked", mapOf("from" to from))
        say(getString(R.string.nf_take_capture_blocked), OverlayUi.Card.PROBLEM, 6_000)
      } else {
        val cb = object : MediaProjection.Callback() {
          override fun onStop() {
            // The system (or the user, from the status bar) ended the projection: the take ends with it.
            main.post { if (listening && projection != null) finishTake(End.PROJECTION_ENDED, "system") }
          }
        }
        runCatching { p.registerCallback(cb, main) }
        projection = p
        projectionCallback = cb
      }
    }

    if (!startRecorder(allowance)) {
      logRefused("mic_unavailable")
      settleStart(false, "E_MIC_UNAVAILABLE")
      return
    }
    ListenPrefs.logEvent(
      this, "listen_take_start",
      mapOf("from" to from, "source" to source, "kind" to ListenPrefs.kind(this), "pro" to if (allowance.isPro) 1 else 0),
    )
    settleStart(true, null)
  }

  /** A take that cannot start: said, counted, and the service left as it should be. */
  private fun refuse(reason: String, text: String) {
    say(text, OverlayUi.Card.PROBLEM, 6_000)
    logRefused(reason)
    settleStart(false, "E_${reason.uppercase()}")
    applyState()
  }

  private fun logRefused(reason: String) =
    ListenPrefs.logEvent(this, "listen_take_refused", mapOf("from" to from, "reason" to reason))

  private fun startRecorder(allowance: ListenPrefs.Allowance): Boolean {
    val file = File(File(cacheDir, TAKE_DIR), "take-${System.currentTimeMillis()}.m4a")
    val bitRate = if (ListenPrefs.dataSaver(this)) 32_000 else 128_000
    val r = TakeRecorder(this, source, projection, file, bitRate, allowance.capSeconds, this)
    if (!r.start()) {
      listening = false
      releaseProjection()
      applyState()
      return false
    }
    recorder = r
    takeFile = file
    ListenPrefs.setTakeListening(this, true)
    ListenPrefs.setTakeElapsed(this, 0)
    requestTileState()
    overlay?.setKind(ListenPrefs.kindLabel(this, ListenPrefs.kind(this)))
    overlay?.setListening(true, line(allowance))
    // The take's notification (with its chronometer) is posted once here, not every second.
    enterForeground()
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

  private fun finishTake(end: End, via: String?) {
    val r = recorder ?: return
    recorder = null
    val result = r.stop()
    releaseProjection()
    listening = false
    ListenNotice.clearReminder(this)
    ListenPrefs.setTakeListening(this, false)
    requestTileState()
    overlay?.setListening(false, "")
    val file = takeFile
    takeFile = null
    val cap = OverlayUi.formatClock(ListenPrefs.allowance(this).capSeconds)
    val took = OverlayUi.formatClock(result.durationSec.toInt())
    val heardEnough = result.heardSec >= TakeRecorder.MIN_HEARD_SEC

    // Whether it goes, and why not when it does not.
    val outcome = when {
      !end.send || file == null -> end.code
      !result.ok || result.durationSec < MIN_TAKE_SEC -> "too_short"
      !heardEnough -> "silent"
      else -> null
    }
    val auto = end == End.CAP || end == End.MUSIC_STOPPED || end == End.NOTHING_HEARD
    // What it is sent as: the choice as it stands when the take ends (the chip may have been tapped meanwhile).
    val kind = ListenPrefs.kind(this)
    ListenPrefs.logEvent(
      this, "listen_take_end",
      mapOf(
        "from" to from, "source" to source, "kind" to kind, "reason" to end.code, "via" to via,
        "sec" to result.durationSec.toInt(), "heard" to result.heardSec.toInt(),
        "sent" to if (outcome == null) 1 else 0, "unsent" to outcome, "reminders" to remindersShown,
      ),
    )

    if (outcome != null) {
      file?.delete()
      when (outcome) {
        "too_short" -> say(getString(R.string.nf_take_too_short), OverlayUi.Card.PROBLEM, 6_000)
        "silent", "nothing_heard" -> {
          val text = getString(R.string.nf_take_nothing_heard)
          say(text, OverlayUi.Card.PROBLEM, 6_000)
          if (auto) ListenNotice.ended(this, getString(R.string.nf_ended_title), text)
        }
      }
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
    // The choice rides in the file's name too, so a take the app sweeps in later is sent as what it was.
    val named = File(file!!.parentFile, "${file.nameWithoutExtension}-$kind.m4a").takeIf { file.renameTo(it) } ?: file
    val handed = startHeadless(named, result.durationSec, kind)
    val text = when {
      !handed -> getString(R.string.nf_take_kept)
      end == End.CAP -> getString(R.string.nf_take_cap_sent, cap)
      end == End.MUSIC_STOPPED -> getString(R.string.nf_take_music_stopped_sent, took)
      online() -> getString(R.string.nf_take_sent)
      else -> getString(R.string.nf_take_kept)
    }
    say(text, OverlayUi.Card.SENT, 4_000)
    // Someone who forgot the take has moved on: the shade tells them what happened to it.
    if (auto) ListenNotice.ended(this, getString(R.string.nf_ended_title), text)
  }

  /** Hands the file to JS (lib/listenAnywhereBridge). A file still in the take folder later is one JS never got: the app sweeps it in. */
  private fun startHeadless(file: File, durationSec: Double, kind: String): Boolean {
    val i = Intent(this, ListenTakeHeadlessService::class.java)
      .putExtra("uri", Uri.fromFile(file).toString())
      .putExtra("fileName", file.name)
      .putExtra("durationSec", durationSec)
      .putExtra("source", source)
      .putExtra("from", from)
      .putExtra("kind", kind)
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

  // ── Listen for ────────────────────────────────────────────────────────────

  /** The next of Singing, Instrument, Chords: kept for later takes too, and shown wherever the take is. */
  private fun cycleKind(via: String) {
    val next = ListenPrefs.nextKind(ListenPrefs.kind(this))
    ListenPrefs.setKind(this, next)
    overlay?.setKind(ListenPrefs.kindLabel(this, next))
    if (listening) enterForeground()
    requestTileState()
    ListenPrefs.logEvent(this, "listen_kind", mapOf("to" to next, "via" to via, "during" to if (listening) "take" else "idle"))
  }

  // ── A take that runs on ───────────────────────────────────────────────────

  /** "Still listening" at 2:00, and "a minute left" a minute before the cap when that is later still. */
  private fun maybeRemind(seconds: Int) {
    val capSec = ListenPrefs.allowance(this).capSeconds
    val lastMinute = capSec - 60
    val due = when {
      remindersShown == 0 && seconds >= FIRST_REMINDER_SEC && capSec > FIRST_REMINDER_SEC -> true
      remindersShown == 1 && lastMinute > FIRST_REMINDER_SEC + 30 && seconds >= lastMinute -> true
      else -> false
    }
    if (!due) return
    remindersShown += 1
    val cap = OverlayUi.formatClock(capSec)
    val title = if (seconds >= lastMinute && remindersShown > 1) getString(R.string.nf_reminder_last_minute)
    else getString(R.string.nf_reminder_title, OverlayUi.formatClock(seconds))
    ListenNotice.remind(
      this, title, getString(R.string.nf_reminder_body, cap),
      takeAction(ACTION_TAKE_STOP, "reminder", 28), takeAction(ACTION_TAKE_CANCEL, "reminder", 29),
      timeoutMs = (capSec - seconds) * 1000L,
    )
    ListenPrefs.logEvent(this, "listen_reminder", mapOf("from" to from, "at" to seconds))
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
    finishTake(End.STOP, "bubble")
  }

  override fun onHidden() {
    ListenPrefs.setButtonOn(this, false)
    ListenPrefs.logEvent(this, "listen_button_hidden")
    Toast.makeText(this, getString(R.string.nf_bubble_hidden), Toast.LENGTH_LONG).show()
    applyState()
  }

  override fun onKind() {
    cycleKind("bubble")
  }

  override fun onBuySong() {
    ListenPrefs.logEvent(this, "listen_buy_song")
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
    // The notification's clock is the system's chronometer; the tile's line and the stored clock are enough every 5 s.
    if (seconds % 5 == 0) {
      ListenPrefs.setTakeElapsed(this, seconds)
      requestTileState()
    }
    maybeRemind(seconds)
  }

  override fun onCapReached() {
    finishTake(End.CAP, "cap")
  }

  override fun onQuiet(nothingHeard: Boolean) {
    if (!listening) return
    finishTake(if (nothingHeard) End.NOTHING_HEARD else End.MUSIC_STOPPED, "quiet")
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
    ListenPrefs.logEvent(this, "listen_capture_blocked", mapOf("from" to from))
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
    if (listening) finishTake(End.FAILED, code)
    say(getString(R.string.nf_take_failed), OverlayUi.Card.PROBLEM, 6_000)
  }

  // ── Notification ──────────────────────────────────────────────────────────

  private fun pendingFlags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  /** Stop & send / Cancel, saying where they were pressed (the take's own notification, or the reminder). */
  private fun takeAction(action: String, via: String, requestCode: Int): PendingIntent {
    val i = Intent(this, ListenOverlayService::class.java).setAction(action).putExtra(EXTRA_VIA, via)
    return PendingIntent.getService(this, requestCode, i, pendingFlags())
  }

  /**
   * The service's notification. A take: its source, its cap and a clock the system runs (no update every second).
   * Waiting with the button on: the Listen notice when that is on, so there is only ever one; otherwise a single quiet
   * line on the least important channel, which Android collapses out of the way.
   */
  private fun buildNotification(): Notification {
    if (!listening && !pendingTask && ListenPrefs.noticeWanted(this)) return ListenNotice.listenNotice(this, ongoing = true)

    val channel = if (listening) ListenNotice.CHANNEL_ANYWHERE else ListenNotice.CHANNEL_BUTTON
    val b = NotificationCompat.Builder(this, channel)
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
      b.setContentTitle(getString(R.string.nf_bubble_listening))
        .setContentText(getString(R.string.nf_take_notification_body, from, cap))
        .setWhen(takeStartedAt)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .addAction(0, getString(R.string.nf_take_stop_send), takeAction(ACTION_TAKE_STOP, "notification", 24))
        .addAction(0, getString(R.string.nf_take_cancel), takeAction(ACTION_TAKE_CANCEL, "notification", 25))
        .addAction(
          0,
          getString(R.string.nf_kind_action, ListenPrefs.kindLabel(this, ListenPrefs.kind(this))),
          takeAction(ACTION_CYCLE_KIND, "notification", 30),
        )
    } else {
      b.setContentTitle(getString(R.string.nf_anywhere_title))
        .setShowWhen(false)
        .setContentText(getString(if (pendingTask) R.string.nf_anywhere_sending else R.string.nf_anywhere_button_on))
        .setPriority(NotificationCompat.PRIORITY_MIN)
    }
    ListenNotice.openApp(this)?.let { b.setContentIntent(it) }
    return b.build()
  }

  companion object {
    const val ACTION_SYNC = "expo.modules.notefusionlisten.ANYWHERE_SYNC"
    const val ACTION_TAKE_START = "expo.modules.notefusionlisten.TAKE_START"
    const val ACTION_TAKE_STOP = "expo.modules.notefusionlisten.TAKE_STOP"
    const val ACTION_TAKE_CANCEL = "expo.modules.notefusionlisten.TAKE_CANCEL"
    const val ACTION_TAKE_DONE = "expo.modules.notefusionlisten.TAKE_DONE"
    const val ACTION_CYCLE_KIND = "expo.modules.notefusionlisten.CYCLE_KIND"
    const val EXTRA_SOURCE = "source"
    const val EXTRA_FROM = "from"
    const val EXTRA_VIA = "via"
    const val EXTRA_VIA_ACTIVITY = "viaActivity"
    const val EXTRA_PROJECTION_CODE = "projectionCode"
    const val EXTRA_PROJECTION_DATA = "projectionData"
    /** Where a take is written before JS moves it into the send queue's own storage. */
    const val TAKE_DIR = "listen-takes"
    /** Under this a take is not sent: the pill was tapped by mistake. */
    private const val MIN_TAKE_SEC = 3.0
    private const val PENDING_TASK_MAX_MS = 10L * 60_000L
    /** "Still listening" this far into a take. */
    private const val FIRST_REMINDER_SEC = 120

    @Volatile var instance: ListenOverlayService? = null
    /** Whoever asked for a take and waits to hear it started (the activity, so it can finish). */
    @Volatile var takeStartListener: ((Boolean, String?) -> Unit)? = null

    fun isListening(): Boolean = instance?.listening == true

    /** The service holds the notification's id (and shows its own notification). */
    fun isForeground(): Boolean = instance?.foreground == true

    /**
     * Brings everything in line with the switches, the overlay permission and the account: the button's service started
     * or stopped, and the Listen notice posted or cleared. Cheap; called whenever any of those may have changed.
     */
    fun sync(context: Context) {
      if (ListenPrefs.buttonWanted(context)) {
        runCatching {
          ContextCompat.startForegroundService(context, Intent(context, ListenOverlayService::class.java).setAction(ACTION_SYNC))
        }
        return
      }
      val s = instance
      if (s != null && !s.listening && !s.pendingTask) s.main.post { s.shutdown() }
      else if (s != null) s.main.post { if (s.foreground) s.enterForeground() }
      ListenNotice.sync(context)
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
      s.main.post { s.finishTake(if (send) End.STOP else End.CANCEL, "tile") }
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
