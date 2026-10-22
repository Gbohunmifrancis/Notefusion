package expo.modules.notefusionlisten

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The Listen notice's Hide and its swipe-away. A receiver rather than the service: a broadcast to our own receiver is
 * always delivered, where starting a service from the background is not, and nothing needs to run for either.
 */
class ListenNoticeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      // Swiped away (or "Clear all"): gone until the app is next opened; the switch stays on.
      ACTION_DISMISSED -> {
        ListenPrefs.setNoticeDismissed(context, true)
        ListenPrefs.logEvent(context, "listen_notice_dismissed")
        ListenOverlayService.sync(context)
      }
      // Hide: the switch off, as Settings would turn it.
      ACTION_HIDE -> {
        ListenPrefs.setNotificationOn(context, false)
        ListenPrefs.logEvent(context, "listen_notice_hidden")
        context.getSystemService(NotificationManager::class.java)?.cancel(ListenNotice.ID)
        ListenOverlayService.sync(context)
      }
    }
  }

  companion object {
    const val ACTION_DISMISSED = "expo.modules.notefusionlisten.NOTICE_DISMISSED"
    const val ACTION_HIDE = "expo.modules.notefusionlisten.NOTICE_HIDE"
  }
}
