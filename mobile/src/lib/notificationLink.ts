import { useEffect, useRef, useState } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';
import { transcriptionsApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { showDialog } from './dialog';
import { synthesizeMelodyWavBase64 } from './synth';
import { isExpoGo } from './env';
import type { RootStackParams } from '../navigation/types';

/**
 * Navigation handle for code that runs outside the container — here, a notification tap, which
 * arrives from the OS rather than from a screen and so has no `useNavigation` to reach for.
 */
export const navigationRef = createNavigationContainerRef<RootStackParams>();

/**
 * A tap that happened before the app was running is only interesting for a few minutes. Past that
 * it is almost certainly a leftover from a previous launch being replayed, and re-opening a draft
 * the user has long since dealt with would be baffling.
 */
const COLD_START_FRESH_MS = 10 * 60 * 1000;

/**
 * Opens the transcription behind a "ready" notification, as the same unsaved draft the record screen
 * would have shown. The result comes from our own API, which caches it — the ML service forgets a job
 * within minutes, and the whole point of the notification is that the user came back later.
 */
export async function openTranscriptionFromNotification(jobId: string): Promise<void> {
  try {
    const job = await transcriptionsApi.getJob(jobId);

    // No result means the job did not finish. The server sends the reason when it has one.
    if (!job.result) {
      showDialog({
        title: "That recording didn't finish",
        message:
          job.error ?? 'Something went wrong while transcribing it. Try recording it again.',
        icon: 'alert-circle-outline',
        tone: 'danger',
      });
      return;
    }

    const result = job.result;

    // The cached copy carries no audio: it is a WAV the size of the recording, and the same melody
    // re-synthesises locally in a few milliseconds — exactly how the library plays a saved item. A
    // preview does come back on the rare tap fast enough that the ML service still holds the job.
    const audioPreviewBase64 =
      result.audioPreviewBase64 || synthesizeMelodyWavBase64(result.notes, result.tempo);

    if (!navigationRef.isReady()) return;

    navigationRef.navigate('Result', {
      result: { ...result, audioPreviewBase64 },
      sourceJobId: jobId,
    });
  } catch (e) {
    showDialog({
      title: 'Could not open that transcription',
      message: toApiError(e).message,
      icon: 'alert-circle-outline',
      tone: 'danger',
    });
  }
}

/**
 * Wires notification taps to the screens they refer to.
 *
 * @param ready Whether the authenticated stack is mounted. A tap that launched the app arrives while
 * the session is still being restored, and navigating then would target the sign-in stack — so taps
 * are held until this turns true rather than dropped.
 */
export function useNotificationDeepLink(ready: boolean): void {
  const [pending, setPending] = useState<string | null>(null);

  // Both sources below can report the same tap. Without this the drain effect would run twice and
  // push Result on top of itself.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    // Expo Go dropped remote push in SDK 53, and importing the module there throws.
    if (isExpoGo) return;

    const Notifications = require('expo-notifications') as typeof import('expo-notifications');

    const jobIdOf = (response: unknown): string | null => {
      const data = (response as { notification?: { request?: { content?: { data?: unknown } } } })
        ?.notification?.request?.content?.data as { jobId?: unknown } | undefined;
      return typeof data?.jobId === 'string' ? data.jobId : null;
    };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const jobId = jobIdOf(response);
      if (jobId) setPending(jobId);
    });

    // The listener above covers a running app. A tap that started the app from cold may already have
    // been consumed before this JS ran, and only this call can still see it.
    let cancelled = false;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled || !response) return;
        if (Date.now() - response.notification.date > COLD_START_FRESH_MS) return;
        const jobId = jobIdOf(response);
        if (jobId) setPending(jobId);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!ready || !pending || handled.current === pending) return;
    handled.current = pending;
    setPending(null);
    void openTranscriptionFromNotification(pending);
  }, [ready, pending]);
}
