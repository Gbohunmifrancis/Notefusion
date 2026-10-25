import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';
import { transcriptionsApi } from '../api/endpoints';
import { openConsole } from './adminConsole';
import { safeReason, toApiError } from '../api/client';
import { openStoreListing } from './appUpdate';
import { showDialog } from './dialog';
import { logAppEvent } from './appEvents';
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
 * How many transcriptions are being fetched to be opened right now. While any is, RootNavigator shows
 * `OpeningResult` over the screen, so the tap reads as opening it rather than as a stop on Home.
 */
let opening = 0;
const openingListeners = new Set<() => void>();

function setOpening(delta: number): void {
  opening = Math.max(0, opening + delta);
  openingListeners.forEach((l) => l());
}

/** True while a transcription is being fetched to be opened (a push tapped, or a take opened from the Library). */
export function useOpeningTranscription(): boolean {
  return useSyncExternalStore(
    (l) => {
      openingListeners.add(l);
      return () => openingListeners.delete(l);
    },
    () => opening > 0,
  );
}

/**
 * Opens the transcription behind a "ready" notification, as the same unsaved draft the record screen
 * would have shown. The result comes from our own API, which caches it — the ML service forgets a job
 * within minutes, and the whole point of the notification is that the user came back later.
 */
export async function openTranscriptionFromNotification(jobId: string): Promise<boolean> {
  // Counted before the first await, so the cover is up in the same frame as the tap.
  setOpening(1);
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

    if (!navigationRef.isReady()) return false;

    navigationRef.navigate('Result', {
      // Result synthesises its own player once it is on screen; the server's WAV is never played.
      result: { ...result, audioPreviewBase64: undefined },
      sourceJobId: jobId,
      fresh: true,
      openedFrom: 'notification',
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
  } finally {
    setOpening(-1);
  }
}

/**
 * Follows a notification's `data.screen` (`lib/navTargets` is the allow-list). A tab is nested in the root stack, so
 * it needs the nested form: `navigate('Practice')` would find no such route and do nothing. An admin place opens
 * Admin (behind its lock) on that tab, with the payment's sheet when the push named one; for anyone but an admin it
 * resolves to nothing.
 */
function openScreen(screen: string, opts: { isAdmin: boolean; paymentId?: string; userId?: string }): void {
  const target = notificationTarget(screen, opts);
  if (!target) return;
  if (target.kind === 'store') void openStoreListing();
  else if (target.kind === 'console') openConsole(target.path);
  else if (target.kind === 'tab') navigationRef.navigate('Tabs', { screen: target.tab });
  else if (target.kind === 'adminUser')
    // Not as Admin's first screen: its tabs stay under it, so back lands in Admin rather than leaving it.
    navigationRef.navigate('Admin', { screen: 'AdminUser', params: { userId: target.userId }, initial: false });
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
type PendingTap = { kind: 'job' | 'screen' | 'mute'; value: string; id?: string; paymentId?: string; userId?: string };

/**
 * How long a cold start waits to hear whether a notification launched it before showing the app. The answer is
 * usually there in a few milliseconds; the cap only stops a slow one from holding the splash.
 */
const COLD_TAP_WAIT_MS = 1200;

/**
 * What the notification taps mean for the screen. `checked`: whether a cold start has heard if a tap launched
 * it; until then RootNavigator keeps the splash up, so a tapped "ready" push never shows Home on the way.
 * `opening`: a tapped transcription is waiting to be opened (for the authenticated stack, or for its fetch),
 * which RootNavigator covers with `OpeningResult`.
 */
export type NotificationTapState = { checked: boolean; opening: boolean };

/**
 * Wires notification taps to the screens they refer to.
 *
 * @param ready Whether the authenticated stack is mounted. A tap that launched the app arrives while
 * the session is still being restored, and navigating then would target the sign-in stack — so taps
 * are held until this turns true rather than dropped.
 */
export function useNotificationDeepLink(ready: boolean, isAdmin = false): NotificationTapState {
  const [pending, setPending] = useState<PendingTap | null>(null);
  const [checked, setChecked] = useState(isExpoGo);
  const fetching = useOpeningTranscription();

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
      const data = request?.content?.data as
        | { jobId?: unknown; screen?: unknown; paymentId?: unknown; userId?: unknown }
        | undefined;
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
          userId: typeof data.userId === 'string' ? data.userId : undefined,
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
    const giveUp = setTimeout(() => setChecked(true), COLD_TAP_WAIT_MS);
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled || !response) return;
        if (Date.now() - response.notification.date > COLD_START_FRESH_MS) return;
        const tap = tapOf(response);
        if (tap) setPending(tap);
      })
      .catch(() => undefined)
      // The tap (if any) is pending before the app is shown, so the cover is up from the first frame.
      .finally(() => {
        clearTimeout(giveUp);
        if (!cancelled) setChecked(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(giveUp);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!ready || !pending) return;

    const key = `${pending.kind}:${pending.value}:${pending.id ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;
    setPending(null);
    // Once per tap (the key above): what was tapped, by its job id or the screen it names.
    logAppEvent('notification_tapped', {
      kind: pending.kind,
      screen: pending.kind === 'job' ? 'Result' : pending.value,
      job: pending.kind === 'job' ? pending.value : null,
    });

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
    if (navigationRef.isReady())
      openScreen(pending.value, { isAdmin, paymentId: pending.paymentId, userId: pending.userId });
  }, [ready, pending, isAdmin]);

  // A tapped transcription is covered from the tap to its screen; signed out, the sign-in screen stays visible
  // and the tap waits for the account.
  return { checked, opening: ready && (pending?.kind === 'job' || fetching) };
}
