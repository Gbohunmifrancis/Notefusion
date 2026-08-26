import { useEffect, useRef, useState } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';
import { transcriptionsApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { openStoreListing } from './appUpdate';
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
 * Screens a notification may ask for by name, and how to get there. Doubles as the allow-list: a
 * `screen` the server did not send — or one from an older build — finds no entry here and is ignored,
 * so an unexpected payload cannot reach the navigator with a route it does not have.
 *
 * Deliberately just the destinations something actually sends. Adding one is a line here and the
 * matching `Data["screen"]` on the server.
 */
const LINKS: Record<string, () => void> = {
  /** `NotifySubscriptionExpiringCommand` has been sending this since it was written. */
  Upgrade: () => navigationRef.navigate('Upgrade'),
  /** `NotifyAdminsOfPaymentIssuesCommand` — the screen with the Reconcile button. */
  AdminPayments: () => navigationRef.navigate('AdminPayments'),
  AdminWebhooks: () => navigationRef.navigate('AdminWebhooks'),
  /**
   * `NotifyAppUpdateCommand`. Goes to the store, not a screen: there is nothing in the app to
   * show someone whose whole problem is that the app is out of date.
   */
  AppUpdate: () => void openStoreListing(),
  /**
   * The daily practice reminder. `Record` is a **tab**, not a root-stack route, so it needs the
   * nested form — `navigate('Record')` would find no such route and silently do nothing.
   */
  Record: () => navigationRef.navigate('Tabs', { screen: 'Record' }),
};

/**
 * A tap waiting for the authenticated stack. `job` carries a job id and costs an API call to resolve;
 * `screen` is a name from {@link LINKS}.
 */
type PendingTap = { kind: 'job' | 'screen'; value: string };

/**
 * Wires notification taps to the screens they refer to.
 *
 * @param ready Whether the authenticated stack is mounted. A tap that launched the app arrives while
 * the session is still being restored, and navigating then would target the sign-in stack — so taps
 * are held until this turns true rather than dropped.
 */
export function useNotificationDeepLink(ready: boolean): void {
  const [pending, setPending] = useState<PendingTap | null>(null);

  // Both sources below can report the same tap. Without this the drain effect would run twice and
  // push Result on top of itself.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    // Expo Go dropped remote push in SDK 53, and importing the module there throws.
    if (isExpoGo) return;

    const Notifications = require('expo-notifications') as typeof import('expo-notifications');

    const tapOf = (response: unknown): PendingTap | null => {
      const data = (response as { notification?: { request?: { content?: { data?: unknown } } } })
        ?.notification?.request?.content?.data as
        | { jobId?: unknown; screen?: unknown }
        | undefined;

      // A job id first: it names a specific result, where `screen` only names a place.
      if (typeof data?.jobId === 'string') return { kind: 'job', value: data.jobId };
      if (typeof data?.screen === 'string' && data.screen in LINKS)
        return { kind: 'screen', value: data.screen };
      return null;
    };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const tap = tapOf(response);
      if (tap) setPending(tap);
    });

    // The listener above covers a running app. A tap that started the app from cold may already have
    // been consumed before this JS ran, and only this call can still see it.
    let cancelled = false;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled || !response) return;
        if (Date.now() - response.notification.date > COLD_START_FRESH_MS) return;
        const tap = tapOf(response);
        if (tap) setPending(tap);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!ready || !pending) return;

    const key = `${pending.kind}:${pending.value}`;
    if (handled.current === key) return;
    handled.current = key;
    setPending(null);

    if (pending.kind === 'job') {
      void openTranscriptionFromNotification(pending.value);
      return;
    }
    if (navigationRef.isReady()) LINKS[pending.value]?.();
  }, [ready, pending]);
}
