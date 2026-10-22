package expo.modules.notefusionlisten

import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * The Listen tile (board R2/3), beside Find the key: a tap starts a take through `ListenTakeActivity`
 * (in front for the moment the microphone starts); tapped again while listening it stops and sends,
 * and the shade stays open. Its line says what it will hear, or the clock while it listens.
 */
class ListenTakeTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    val tile = qsTile ?: return
    val listening = ListenPrefs.takeListening(this)
    tile.state = if (listening) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    tile.label = getString(R.string.nf_take_tile_label)
    tile.icon = Icon.createWithResource(this, R.drawable.nf_mark)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.subtitle = when {
        listening -> "${getString(R.string.nf_bubble_listening)} · ${OverlayUi.formatClock(ListenPrefs.takeElapsed(this))}"
        else -> "${ListenPrefs.kindLabel(this, ListenPrefs.kind(this))} · ${
          getString(if (ListenPrefs.source(this) == ListenPrefs.SOURCE_PHONE) R.string.nf_source_phone else R.string.nf_source_room)
        }"
      }
    }
    tile.updateTile()
  }

  override fun onClick() {
    super.onClick()
    if (ListenOverlayService.stopTake(send = true)) return
    // Never start a take over the keyguard: unlock first.
    if (isLocked) unlockAndRun { open() } else open()
  }

  private fun open() {
    val source = ListenPrefs.source(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startActivityAndCollapse(ListenTakeActivity.pendingIntent(this, source, "tile", 31))
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(ListenTakeActivity.intent(this, source, "tile"))
    }
  }
}
