package expo.modules.notefusionlisten

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Listen from anywhere's notifications, in one place:
 *
 * - The **Listen notice** (Pro, its switch on): a plain notification with Listen and Hide, posted by nothing that keeps
 *   running. It can be swiped away like any other and stays away until the app is next opened; Hide turns it off. No
 *   service waits behind it, so it costs nothing while it sits there. When the floating button is on, the button's
 *   service carries the same notice as its own (the same id), since a service has to show one.
 * - The **take** (while listening, any way in): the service's notification, with a running clock the system ticks.
 * - **Reminders** while a take runs on (2:00, then a minute before the cap), heads-up with Stop & send and Cancel.
 * - A **closing note** when a take ended by itself (the cap, the music stopping, nothing heard).
 */
internal object ListenNotice {
  const val ID = 7202
  const val REMINDER_ID = 7203
  const val ENDED_ID = 7204

  /** The Listen notice and a take: quiet, in the shade. */
  const val CHANNEL_ANYWHERE = "listen_anywhere"
  /** The floating button's own keep-alive line when the notice is off: the least Android allows. */
  const val CHANNEL_BUTTON = "listen_button"
  /** "Still listening": the one that should be seen. */
  const val CHANNEL_REMINDERS = "listen_reminders"

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val m = context.getSystemService(NotificationManager::class.java) ?: return
    if (m.getNotificationChannel(CHANNEL_ANYWHERE) == null) {
      m.createNotificationChannel(
        NotificationChannel(CHANNEL_ANYWHERE, context.getString(R.string.nf_anywhere_channel), NotificationManager.IMPORTANCE_LOW).apply {
          description = context.getString(R.string.nf_anywhere_channel_description)
          setShowBadge(false)
        }
      )
    }
    if (m.getNotificationChannel(CHANNEL_BUTTON) == null) {
      m.createNotificationChannel(
        NotificationChannel(CHANNEL_BUTTON, context.getString(R.string.nf_button_channel), NotificationManager.IMPORTANCE_MIN).apply {
          description = context.getString(R.string.nf_button_channel_description)
          setShowBadge(false)
        }
      )
    }
    if (m.getNotificationChannel(CHANNEL_REMINDERS) == null) {
      m.createNotificationChannel(
        NotificationChannel(CHANNEL_REMINDERS, context.getString(R.string.nf_reminder_channel), NotificationManager.IMPORTANCE_HIGH).apply {
          description = context.getString(R.string.nf_reminder_channel_description)
          setShowBadge(false)
          setSound(null, null)
          enableVibration(true)
        }
      )
    }
  }

  private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  fun openApp(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, 23, launch, flags())
  }

  private fun receiver(context: Context, action: String, requestCode: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context, requestCode, Intent(context, ListenNoticeReceiver::class.java).setAction(action), flags()
    )

  /** Listen: the microphone straight from the notification (its own exemption). */
  fun listenAction(context: Context): PendingIntent {
    val src = ListenPrefs.source(context)
    val i = Intent(context, ListenOverlayService::class.java)
      .setAction(ListenOverlayService.ACTION_TAKE_START)
      .putExtra(ListenOverlayService.EXTRA_SOURCE, src)
      .putExtra(ListenOverlayService.EXTRA_FROM, "notification")
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) PendingIntent.getForegroundService(context, 22, i, flags())
    else PendingIntent.getService(context, 22, i, flags())
  }

  /** The Listen notice: swipeable, silent, with Listen and Hide. `ongoing` only when a service must show it. */
  fun listenNotice(context: Context, ongoing: Boolean): Notification {
    ensureChannels(context)
    return NotificationCompat.Builder(context, CHANNEL_ANYWHERE)
      .setSmallIcon(R.drawable.nf_mark)
      .setContentTitle(context.getString(R.string.nf_anywhere_title))
      .setContentText(context.getString(R.string.nf_anywhere_body))
      .setOngoing(ongoing)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(false)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .addAction(0, context.getString(R.string.nf_anywhere_listen), listenAction(context))
      .addAction(0, context.getString(R.string.nf_anywhere_hide), receiver(context, ListenNoticeReceiver.ACTION_HIDE, 26))
      .setDeleteIntent(receiver(context, ListenNoticeReceiver.ACTION_DISMISSED, 27))
      .apply { openApp(context)?.let { setContentIntent(it) } }
      .build()
  }

  /**
   * Posts or clears the Listen notice to match the switches, when no service is showing it. With the button's service
   * in the foreground the service owns the id, and its own notification carries the notice.
   */
  fun sync(context: Context) {
    if (ListenOverlayService.isForeground()) return
    val m = context.getSystemService(NotificationManager::class.java) ?: return
    if (ListenPrefs.noticeWanted(context)) runCatching { m.notify(ID, listenNotice(context, ongoing = false)) }
    else m.cancel(ID)
  }

  /** "Still listening": heads-up, with the take's own Stop & send and Cancel. */
  fun remind(context: Context, title: String, body: String, stop: PendingIntent, cancel: PendingIntent, timeoutMs: Long) {
    ensureChannels(context)
    val n = NotificationCompat.Builder(context, CHANNEL_REMINDERS)
      .setSmallIcon(R.drawable.nf_mark)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setTimeoutAfter(timeoutMs.coerceAtLeast(1_000L))
      .addAction(0, context.getString(R.string.nf_take_stop_send), stop)
      .addAction(0, context.getString(R.string.nf_take_cancel), cancel)
      .apply { openApp(context)?.let { setContentIntent(it) } }
      .build()
    runCatching { context.getSystemService(NotificationManager::class.java)?.notify(REMINDER_ID, n) }
  }

  fun clearReminder(context: Context) {
    context.getSystemService(NotificationManager::class.java)?.cancel(REMINDER_ID)
  }

  /** How a take that ended by itself ended: in the shade, quietly, for someone who has moved on. */
  fun ended(context: Context, title: String, body: String) {
    ensureChannels(context)
    val n = NotificationCompat.Builder(context, CHANNEL_ANYWHERE)
      .setSmallIcon(R.drawable.nf_mark)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setSilent(true)
      .setTimeoutAfter(6L * 60 * 60 * 1000)
      .apply { openApp(context)?.let { setContentIntent(it) } }
      .build()
    runCatching { context.getSystemService(NotificationManager::class.java)?.notify(ENDED_ID, n) }
  }
}
