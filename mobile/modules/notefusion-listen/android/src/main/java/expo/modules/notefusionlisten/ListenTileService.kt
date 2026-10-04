package expo.modules.notefusionlisten

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * The Quick Settings tile. A tap opens the app at notefusion://listen; the Listen screen starts the
 * microphone service while it is in front, which is what lets a microphone foreground service start
 * on Android 14+ (a while-in-use permission cannot start one from the background).
 */
class ListenTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    val tile = qsTile ?: return
    tile.state = if (ShortcutState.isListening(this)) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.subtitle = ShortcutState.lastKey(this)?.let { getString(R.string.nf_tile_subtitle, it.second) }
    }
    tile.updateTile()
  }

  override fun onClick() {
    super.onClick()
    // Never open the app over the keyguard: unlock first.
    if (isLocked) unlockAndRun { open() } else open()
  }

  private fun open() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // API 34+ throws UnsupportedOperationException for the Intent overload.
      startActivityAndCollapse(ListenLink.pendingIntent(this, "tile", 1))
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(ListenLink.intent(this, "tile"))
    }
  }
}
