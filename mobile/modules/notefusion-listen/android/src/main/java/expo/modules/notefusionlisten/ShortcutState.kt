package expo.modules.notefusionlisten

import android.content.ComponentName
import android.content.Context
import android.service.quicksettings.TileService

/** Survives the app being killed: the tile and widget read it with no JS running. */
internal object ShortcutState {
  private const val PREFS = "notefusion_listen"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setListening(context: Context, listening: Boolean) {
    prefs(context).edit().putBoolean("listening", listening).apply()
    // The tile redraws itself in onStartListening; this asks the system to call it now.
    runCatching {
      TileService.requestListeningState(context, ComponentName(context, ListenTileService::class.java))
    }
  }

  fun isListening(context: Context) = prefs(context).getBoolean("listening", false)

  fun setLastKey(context: Context, key: String, doh: String) =
    prefs(context).edit().putString("key", key).putString("doh", doh).apply()

  /** (key, doh), e.g. ("G major", "G"); null until a key has been found. */
  fun lastKey(context: Context): Pair<String, String>? {
    val p = prefs(context)
    val key = p.getString("key", null) ?: return null
    return key to (p.getString("doh", null) ?: "")
  }
}
