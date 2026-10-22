package expo.modules.notefusionlisten

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Runs lib/listenTake.ts for a finished take with no screen open: React Native starts (or reuses) the JS
 * runtime and calls the task `index.ts` registers, which puts the file through the same send queue as a
 * take from the Record screen. Allowed in the foreground too, so a take made with the app open goes the
 * same way; ten minutes is more than a six-minute take needs on a slow connection.
 */
class ListenTakeHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(TASK_KEY, Arguments.fromBundle(extras), TIMEOUT_MS, true)
  }

  companion object {
    const val TASK_KEY = "NotefusionListenTake"
    private const val TIMEOUT_MS = 10L * 60_000L
  }
}
