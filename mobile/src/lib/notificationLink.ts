import { useEffect, useRef, useState } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';
import { transcriptionsApi } from '../api/endpoints';
import { safeReason, toApiError } from '../api/client';
import { openStoreListing } from './appUpdate';
import { showDialog } from './dialog';
import { synthesizeMelodyWavBase64 } from './synth';
import { isExpoGo } from './env';
import { isAdminScreen, notificationTarget } from './navTargets';
import { MUTE_HOUR_ACTION, MUTE_MINUTES } from './paymentAlerts';
import { mutePaymentAlerts } from './paymentAlertsRuntime';
import { showToast } from './toast';
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
export async function openTranscriptionFromNotification(jobId: string): Promise<boolean> {
  try {
    const job = await transcriptionsApi.getJob(jobId);

    // No result means the job did not finish. The server sends the reason when it has one.
    if (!job.result) {
      showDialog({
        title: "That recording didn't finish",
        message: safeReason(
          job.error,
          'Something went wrong while transcribing it. Try recording it again. Nothing was used up.',
        ),
        icon: 'problem',
        tone: 'danger',
        // The fix is the pill; "OK" only closes (board 7a).
        actions: [
          { label: 'OK', style: 'cancel' },
          {
            label: 'Record again',
            onPress: () => {
              if (navigationRef.isReady()) navigationRef.navigate('Tabs', { screen: 'Record' });
            },
          },
        ],
      });
      return false;
    }

    const result = job.result;

    // The cached copy carries no audio: it is a WAV the size of the recording, and the same melody
    // re-synthesises locally in a few milliseconds — exactly how the library plays a saved item. A
    // preview does come back on the rare tap fast enough that the ML service still holds the job.
    const audioPreviewBase64 =
      result.audioPreviewBase64 || synthesizeMelodyWavBase64(result.notes, result.tempo);

    if (!navigationRef.isReady()) return false;

    navigationRef.navigate('Result', {
      result: { ...result, audioPreviewBase64 },
      sourceJobId: jobId,
      fresh: true,
      // Filed in the Library as it finished (option A): opened as the saved sheet.
      savedId: job.savedId ?? undefined,
      title: job.savedTitle ?? undefined,
    });
    return true;
  } catch (e) {
    showDialog({
      title: 'Could not open that transcription',
      message: toApiError(e).message,
      icon: 'problem',
      tone: 'danger',
    });
    return false;
  }
}

/**
 * Follows a notification's `data.screen` (`lib/navTargets` is the allow-list). A tab is nested in the root stack, so
 * it needs the nested form: `navigate('Practice')` would find no such route and do nothing. An admin place opens
 * Admin (behind its lock) on that tab, with the payment's sheet when the push named one; for anyone but an admin it
 * resolves to nothing.
 */
function openScreen(screen: string, opts: { isAdmin: boolean; paymentId?: string }): void {
  const target = notificationTarget(screen, opts);
  if (!target) return;
  if (target.kind === 'store') void openStoreListing();
  else if (target.kind === 'tab') navigationRef.navigate('Tabs', { screen: target.tab });
  else if (target.kind === 'admin')
    navigationRef.navigate('Admin', {
      screen: 'AdminTabs',
      params: {
        screen: target.tab,
        params:
          target.tab === 'Payments'
            ? { paymentId: target.paymentId, view: target.view, nonce: Date.now() }
            : undefined,
      } as never,
    });
  else navigationRef.navigate(target.route);
}

/**
 * A tap waiting for the authenticated stack. `job` carries a job id and costs an API call to resolve;
 * `screen` is a name `notificationTarget` knows. `id` is the notification's own, so two taps on two notifications
 * that name the same place (the evening reminder, then the last chance) are both followed. `mute` is a payment
 * alert's "Mute 1 hour" button: it opens nothing.
 */
type PendingTap = { kind: 'job' | 'screen' | 'mute'; value: string; id?: string; paymentId?: string };

/**
 * Wires notification taps to the screens they refer to.
 *
 * @param ready Whether the authenticated stack is mounted. A tap that launched the app arrives while
 * the session is still being restored, and navigating then would target the sign-in stack — so taps
 * are held until this turns true rather than dropped.
 */
export function useNotificationDeepLink(ready: boolean, isAdmin = false): void {
  const [pending, setPending] = useState<PendingTap | null>(null);

  // Both sources below can report the same tap. Without this the drain effect would run twice and
  // push Result on top of itself.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    // Expo Go dropped remote push in SDK 53, and importing the module there throws.
    if (isExpoGo) return;

    const Notifications = require('expo-notifications') as typeof import('expo-notifications');

    const tapOf = (response: unknown): PendingTap | null => {
      const r = response as {
        actionIdentifier?: unknown;
        notification?: { request?: { identifier?: unknown; content?: { data?: unknown } } };
      };
      const request = r?.notification?.request;
      const data = request?.content?.data as { jobId?: unknown; screen?: unknown; paymentId?: unknown } | undefined;
      const id = typeof request?.identifier === 'string' ? request.identifier : undefined;

      // A job id first: it names a specific result, where `screen` only names a place.
      if (typeof data?.jobId === 'string') return { kind: 'job', value: data.jobId, id };
      if (typeof data?.screen === 'string' && (notificationTarget(data.screen) || isAdminScreen(data.screen))) {
        if (r.actionIdentifier === MUTE_HOUR_ACTION && isAdminScreen(data.screen))
          return { kind: 'mute', value: data.screen, id };
        return {
          kind: 'screen',
          value: data.screen,
          id,
          paymentId: typeof data.paymentId === 'string' ? data.paymentId : undefined,
        };
      }
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

    const key = `${pending.kind}:${pending.value}:${pending.id ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;
    setPending(null);

    if (pending.kind === 'job') {
      void openTranscriptionFromNotification(pending.value);
      return;
    }
    if (pending.kind === 'mute') {
      // Only an admin's phone has the button; the server refuses anyone else regardless.
      if (isAdmin)
        void mutePaymentAlerts(MUTE_MINUTES).then((done) => {
          if (done) showToast('Payment alerts are quiet for an hour', { icon: 'mute' });
          else
            showDialog({
              title: "Couldn't mute payment alerts",
              message: 'Try again from Admin, More, Payment alerts.',
              icon: 'problem',
              tone: 'danger',
            });
        });
      return;
    }
    if (navigationRef.isReady()) openScreen(pending.value, { isAdmin, paymentId: pending.paymentId });
  }, [ready, pending, isAdmin]);
}
