package expo.modules.notefusionlisten

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.TypefaceSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * The floating button and what it becomes (board r-listen R1), drawn as plain Android views in overlay
 * windows: no JS runs while it sits over another app. Three small windows, never a full-screen one, so
 * the app underneath keeps every touch that is not on ours:
 *
 *  - the bubble: a 56 dp ink disc with the mark, docked half off an edge, dragged anywhere and docked
 *    again when let go; tapped, it grows into the listening pill (the red REC dot, the clock, the
 *    account's line, a ring that follows the level, Stop), which is not draggable;
 *  - the hide target: the × at the bottom centre while the bubble is dragged, grown when the bubble
 *    is near; let go over it, the button is hidden;
 *  - the card: "Sent — we'll tell you when it's ready." and the problem lines, beside the bubble or
 *    under the pill, gone by themselves.
 *
 * Night glass whatever the app's theme: over a white app a white pill would vanish. Reduce Motion
 * (Android's animator scale at 0) makes every move a cut.
 */
internal class OverlayUi(private val context: Context, private val host: Host) {
  interface Host {
    /** The idle disc tapped: start listening. */
    fun onTap()
    /** The pill's Stop: stop and send. */
    fun onStop()
    /** Dragged onto the ×. */
    fun onHidden()
    fun onBuySong()
  }

  enum class Card { SENT, PROBLEM, NONE_LEFT }

  private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val main = Handler(Looper.getMainLooper())
  private val density = context.resources.displayMetrics.density
  private fun dp(v: Float): Int = (v * density).roundToInt()
  private fun dpf(v: Float): Float = v * density

  private val semibold: Typeface? = runCatching { ResourcesCompat.getFont(context, R.font.geist_semibold) }.getOrNull()
  private val medium: Typeface? = runCatching { ResourcesCompat.getFont(context, R.font.geist_medium) }.getOrNull()
  private val mono: Typeface? = runCatching { ResourcesCompat.getFont(context, R.font.jetbrains_mono_medium) }.getOrNull()

  private var bubble: FrameLayout? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var disc: View? = null
  private var pill: View? = null
  private var ring: RingView? = null
  private var clockText: TextView? = null
  private var lineText: TextView? = null
  private var recDot: View? = null
  private var recBlink: ValueAnimator? = null
  private var snap: ValueAnimator? = null

  private var hideTarget: FrameLayout? = null
  private var hideParams: WindowManager.LayoutParams? = null
  private var hideDisc: View? = null

  private var card: View? = null
  private var cardParams: WindowManager.LayoutParams? = null
  private var cardHide: Runnable? = null

  private var listening = false
  private var dockedRight = true
  /** The bubble window's y, in screen pixels. */
  private var y = 0

  val shown: Boolean get() = bubble != null

  private val reduceMotion: Boolean
    get() = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
  private fun ms(v: Long): Long = if (reduceMotion) 0L else v

  // ── Screen ────────────────────────────────────────────────────────────────

  private fun screen(): Rect =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) wm.currentWindowMetrics.bounds
    else android.util.DisplayMetrics().let {
      @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(it)
      Rect(0, 0, it.widthPixels, it.heightPixels)
    }

  /** The status and navigation bars, which the bubble keeps out of. */
  private fun insets(): Rect =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val i = wm.currentWindowMetrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars())
      Rect(i.left, i.top, i.right, i.bottom)
    } else Rect(0, dp(24f), 0, dp(48f))

  private fun usableTop(): Int = insets().top + dp(8f)
  private fun usableBottom(): Int = screen().height() - insets().bottom - dp(8f)

  private fun discDockX(): Int = if (dockedRight) screen().width() - dp(DISC_DP) / 2 else -dp(DISC_DP) / 2

  private fun pillX(width: Int): Int = if (dockedRight) screen().width() - width - dp(12f) else dp(12f)

  private fun overlayType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

  /**
   * Every window is placed in screen pixels from the top-left corner (FLAG_LAYOUT_NO_LIMITS: the bubble sits half
   * off the edge, and the finger's rawX/rawY are in the same space), kept inside the bars by the callers.
   */
  private fun params(x: Int, y: Int): WindowManager.LayoutParams =
    WindowManager.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      this.x = x
      this.y = y
    }

  // ── The bubble ────────────────────────────────────────────────────────────

  fun show() {
    if (bubble != null) return
    val (right, frac) = ListenPrefs.buttonPlace(context)
    dockedRight = right
    y = (usableTop() + frac * (usableBottom() - usableTop() - dp(DISC_DP))).roundToInt().coerceIn(usableTop(), usableBottom() - dp(DISC_DP))
    val root = FrameLayout(context)
    val d = buildDisc()
    val p = buildPill()
    p.visibility = View.GONE
    root.addView(d)
    root.addView(p)
    disc = d
    pill = p
    val lp = params(discDockX(), y)
    runCatching { wm.addView(root, lp) }.onFailure { return }
    bubble = root
    bubbleParams = lp
  }

  fun hide() {
    cancelCard()
    hideHideTarget()
    recBlink?.cancel()
    recBlink = null
    snap?.cancel()
    snap = null
    bubble?.let { runCatching { wm.removeView(it) } }
    bubble = null
    bubbleParams = null
    disc = null
    pill = null
    ring = null
    clockText = null
    lineText = null
    recDot = null
    listening = false
  }

  private fun circle(fill: Int, strokeDp: Float = 0f, stroke: Int = 0): GradientDrawable =
    GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(fill)
      if (strokeDp > 0f) setStroke(dp(strokeDp), stroke)
    }

  private fun rounded(fill: Int, radiusDp: Float, strokeDp: Float = 0f, stroke: Int = 0): GradientDrawable =
    GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = dpf(radiusDp)
      setColor(fill)
      if (strokeDp > 0f) setStroke(dp(strokeDp), stroke)
    }

  private fun mark(widthDp: Float, heightDp: Float, tint: Int): ImageView =
    ImageView(context).apply {
      setImageResource(R.drawable.nf_mark)
      imageTintList = ColorStateList.valueOf(tint)
      scaleType = ImageView.ScaleType.FIT_CENTER
      layoutParams = FrameLayout.LayoutParams(dp(widthDp), dp(heightDp), Gravity.CENTER)
    }

  private fun text(sizeSp: Float, color: Int, face: Typeface?): TextView =
    TextView(context).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      setTextColor(color)
      typeface = face
      includeFontPadding = false
      maxLines = 1
    }

  private fun buildDisc(): View {
    val d = FrameLayout(context)
    d.layoutParams = FrameLayout.LayoutParams(dp(DISC_DP), dp(DISC_DP))
    d.background = circle(INK, 1f, LINE)
    d.contentDescription = context.getString(R.string.nf_bubble_description)
    d.addView(mark(22f, 28f, Color.WHITE))
    d.setOnTouchListener(DragListener())
    return d
  }

  private fun buildPill(): View {
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      background = rounded(INK, DISC_DP / 2f, 1f, LINE)
      setPadding(dp(6f), 0, dp(6f), 0)
      layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(DISC_DP))
    }
    // The mark in its ring, which follows the level.
    val markBox = FrameLayout(context).apply { layoutParams = LinearLayout.LayoutParams(dp(44f), dp(44f)) }
    val r = RingView(context).apply { layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
    markBox.addView(r)
    markBox.addView(mark(18f, 24f, Color.WHITE))
    ring = r
    row.addView(markBox)

    val lines = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(10f), 0, dp(12f), 0)
      layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }
    val top = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val dot = View(context).apply {
      background = circle(RED)
      layoutParams = LinearLayout.LayoutParams(dp(8f), dp(8f)).apply { marginEnd = dp(8f) }
    }
    recDot = dot
    top.addView(dot)
    val textWidth = screen().width() - dp(156f) // the pill's margins, the mark, the paddings and Stop
    val clock = text(15f, TEXT, semibold).apply {
      maxWidth = textWidth
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    clockText = clock
    top.addView(clock)
    lines.addView(top)
    val line = text(12f, MUTED, medium).apply {
      maxWidth = textWidth
      ellipsize = android.text.TextUtils.TruncateAt.END
      setPadding(0, dp(2f), 0, 0)
    }
    lineText = line
    lines.addView(line)
    row.addView(lines)

    val stop = FrameLayout(context).apply {
      layoutParams = LinearLayout.LayoutParams(dp(44f), dp(44f))
      background = circle(Color.WHITE)
      contentDescription = context.getString(R.string.nf_bubble_stop_description)
      addView(ImageView(context).apply {
        setImageResource(R.drawable.nf_ic_stop)
        imageTintList = ColorStateList.valueOf(INK_SOLID)
        layoutParams = FrameLayout.LayoutParams(dp(16f), dp(16f), Gravity.CENTER)
      })
      setOnClickListener { host.onStop() }
    }
    row.addView(stop)
    setClock(0)
    return row
  }

  /** The disc becomes the pill (or back): the pill grows out of the docked edge over 200 ms. */
  fun setListening(on: Boolean, line: String) {
    val root = bubble ?: return
    val d = disc ?: return
    val p = pill ?: return
    val lp = bubbleParams ?: return
    if (on == listening) {
      if (on) lineText?.text = line
      return
    }
    listening = on
    snap?.cancel()
    cancelCard()
    if (on) {
      lineText?.text = line
      setClock(0)
      d.visibility = View.GONE
      p.visibility = View.VISIBLE
      p.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
      lp.x = pillX(p.measuredWidth)
      lp.y = y
      runCatching { wm.updateViewLayout(root, lp) }
      p.pivotX = if (dockedRight) p.measuredWidth.toFloat() else 0f
      p.pivotY = dp(DISC_DP) / 2f
      p.scaleX = 0.3f
      p.alpha = 0.6f
      p.animate().scaleX(1f).alpha(1f).setDuration(ms(200)).setInterpolator(DecelerateInterpolator()).start()
      startBlink()
    } else {
      stopBlink()
      p.animate().cancel()
      p.visibility = View.GONE
      d.visibility = View.VISIBLE
      lp.x = discDockX()
      lp.y = y
      runCatching { wm.updateViewLayout(root, lp) }
    }
  }

  fun setClock(seconds: Int) {
    val t = clockText ?: return
    val s = SpannableStringBuilder()
    val head = context.getString(R.string.nf_bubble_listening) + " · "
    s.append(head)
    val start = s.length
    s.append(formatClock(seconds))
    mono?.let { s.setSpan(TypefaceSpanCompat(it), start, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    t.text = s
  }

  fun setLine(line: String) {
    lineText?.text = line
  }

  fun setLevel(level: Float) {
    ring?.level = level
  }

  private fun startBlink() {
    val dot = recDot ?: return
    recBlink?.cancel()
    if (reduceMotion) {
      dot.alpha = 1f
      return
    }
    recBlink = ValueAnimator.ofFloat(1f, 0.35f).apply {
      duration = 700
      repeatMode = ValueAnimator.REVERSE
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener { dot.alpha = it.animatedValue as Float }
      start()
    }
  }

  private fun stopBlink() {
    recBlink?.cancel()
    recBlink = null
    recDot?.alpha = 1f
  }

  // ── Dragging ──────────────────────────────────────────────────────────────

  private inner class DragListener : View.OnTouchListener {
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false

    override fun onTouch(v: View, e: MotionEvent): Boolean {
      val lp = bubbleParams ?: return false
      val root = bubble ?: return false
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = e.rawX
          downY = e.rawY
          startX = lp.x
          startY = lp.y
          dragging = false
          snap?.cancel()
          v.animate().scaleX(0.94f).scaleY(0.94f).setDuration(ms(90)).start()
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - downX
          val dy = e.rawY - downY
          if (!dragging && hypot(dx, dy) > slop) {
            dragging = true
            showHideTarget()
          }
          if (dragging) {
            lp.x = (startX + dx).roundToInt()
            lp.y = (startY + dy).roundToInt()
            runCatching { wm.updateViewLayout(root, lp) }
            setHideTargetNear(nearHideTarget(e.rawX, e.rawY))
          }
          return true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          v.animate().scaleX(1f).scaleY(1f).setDuration(ms(90)).start()
          val wasDragging = dragging
          dragging = false
          val near = wasDragging && e.actionMasked == MotionEvent.ACTION_UP && nearHideTarget(e.rawX, e.rawY)
          hideHideTarget()
          if (!wasDragging) {
            if (e.actionMasked == MotionEvent.ACTION_UP) host.onTap()
          } else if (near) {
            host.onHidden()
          } else {
            dock(e.rawX)
          }
          return true
        }
      }
      return false
    }
  }

  /** Lets the bubble go: it slides to the nearer edge, half off it, and the place is remembered. */
  private fun dock(fingerX: Float) {
    val root = bubble ?: return
    val lp = bubbleParams ?: return
    val s = screen()
    dockedRight = fingerX > s.width() / 2f
    y = lp.y.coerceIn(usableTop(), usableBottom() - dp(DISC_DP))
    val fromX = lp.x
    val fromY = lp.y
    val toX = discDockX()
    val toY = y
    val usable = (usableBottom() - usableTop() - dp(DISC_DP)).coerceAtLeast(1)
    ListenPrefs.setButtonPlace(context, dockedRight, (y - usableTop()).toFloat() / usable)
    snap?.cancel()
    snap = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = ms(200)
      interpolator = DecelerateInterpolator()
      addUpdateListener {
        val f = it.animatedValue as Float
        lp.x = (fromX + (toX - fromX) * f).roundToInt()
        lp.y = (fromY + (toY - fromY) * f).roundToInt()
        runCatching { wm.updateViewLayout(root, lp) }
      }
      start()
    }
  }

  // ── The hide target ───────────────────────────────────────────────────────

  private fun hideTargetCentre(): Pair<Float, Float> {
    val s = screen()
    return s.width() / 2f to (usableBottom() - dp(HIDE_DP) / 2f - dp(28f))
  }

  private fun nearHideTarget(x: Float, y: Float): Boolean {
    val (cx, cy) = hideTargetCentre()
    return hypot(x - cx, y - cy) < dp(80f)
  }

  private fun showHideTarget() {
    if (hideTarget != null) return
    val (cx, cy) = hideTargetCentre()
    val box = FrameLayout(context)
    val column = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
    }
    val d = FrameLayout(context).apply {
      layoutParams = LinearLayout.LayoutParams(dp(HIDE_DP), dp(HIDE_DP))
      background = circle(INK, 1f, LINE)
      addView(ImageView(context).apply {
        setImageResource(R.drawable.nf_ic_close)
        imageTintList = ColorStateList.valueOf(Color.WHITE)
        layoutParams = FrameLayout.LayoutParams(dp(20f), dp(20f), Gravity.CENTER)
      })
    }
    hideDisc = d
    column.addView(d)
    column.addView(text(12f, MUTED, medium).apply {
      text = context.getString(R.string.nf_bubble_hide)
      setPadding(0, dp(6f), 0, 0)
      gravity = Gravity.CENTER_HORIZONTAL
    })
    box.addView(column)
    box.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
    val lp = params((cx - box.measuredWidth / 2f).roundToInt(), (cy - dp(HIDE_DP) / 2f).roundToInt())
    runCatching { wm.addView(box, lp) }.onFailure { return }
    hideTarget = box
    hideParams = lp
    box.alpha = 0f
    box.animate().alpha(1f).setDuration(ms(150)).start()
  }

  private fun setHideTargetNear(near: Boolean) {
    val d = hideDisc ?: return
    val scale = if (near) 1.15f else 1f
    if (d.scaleX != scale) d.animate().scaleX(scale).scaleY(scale).setDuration(ms(120)).start()
  }

  private fun hideHideTarget() {
    hideTarget?.let { runCatching { wm.removeView(it) } }
    hideTarget = null
    hideParams = null
    hideDisc = null
  }

  // ── Cards ─────────────────────────────────────────────────────────────────

  /** A line beside the bubble (under the pill while listening), gone after `durationMs`. */
  fun showCard(kind: Card, line: String, durationMs: Long) {
    cancelCard()
    val root = bubble ?: return
    val lp = bubbleParams ?: return
    val s = screen()
    val box = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      background = rounded(INK, 14f, 1f, LINE)
      setPadding(dp(12f), dp(10f), dp(12f), dp(10f))
    }
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val icon = when (kind) {
      Card.SENT -> R.drawable.nf_ic_check to MINT
      Card.PROBLEM -> R.drawable.nf_ic_alert to AMBER
      Card.NONE_LEFT -> null
    }
    if (icon != null) {
      row.addView(ImageView(context).apply {
        setImageResource(icon.first)
        imageTintList = ColorStateList.valueOf(icon.second)
        layoutParams = LinearLayout.LayoutParams(dp(18f), dp(18f)).apply { marginEnd = dp(8f) }
      })
    }
    val maxText = (s.width() - dp(24f + DISC_DP / 2f + 8f + 24f + 18f + 8f + 26f)).coerceAtLeast(dp(160f))
    row.addView(text(14f, TEXT, medium).apply {
      text = line
      maxLines = 3
      maxWidth = maxText
      layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    })
    if (kind == Card.NONE_LEFT) {
      row.addView(ImageView(context).apply {
        setImageResource(R.drawable.nf_ic_close)
        imageTintList = ColorStateList.valueOf(MUTED)
        layoutParams = LinearLayout.LayoutParams(dp(26f), dp(26f)).apply { marginStart = dp(8f) }
        setPadding(dp(4f), dp(4f), dp(4f), dp(4f))
        contentDescription = context.getString(R.string.nf_bubble_close)
        setOnClickListener { cancelCard() }
      })
    }
    box.addView(row)
    if (kind == Card.NONE_LEFT) {
      box.addView(text(14f, ICE, semibold).apply {
        text = context.getString(R.string.nf_take_buy_song)
        setPadding(0, dp(10f), 0, 0)
        setOnClickListener {
          cancelCard()
          host.onBuySong()
        }
      })
    }
    box.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
    val w = box.measuredWidth
    val h = box.measuredHeight
    val x: Int
    val cy: Int
    if (listening) {
      x = lp.x.coerceIn(dp(12f), s.width() - w - dp(12f))
      cy = lp.y + dp(DISC_DP) + dp(8f)
    } else {
      x = if (dockedRight) s.width() - dp(DISC_DP) / 2 - dp(8f) - w else dp(DISC_DP) / 2 + dp(8f)
      cy = (lp.y + (dp(DISC_DP) - h) / 2).coerceIn(usableTop(), usableBottom() - h)
    }
    val clp = params(x, cy)
    runCatching { wm.addView(box, clp) }.onFailure { return }
    card = box
    cardParams = clp
    box.alpha = 0f
    box.animate().alpha(1f).setDuration(ms(150)).start()
    val hideIt = Runnable { cancelCard() }
    cardHide = hideIt
    main.postDelayed(hideIt, durationMs)
    root.bringToFront()
  }

  fun cancelCard() {
    cardHide?.let { main.removeCallbacks(it) }
    cardHide = null
    card?.let { runCatching { wm.removeView(it) } }
    card = null
    cardParams = null
  }

  /** A circle whose stroke's weight follows the level: 25 % at silence, full at full scale. */
  private class RingView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      color = BLUE
      strokeWidth = 2f * context.resources.displayMetrics.density
    }
    private var shown = 0f
    var level: Float = 0f
      set(v) {
        field = v.coerceIn(0f, 1f)
        // Smoothed, so the ring breathes rather than flickers.
        shown = shown * 0.55f + field * 0.45f
        invalidate()
      }

    override fun onDraw(canvas: Canvas) {
      val r = minOf(width, height) / 2f - paint.strokeWidth
      paint.alpha = (255 * (0.25f + 0.75f * shown)).roundToInt()
      canvas.drawCircle(width / 2f, height / 2f, r, paint)
    }
  }

  /** `TypefaceSpan(Typeface)` arrived in API 28; below it the clock just keeps the pill's face. */
  private class TypefaceSpanCompat(private val face: Typeface) : TypefaceSpan("monospace") {
    override fun updateDrawState(ds: android.text.TextPaint) = apply(ds)
    override fun updateMeasureState(paint: android.text.TextPaint) = apply(paint)
    private fun apply(paint: android.text.TextPaint) {
      paint.typeface = face
    }
  }

  companion object {
    const val DISC_DP = 56f
    private const val HIDE_DP = 56f
    /** The night palette (design/theme.ts): ink glass, white, muted, blue, red, mint, amber, ice. */
    private val INK = Color.parseColor("#F20B1220")
    private val INK_SOLID = Color.parseColor("#0B1220")
    private val LINE = Color.parseColor("#1FFFFFFF")
    private val TEXT = Color.parseColor("#F3F6FB")
    private val MUTED = Color.parseColor("#8B95AA")
    private val BLUE = Color.parseColor("#2F7BFF")
    private val RED = Color.parseColor("#FF4D5E")
    private val MINT = Color.parseColor("#3DDC97")
    private val AMBER = Color.parseColor("#F5B544")
    private val ICE = Color.parseColor("#9CC2FF")

    fun formatClock(seconds: Int): String = "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
  }
}
