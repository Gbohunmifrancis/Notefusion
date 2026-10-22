package expo.modules.notefusionlisten

import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

/**
 * "Listen from anywhere" as the phone keeps it, with no JS running: the switches, the source, what the
 * account may still send (written by JS whenever the subscription is read), and where the floating
 * button was left. The tile, the notification and the overlay all read from here.
 */
internal object ListenPrefs {
  private const val PREFS = "notefusion_listen_anywhere"

  const val SOURCE_ROOM = "room"
  const val SOURCE_PHONE = "phone"

  /** What the account may still send; `known` false means the server has not answered yet (then nothing is refused here). */
  data class Allowance(
    val freeLeft: Int,
    val freePerWeek: Int,
    val boughtLeft: Int,
    val capSeconds: Int,
    /** "Friday 6pm", in the phone's own time, as lib/freeWeek says it. */
    val back: String,
    val isPro: Boolean,
    val known: Boolean,
  ) {
    val canSend: Boolean get() = !known || isPro || freeLeft > 0 || boughtLeft > 0

    companion object {
      /** The allowance before any subscription was read: the free week's shape, unknown, so a take is never refused on it. */
      val UNKNOWN = Allowance(3, 3, 0, 180, "Friday", isPro = false, known = false)
    }
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun buttonOn(context: Context) = prefs(context).getBoolean("button", false)
  fun notificationOn(context: Context) = prefs(context).getBoolean("notification", false)
  fun source(context: Context): String =
    prefs(context).getString("source", SOURCE_ROOM).let { if (it == SOURCE_PHONE && phoneSoundAvailable()) it else SOURCE_ROOM }
  fun signedIn(context: Context) = prefs(context).getBoolean("signedIn", false)
  fun dataSaver(context: Context) = prefs(context).getBoolean("dataSaver", false)
  fun tileAdded(context: Context) = prefs(context).getBoolean("tileAdded", false)

  fun setButtonOn(context: Context, on: Boolean) = prefs(context).edit().putBoolean("button", on).apply()
  fun setNotificationOn(context: Context, on: Boolean) = prefs(context).edit().putBoolean("notification", on).apply()
  fun setSource(context: Context, source: String) =
    prefs(context).edit().putString("source", if (source == SOURCE_PHONE) SOURCE_PHONE else SOURCE_ROOM).apply()
  fun setSignedIn(context: Context, signedIn: Boolean) = prefs(context).edit().putBoolean("signedIn", signedIn).apply()
  fun setDataSaver(context: Context, on: Boolean) = prefs(context).edit().putBoolean("dataSaver", on).apply()
  fun setTileAdded(context: Context, added: Boolean) = prefs(context).edit().putBoolean("tileAdded", added).apply()

  /** Playback capture (Android 10+): what "This phone's sound" records. */
  fun phoneSoundAvailable(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

  /** "Display over other apps", which only Android's own Settings page can grant. */
  fun overlayPermitted(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  fun allowance(context: Context): Allowance {
    val raw = prefs(context).getString("allowance", null) ?: return Allowance.UNKNOWN
    return runCatching {
      val o = JSONObject(raw)
      Allowance(
        freeLeft = o.optInt("freeLeft", 0),
        freePerWeek = o.optInt("freePerWeek", 3),
        boughtLeft = o.optInt("boughtLeft", 0),
        capSeconds = o.optInt("capSeconds", 180).coerceIn(10, 3600),
        back = o.optString("back", "Friday"),
        isPro = o.optBoolean("isPro", false),
        known = o.optBoolean("known", false),
      )
    }.getOrDefault(Allowance.UNKNOWN)
  }

  /** JS hands the allowance over as the JSON lib/listenAnywhere writes; null forgets it (sign-out). */
  fun setAllowance(context: Context, json: String?) =
    prefs(context).edit().apply { if (json == null) remove("allowance") else putString("allowance", json) }.apply()

  /** Where the floating button was left: which edge, and how far down the screen (0..1). */
  fun buttonPlace(context: Context): Pair<Boolean, Float> =
    prefs(context).getBoolean("buttonRight", true) to prefs(context).getFloat("buttonY", 0.42f)

  fun setButtonPlace(context: Context, right: Boolean, y: Float) =
    prefs(context).edit().putBoolean("buttonRight", right).putFloat("buttonY", y.coerceIn(0f, 1f)).apply()

  /** The Listen tile's state, readable while the app is dead. */
  fun setTakeListening(context: Context, listening: Boolean) = prefs(context).edit().putBoolean("takeListening", listening).apply()
  fun takeListening(context: Context) = prefs(context).getBoolean("takeListening", false)
  /** The take's clock, for the tile's line while the shade is open. */
  fun setTakeElapsed(context: Context, seconds: Int) = prefs(context).edit().putInt("takeElapsed", seconds).apply()
  fun takeElapsed(context: Context) = prefs(context).getInt("takeElapsed", 0)
}
