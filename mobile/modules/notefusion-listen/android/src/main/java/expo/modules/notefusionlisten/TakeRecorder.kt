package expo.modules.notefusionlisten

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * One take, written as the Record screen writes one: AAC in an .m4a at 22,050 Hz mono (the rate the
 * worker resamples every upload to), 128 kbps or data saver's 32 (lib/recordingPreset.ts), so the
 * server cannot tell a take from the bubble from one made in the app.
 *
 * The audio is the microphone ("The room") or, on Android 10+, what the phone itself is playing
 * (`AudioPlaybackCaptureConfiguration` under a MediaProjection the user just consented to): clean,
 * with headphones in too. An app may opt out of being captured; it then comes through as silence while
 * `AudioManager.isMusicActive()` says music is playing, and that is reported so the service can fall
 * back to the room.
 *
 * `AudioRecord` → `MediaCodec` (AAC-LC) → `MediaMuxer`, on one capture thread; the level (for the
 * pill's ring) and the elapsed seconds reach the listener on the main thread. `stop()` blocks until
 * the file is closed, so the caller can hand it on at once.
 */
internal class TakeRecorder(
  private val context: Context,
  private val source: String,
  private val projection: MediaProjection?,
  private val outFile: File,
  private val bitRate: Int,
  private val capSeconds: Int,
  private val listener: Listener,
) {
  interface Listener {
    /** 0..1, about ten times a second. */
    fun onLevel(level: Float)
    fun onElapsed(seconds: Int)
    /** The take reached the account's cap: the service stops it and sends. */
    fun onCapReached()
    /** Phone sound: nothing came through for the first seconds while music plays (the app blocks capture). */
    fun onCaptureSilent()
    /**
     * A forgotten take, by its sound: NOTHING_HEARD when the first minute held nothing above the quiet line, MUSIC_STOPPED
     * when at least ten seconds were heard and then 45 went quiet. Reported once each; the service ends the take.
     */
    fun onQuiet(kind: Quiet)
    fun onFailed(code: String, message: String?)
  }

  enum class Quiet { NOTHING_HEARD, MUSIC_STOPPED }

  /** `heardSec`: how much of the take was above the quiet line; a take with almost none is not worth a transcription. */
  class Result(val durationSec: Double, val ok: Boolean, val heardSec: Double = 0.0)

  private val main = Handler(Looper.getMainLooper())
  private var record: AudioRecord? = null
  private var thread: Thread? = null
  @Volatile private var capturing = false
  @Volatile private var result: Result = Result(0.0, false)
  /** Frames above the quiet line, and the frames since the last one; read by the capture thread only. */
  private var heardFrames = 0L
  private var quietRunFrames = 0L
  private var quietReported = false

  val isCapturing: Boolean get() = capturing

  @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by the service before this is made.
  fun start(): Boolean {
    val minBytes = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val bufferBytes = maxOf(minBytes, CHUNK_FRAMES * 2 * 8)
    val recorder = try {
      if (source == ListenPrefs.SOURCE_PHONE && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && projection != null) {
        val capture = AudioPlaybackCaptureConfiguration.Builder(projection)
          .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
          .addMatchingUsage(AudioAttributes.USAGE_GAME)
          .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
          .build()
        AudioRecord.Builder()
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(SAMPLE_RATE)
              .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
              .build()
          )
          .setBufferSizeInBytes(bufferBytes)
          .setAudioPlaybackCaptureConfig(capture)
          .build()
      } else {
        AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferBytes)
      }
    } catch (e: Exception) {
      fail("E_MIC_UNAVAILABLE", e.message)
      return false
    }
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      fail("E_MIC_UNAVAILABLE", "AudioRecord did not initialise")
      return false
    }
    try {
      recorder.startRecording()
    } catch (e: Exception) {
      recorder.release()
      fail("E_MIC_UNAVAILABLE", e.message)
      return false
    }
    if (recorder.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      recorder.release()
      fail("E_MIC_UNAVAILABLE", "The recorder did not start")
      return false
    }
    record = recorder
    capturing = true
    thread = Thread({ run(recorder) }, "nf-take-recorder").apply { start() }
    return true
  }

  /** Ends the take and closes the file; the result says how long it is and whether the file is usable. */
  fun stop(): Result {
    if (!capturing && thread == null) return result
    capturing = false
    runCatching { record?.stop() } // unblocks the read
    thread?.takeIf { it !== Thread.currentThread() }?.let { runCatching { it.join(8_000) } }
    thread = null
    return result
  }

  private fun fail(code: String, message: String?) {
    main.post { listener.onFailed(code, message) }
  }

  private fun run(recorder: AudioRecord) {
    val codec: MediaCodec
    val muxer: MediaMuxer
    try {
      codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
      val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 1).apply {
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, MAX_INPUT_BYTES)
      }
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      outFile.parentFile?.mkdirs()
      muxer = MediaMuxer(outFile.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    } catch (e: Exception) {
      capturing = false
      recorder.release()
      record = null
      fail("E_ENCODER", e.message)
      return
    }

    val pcm = ShortArray(CHUNK_FRAMES)
    val bytes = ByteBuffer.allocateDirect(CHUNK_FRAMES * 2).order(ByteOrder.LITTLE_ENDIAN)
    val info = MediaCodec.BufferInfo()
    var track = -1
    var muxing = false
    var frames = 0L
    var lastSecond = -1
    var loudest = 0
    var captureChecked = false
    var capReported = false
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun drain(endOfStream: Boolean) {
      var waits = 0
      while (true) {
        val outIdx = codec.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
        when {
          // At the end the encoder is given up to half a second to hand its last frames out, then the file closes.
          outIdx == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!endOfStream || ++waits > 50) return
          outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxing = true
          }
          outIdx >= 0 -> {
            val out = codec.getOutputBuffer(outIdx)
            val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
            if (out != null && info.size > 0 && muxing && !config) {
              out.position(info.offset)
              out.limit(info.offset + info.size)
              muxer.writeSampleData(track, out, info)
            }
            codec.releaseOutputBuffer(outIdx, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
          }
        }
      }
    }

    try {
      while (capturing) {
        val n = recorder.read(pcm, 0, CHUNK_FRAMES, AudioRecord.READ_BLOCKING)
        if (n < 0) {
          if (capturing) {
            capturing = false
            fail("E_MIC_UNAVAILABLE", "The recorder stopped")
          }
          break
        }
        if (n == 0) continue

        // The level for the ring, and the first seconds' loudest sample for the capture check.
        var sum = 0.0
        var peak = 0
        for (i in 0 until n) {
          val v = pcm[i].toInt()
          sum += v.toDouble() * v
          if (abs(v) > peak) peak = abs(v)
        }
        val rms = sqrt(sum / n)
        val db = if (rms < 1.0) -120.0 else 20.0 * log10(rms / 32768.0)
        val level = ((db + LEVEL_FLOOR_DB) / LEVEL_FLOOR_DB).toFloat().coerceIn(0f, 1f)
        main.post { listener.onLevel(level) }

        // What was heard, for a forgotten take: nothing in the first minute ends it unsent; the music stopping after it
        // was heard ends it sent. A phone's own noise floor sits well under the line; music near the phone well over.
        if (db >= HEARD_DB) {
          heardFrames += n
          quietRunFrames = 0
        } else {
          quietRunFrames += n
        }
        if (!quietReported) {
          val nothing = frames + n >= NOTHING_HEARD_SEC * SAMPLE_RATE && heardFrames < MIN_HEARD_SEC * SAMPLE_RATE
          val stopped = heardFrames >= MUSIC_HEARD_SEC * SAMPLE_RATE && quietRunFrames >= MUSIC_STOPPED_SEC * SAMPLE_RATE
          if (nothing || stopped) {
            quietReported = true
            val kind = if (nothing) Quiet.NOTHING_HEARD else Quiet.MUSIC_STOPPED
            main.post { listener.onQuiet(kind) }
          }
        }

        // Phone sound: a sound coming through settles it; none after the first seconds while music plays
        // means the app opted out of capture, said once.
        if (source == ListenPrefs.SOURCE_PHONE && !captureChecked) {
          if (peak > loudest) loudest = peak
          if (loudest > SILENCE_PEAK) captureChecked = true
          else if (frames >= (CAPTURE_CHECK_SEC * SAMPLE_RATE).toLong() && audioManager.isMusicActive) {
            captureChecked = true
            main.post { listener.onCaptureSilent() }
          }
        }

        val inIdx = codec.dequeueInputBuffer(20_000)
        if (inIdx >= 0) {
          bytes.clear()
          for (i in 0 until n) bytes.putShort(pcm[i])
          bytes.flip()
          val input = codec.getInputBuffer(inIdx)
          if (input != null) {
            input.clear()
            input.put(bytes)
            val ptsUs = frames * 1_000_000L / SAMPLE_RATE
            codec.queueInputBuffer(inIdx, 0, n * 2, ptsUs, 0)
          }
        }
        frames += n
        drain(false)

        val second = (frames / SAMPLE_RATE).toInt()
        if (second != lastSecond) {
          lastSecond = second
          main.post { listener.onElapsed(second) }
        }
        if (!capReported && frames >= capSeconds.toLong() * SAMPLE_RATE) {
          capReported = true
          main.post { listener.onCapReached() }
        }
      }

      // The end of the stream: whatever the encoder still holds is written out before the file closes.
      val inIdx = codec.dequeueInputBuffer(50_000)
      if (inIdx >= 0) codec.queueInputBuffer(inIdx, 0, 0, frames * 1_000_000L / SAMPLE_RATE, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
      drain(true)
    } catch (e: Exception) {
      capturing = false
      fail("E_ENCODER", e.message)
    } finally {
      runCatching { codec.stop() }
      runCatching { codec.release() }
      if (muxing) runCatching { muxer.stop() }
      runCatching { muxer.release() }
      runCatching { recorder.release() }
      record = null
      val duration = frames.toDouble() / SAMPLE_RATE
      val ok = muxing && outFile.length() > 0
      if (!ok) runCatching { outFile.delete() }
      result = Result(duration, ok, heardFrames.toDouble() / SAMPLE_RATE)
    }
  }

  companion object {
    const val SAMPLE_RATE = 22_050
    /** 100 ms of audio per read: the ring moves ten times a second. */
    private const val CHUNK_FRAMES = SAMPLE_RATE / 10
    private const val MAX_INPUT_BYTES = 16_384
    /** The ring's floor: −50 dBFS is 0, full scale is 1. */
    private const val LEVEL_FLOOR_DB = 50.0
    /** Phone sound: silence this long while music plays means the app does not allow capture. */
    private const val CAPTURE_CHECK_SEC = 2.5
    private const val SILENCE_PEAK = 8
    /** The quiet line: a chunk at or above it counts as heard. A phone's own noise is near −60 dBFS or below. */
    const val HEARD_DB = -52.0
    /** Under this much heard, a take is silence: never sent. */
    const val MIN_HEARD_SEC = 2.0
    /** The first minute with nothing heard: the take ends, unsent. */
    private const val NOTHING_HEARD_SEC = 60.0
    /** After this much was heard, MUSIC_STOPPED_SEC of quiet ends the take and sends it. */
    private const val MUSIC_HEARD_SEC = 10.0
    private const val MUSIC_STOPPED_SEC = 45.0
  }
}
