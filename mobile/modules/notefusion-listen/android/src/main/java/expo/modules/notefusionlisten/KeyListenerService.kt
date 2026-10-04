package expo.modules.notefusionlisten

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * The microphone foreground service behind "Find the key".
 *
 * It owns one `AudioRecord` (16 kHz mono float) on a capture thread and hands ~250 ms chunks to the
 * module, which forwards them to JS — the key itself is worked out in TypeScript so the solfa engine
 * stays in one place. It never asks for audio focus, so Spotify or YouTube keep playing out loud, which
 * is the whole point. The ongoing notification is what the system requires of a microphone service;
 * JS rewrites its text ("Doh is G · G major") as the key settles.
 *
 * Android 14+ only lets a microphone service start while the app has a visible activity, and refuses
 * with ForegroundServiceStartNotAllowedException / SecurityException otherwise — that is caught here
 * and reported to JS as a plain error code rather than a crash.
 */
class KeyListenerService : Service() {
  interface Listener {
    fun onBuffer(samples: FloatArray, sampleRate: Int)
    /** `running` flips with capture; `reason` says why ("started", "stopped", "silenced", "unsilenced", "error"). */
    fun onStatus(running: Boolean, reason: String, code: String? = null, message: String? = null)
  }

  private var record: AudioRecord? = null
  private var thread: Thread? = null
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var capturing = false
  private var recordingCallback: AudioManager.AudioRecordingCallback? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      shutdown("notification")
      return START_NOT_STICKY
    }

    ensureChannel()
    // Promoted before anything else: the system gives a started service a few seconds to call this.
    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(title, body),
        // The microphone type constant arrived in API 30; before that the manifest type alone applies.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
      )
    } catch (e: Exception) {
      // Android 14+: SecurityException when the app is not on screen or the microphone permission is
      // missing; ForegroundServiceStartNotAllowedException (an IllegalStateException, API 31+) when
      // the system refuses the start outright. Both are the same "not now" to JS. Reported, never thrown.
      val notAllowed = e is SecurityException ||
        (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && e is android.app.ForegroundServiceStartNotAllowedException)
      listener?.onStatus(false, "error", if (notAllowed) "E_NOT_ALLOWED" else "E_START_FAILED", e.message)
      stopSelf()
      return START_NOT_STICKY
    }

    if (!capturing) startCapture()
    return START_NOT_STICKY
  }

  private fun startCapture() {
    val minBytes = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val chunk = SAMPLE_RATE / 4 // 250 ms
    val recorder = try {
      AudioRecord(
        MediaRecorder.AudioSource.MIC,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_FLOAT,
        maxOf(minBytes, chunk * 4 * 4)
      )
    } catch (e: Exception) {
      fail("E_MIC_UNAVAILABLE", e.message)
      return
    }
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      fail("E_MIC_UNAVAILABLE", "AudioRecord did not initialise")
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // Another app (a call, a voice assistant) taking the mic shows up here as our client being silenced.
      val callback = object : AudioManager.AudioRecordingCallback() {
        override fun onRecordingConfigChanged(configs: MutableList<android.media.AudioRecordingConfiguration>?) {
          val mine = configs?.firstOrNull { it.clientAudioSessionId == recorder.audioSessionId } ?: return
          listener?.onStatus(true, if (mine.isClientSilenced) "silenced" else "unsilenced")
        }
      }
      recorder.registerAudioRecordingCallback(ContextCompat.getMainExecutor(this), callback)
      recordingCallback = callback
    }

    try {
      recorder.startRecording()
    } catch (e: Exception) {
      discard(recorder)
      fail("E_MIC_UNAVAILABLE", e.message)
      return
    }
    if (recorder.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      discard(recorder)
      fail("E_MIC_UNAVAILABLE", "The microphone did not start")
      return
    }

    record = recorder
    capturing = true
    ShortcutState.setListening(this, true)
    listener?.onStatus(true, "started")

    thread = Thread({
      val buf = FloatArray(chunk)
      var broken = false
      while (capturing) {
        val n = recorder.read(buf, 0, chunk, AudioRecord.READ_BLOCKING)
        if (n > 0) listener?.onBuffer(if (n == chunk) buf.copyOf() else buf.copyOf(n), SAMPLE_RATE)
        else if (n < 0) {
          // ERROR_* — the mic went away under us. A stop() from shutdown() also ends the read, but
          // then `capturing` is already false and nothing is reported twice.
          broken = capturing
          break
        }
      }
      if (broken) {
        // Off this thread: shutdown() waits for it to finish.
        main.post { if (capturing) shutdown("error", "E_MIC_UNAVAILABLE", "The microphone stopped") }
      }
    }, "nf-key-listener").apply { start() }
  }

  /** Releases a recorder that never got going, with the callback it may already carry. */
  private fun discard(recorder: AudioRecord) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) recordingCallback?.let { runCatching { recorder.unregisterAudioRecordingCallback(it) } }
    recordingCallback = null
    recorder.release()
  }

  private fun fail(code: String, message: String?) {
    listener?.onStatus(false, "error", code, message)
    stopSelf()
  }

  /**
   * Stops capture, drops the notification and ends the service. Reached from the module (JS stop,
   * JS gone), the notification's Stop action, onTaskRemoved and the capture thread's own failure, so
   * it is synchronised and waits for the capture thread to leave its last read before the recorder
   * is released — reading a released AudioRecord is a native use-after-free.
   */
  @Synchronized
  fun shutdown(reason: String, code: String? = null, message: String? = null) {
    val wasCapturing = capturing
    capturing = false
    record?.let { r ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) recordingCallback?.let { runCatching { r.unregisterAudioRecordingCallback(it) } }
      runCatching { r.stop() } // unblocks the read
      thread?.takeIf { it !== Thread.currentThread() }?.let { runCatching { it.join(1_000) } }
      r.release()
    }
    record = null
    recordingCallback = null
    thread = null
    ShortcutState.setListening(this, false)
    if (wasCapturing) listener?.onStatus(false, reason, code, message)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  /** The user swiped the app away: no JS is left to read the buffers, so stop rather than listen for nothing. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    shutdown("stopped")
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    if (capturing) shutdown("stopped")
    if (instance === this) instance = null
    super.onDestroy()
  }

  // ── Notification ────────────────────────────────────────────────────────────

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, getString(R.string.nf_listen_channel), NotificationManager.IMPORTANCE_LOW).apply {
        description = getString(R.string.nf_listen_channel_description)
        setShowBadge(false)
      }
    )
  }

  private fun buildNotification(title: String, body: String) =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.nf_tile_icon)
      .setContentTitle(title)
      .setContentText(body)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(ListenLink.pendingIntent(this, "notification", 3))
      .addAction(
        0,
        getString(R.string.nf_listen_stop),
        PendingIntent.getService(
          this,
          4,
          Intent(this, KeyListenerService::class.java).setAction(ACTION_STOP),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
      .build()

  /** Rewrites the ongoing notification in place (same id, alert once), e.g. "Doh is G · G major". */
  fun updateNotification(newTitle: String, newBody: String) {
    title = newTitle
    body = newBody
    if (!capturing) return
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(newTitle, newBody))
  }

  companion object {
    const val ACTION_STOP = "expo.modules.notefusionlisten.STOP"
    const val SAMPLE_RATE = 16000
    private const val CHANNEL_ID = "key_listener"
    private const val NOTIFICATION_ID = 7201

    /** Set by the module while JS is alive; the service talks to nobody else. */
    @Volatile var listener: Listener? = null
    @Volatile private var instance: KeyListenerService? = null

    private var title = "Listening for the key…"
    private var body = "Play the music out loud"

    fun isRunning(): Boolean = instance?.capturing == true

    fun start(context: Context) {
      title = context.getString(R.string.nf_listen_title)
      body = context.getString(R.string.nf_listen_body)
      ContextCompat.startForegroundService(context, Intent(context, KeyListenerService::class.java))
    }

    /** Direct call rather than a second startService: a background app may not start services. */
    fun stop(): Boolean {
      val s = instance ?: return false
      s.shutdown("stopped")
      return true
    }

    fun update(title: String, body: String) {
      instance?.updateNotification(title, body)
    }
  }
}
