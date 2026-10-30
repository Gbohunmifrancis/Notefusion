package expo.modules.notefusionlisten

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * A translucent activity that is in front for the moment a take starts, then finishes: what the Listen
 * tile opens (an app has to be in front to start the microphone on Android 14+, and a tile tap is not in
 * front), and the floating button's fallback when Android refuses the direct start.
 *
 * Its own task, out of Recents, no animation: the app behind it stays where it was.
 */
class ListenTakeActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())
  private var from = "tile"
  private var finished = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    @Suppress("DEPRECATION")
    overridePendingTransition(0, 0)
    from = intent.getStringExtra(ListenOverlayService.EXTRA_FROM) ?: "tile"
    if (ListenOverlayService.isListening()) {
      // The tile tapped again: stop and send.
      ListenOverlayService.stopTake(send = true)
      done()
      return
    }
    start()
  }

  private fun start() {
    ListenOverlayService.takeStartListener = { _, _ -> main.post { done() } }
    main.postDelayed({ done() }, START_WAIT_MS)
    runCatching { ListenOverlayService.startTake(this, ListenPrefs.SOURCE_ROOM, from, viaActivity = true) }
      .onFailure { done() }
  }

  private fun done() {
    if (finished) return
    finished = true
    if (ListenOverlayService.takeStartListener != null) ListenOverlayService.takeStartListener = null
    finish()
    @Suppress("DEPRECATION")
    overridePendingTransition(0, 0)
  }

  companion object {
    /** The service says it started within a few hundred ms; this is the ceiling before the activity leaves anyway. */
    private const val START_WAIT_MS = 4_000L

    fun intent(context: Context, source: String, from: String): Intent =
      Intent(context, ListenTakeActivity::class.java)
        .putExtra(ListenOverlayService.EXTRA_SOURCE, source)
        .putExtra(ListenOverlayService.EXTRA_FROM, from)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)

    fun pendingIntent(context: Context, source: String, from: String, requestCode: Int): PendingIntent =
      PendingIntent.getActivity(context, requestCode, intent(context, source, from), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
