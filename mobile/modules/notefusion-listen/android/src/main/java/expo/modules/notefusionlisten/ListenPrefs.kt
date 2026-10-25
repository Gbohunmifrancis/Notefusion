package expo.modules.notefusionlisten

import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
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
  /**
   * The microphone, always, as Shazam listens: "This phone's sound" asked Android's screen-sharing consent at every take,
   * ended whenever the sharing did, and recorded silence from apps that block capture. A stored "phone" from an older
   * version is read as the room.
   */
  @Suppress("UNUSED_PARAMETER")
  fun source(context: Context): String = SOURCE_ROOM
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

  /**
   * The floating button and the Listen notification are Pro's (a member, or a singer in a running choir), and only once
   * the server has said so: a fresh install, a lapsed membership or a signed-out phone shows neither. The switches keep
   * their place, so a member who renews finds them as they left them. The Listen tile is everyone's.
   */
  fun proActive(context: Context): Boolean = allowance(context).let { it.known && it.isPro }

  /** The floating button is drawn: switched on, allowed by Android, and the account is Pro. */
  fun buttonWanted(context: Context): Boolean = buttonOn(context) && overlayPermitted(context) && proActive(context)

  /** The Listen notification is shown: switched on, the account is Pro, and not swiped away since the app was last opened. */
  fun noticeWanted(context: Context): Boolean = notificationOn(context) && proActive(context) && !noticeDismissed(context)

  /** Swiped away (or cleared with the rest): it stays away until the app is next opened, and its switch stays on. */
  fun noticeDismissed(context: Context) = prefs(context).getBoolean("noticeDismissed", false)
  fun setNoticeDismissed(context: Context, dismissed: Boolean) = prefs(context).edit().putBoolean("noticeDismissed", dismissed).apply()

  // ── Events (for the admin console's Listen from anywhere page) ─────────────

  private const val EVENTS = "events"
  /** Kept until the app sends them; past this the oldest go first (a phone that never opens the app). */
  private const val MAX_EVENTS = 300

  /**
   * One thing that happened with no JS running: a take started, refused, reminded or ended, the button hidden, the
   * notification dismissed. `detail` is flat key=value pairs (no names, no audio, nothing about the person). The app
   * drains them (`drainEvents`) and sends them with the account's token; nothing leaves the phone from here.
   */
  @Synchronized
  fun logEvent(context: Context, name: String, detail: Map<String, Any?> = emptyMap()) {
    val p = prefs(context)
    val list = runCatching { JSONArray(p.getString(EVENTS, "[]")) }.getOrDefault(JSONArray())
    val d = detail.entries.filter { it.value != null }.joinToString(";") { "${it.key}=${it.value}" }
    list.put(JSONObject().put("name", name).put("detail", d).put("at", System.currentTimeMillis()))
    val kept = if (list.length() > MAX_EVENTS) JSONArray().also { out ->
      for (i in list.length() - MAX_EVENTS until list.length()) out.put(list.get(i))
    } else list
    p.edit().putString(EVENTS, kept.toString()).apply()
  }

  /** Everything logged since the last drain, as a JSON array, and the log emptied. */
  @Synchronized
  fun drainEvents(context: Context): String {
    val p = prefs(context)
    val raw = p.getString(EVENTS, "[]") ?: "[]"
    p.edit().remove(EVENTS).apply()
    return raw
  }

  // ── What a take is sent as ────────────────────────────────────────────────

  /** Singing (one line: a voice, or one instrument playing a tune), an instrument's several notes, or chords. */
  const val KIND_MELODY = "melody"
  const val KIND_POLY = "poly"
  const val KIND_CHORDS = "chords"
  private val KINDS = listOf(KIND_MELODY, KIND_POLY, KIND_CHORDS)

  /** "Listen for": the Record screen's mode a take is sent as. Singing until the person says otherwise. */
  fun kind(context: Context): String =
    prefs(context).getString("kind", KIND_MELODY).takeIf { it in KINDS } ?: KIND_MELODY

  fun setKind(context: Context, kind: String) =
    prefs(context).edit().putString("kind", if (kind in KINDS) kind else KIND_MELODY).apply()

  /** The pill's chip and the notification's "For:" step through the three in order. */
  fun nextKind(kind: String): String = KINDS[(KINDS.indexOf(kind).coerceAtLeast(0) + 1) % KINDS.size]

  fun kindLabel(context: Context, kind: String): String = context.getString(
    when (kind) {
      KIND_POLY -> R.string.nf_kind_poly
      KIND_CHORDS -> R.string.nf_kind_chords
      else -> R.string.nf_kind_melody
    }
  )

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
