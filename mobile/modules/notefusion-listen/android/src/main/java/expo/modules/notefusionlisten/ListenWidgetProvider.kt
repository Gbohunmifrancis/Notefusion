package expo.modules.notefusionlisten

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews

/** Plain RemoteViews: no JS runtime is started to draw it, so it costs nothing while the app is closed. */
class ListenWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { manager.updateAppWidget(it, views(context)) }
  }

  companion object {
    fun views(context: Context): RemoteViews =
      RemoteViews(context.packageName, R.layout.nf_listen_widget).apply {
        val last = ShortcutState.lastKey(context)
        setTextViewText(
          R.id.nf_widget_last,
          if (last == null) context.getString(R.string.nf_widget_empty)
          else context.getString(R.string.nf_widget_last, last.second, last.first)
        )
        setOnClickPendingIntent(R.id.nf_widget_root, ListenLink.pendingIntent(context, "widget", 2))
      }

    /** Redraws every placed copy of the widget; a no-op when none is on the home screen. */
    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, ListenWidgetProvider::class.java))
      if (ids.isNotEmpty()) ids.forEach { manager.updateAppWidget(it, views(context)) }
    }
  }
}
