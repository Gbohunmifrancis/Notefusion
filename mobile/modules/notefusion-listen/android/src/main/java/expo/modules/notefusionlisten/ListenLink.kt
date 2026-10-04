package expo.modules.notefusionlisten

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/** The one URL every shortcut opens. The app's `scheme` in app.json is "notefusion". */
internal object ListenLink {
  fun intent(context: Context, source: String): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse("notefusion://listen?src=$source&ts=${System.currentTimeMillis()}"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

  fun pendingIntent(context: Context, source: String, requestCode: Int): PendingIntent =
    PendingIntent.getActivity(
      context,
      requestCode,
      intent(context, source),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
}
