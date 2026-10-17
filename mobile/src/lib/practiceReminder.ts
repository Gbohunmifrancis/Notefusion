import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isExpoGo } from './env';
import { ensureRemindersChannel, getPushPermission, REMINDER_CHANNEL_ID } from './push';
import { reminderSlot, type StreakSnapshot } from './practiceProgress';

/**
 * The daily "come and practise" nudge.
 *
 * ── Why this is local and not a push ─────────────────────────────────────────
 * A server-driven reminder would need every user's timezone, a per-user schedule, and a push
 * quota spent on a message nobody asked for by name. The device already knows what time it
 * is where it is, so the whole feature is `scheduleNotificationAsync` and some bookkeeping.
 *
 * ── Why 14 one-off triggers instead of one DAILY trigger ─────────────────────
 * A `DAILY` trigger has no individual occurrence: there is nothing to cancel when the user
 * has already practised today. `setNotificationHandler` cannot save it either — that governs
 * *foreground* presentation only, and a reminder delivered while the app is closed shows
 * regardless. So the window is 14 separate `DATE` triggers, re-topped every time the app
 * comes forward, and skipping a day is just not scheduling that one.
 *
 * **The trade-off, plainly:** someone who does not open the app for 14 days stops being
 * reminded until they do. There is no server to fall back on. It is arguably the right
 * behaviour — a fortnight of ignored nudges is what earns an uninstall — but it is a real
 * difference from a server-driven reminder, and the reason to revisit this if retention asks.
 *
 * ── The streak ───────────────────────────────────────────────────────────────
 * On the day a practice streak is at risk (`rememberStreak`, from the last progress read or marked take),
 * that day's one reminder is about it instead — "Keep your 4-day streak — today's drill takes 2 minutes"
 * — in the evening (the chosen hour or 19:00, whichever is later), and a tap opens Practice. Still one
 * a day, still only when the switch is on, and practising cancels it like any other day's.
 *
 * Android schedules these inexactly (`SCHEDULE_EXACT_ALARM` is not declared, and declaring it
 * is a native change plus a Play policy justification), so under Doze the delivery can drift
 * by minutes. Fine for a nudge.
 */

const ENABLED_KEY = '@notefusion_reminder';
const TIME_KEY = '@notefusion_reminder_time';
const PRACTISED_KEY = '@notefusion_practised_on';
const STREAK_KEY = '@notefusion_streak';

/** Identifier prefix, so the window can be found and cancelled without touching anything else. */
const ID_PREFIX = 'nf.practice.';

/** Days scheduled ahead. See the trade-off note above. */
const WINDOW_DAYS = 14;

/**
 * Chips rather than a time picker: a real one needs `@react-native-community/datetimepicker`,
 * which is a new native dependency and therefore a new build. Three presets cover morning,
 * afternoon and evening practice, which is the actual shape of the choice.
 */
export type ReminderTime = 'morning' | 'afternoon' | 'evening';

export const REMINDER_TIMES: { key: ReminderTime; label: string; hour: number }[] = [
  { key: 'morning', label: 'Morning', hour: 9 },
  { key: 'afternoon', label: 'Afternoon', hour: 14 },
  { key: 'evening', label: 'Evening', hour: 19 },
];

/**
 * Rotated by day offset so consecutive days differ. A nudge that arrives word-for-word
 * identical every evening reads as a malfunction, and is the first thing a user turns off.
 */
const COPY: { title: string; body: string }[] = [
  { title: 'Time to practise', body: 'Play something and let NoteFusion write it down.' },
  { title: 'Got a minute?', body: 'One short recording is enough to keep your ear sharp.' },
  { title: 'Your keyboard misses you', body: 'Try a scale, or transcribe that tune in your head.' },
  { title: 'Practice makes solfa', body: 'Record a few bars and see them in doh-re-mi.' },
  { title: 'Keep the streak going', body: 'A couple of minutes today beats an hour on Sunday.' },
];

/** Defaults: off, and evening if it ever gets turned on. Nobody is opted in to a daily alarm. */
let enabled = false;
let time: ReminderTime = 'evening';
let loaded: Promise<void> | null = null;

/** Reads the two preferences once. Every entry point awaits this. */
export function loadReminderPrefs(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const [on, when] = await AsyncStorage.multiGet([ENABLED_KEY, TIME_KEY]);
        if (on[1] !== null) enabled = on[1] === 'true';
        if (when[1] === 'morning' || when[1] === 'afternoon' || when[1] === 'evening') {
          time = when[1];
        }
      } catch {
        // Unreadable preferences just mean the defaults, which are "off".
      }
    })();
  }
  return loaded;
}

export function reminderEnabled(): boolean {
  return enabled;
}

export function reminderTime(): ReminderTime {
  return time;
}

export function reminderHour(): number {
  return REMINDER_TIMES.find((t) => t.key === time)?.hour ?? 19;
}

export async function setReminderEnabled(on: boolean): Promise<void> {
  await loadReminderPrefs();
  enabled = on;
  await AsyncStorage.setItem(ENABLED_KEY, String(on)).catch(() => undefined);
  await armReminders();
}

export async function setReminderTime(next: ReminderTime): Promise<void> {
  await loadReminderPrefs();
  time = next;
  await AsyncStorage.setItem(TIME_KEY, next).catch(() => undefined);
  await armReminders();
}

/** Local calendar date, `yyyy-mm-dd`. Local on purpose: "today" is the user's day, not UTC's. */
function dayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Records that the user practised today and drops today's reminder if it has not fired yet.
 *
 * Fire-and-forget from the two places that mean it — a finished transcription and a saved
 * free-play take. Cheaper than a full re-arm, which is why it is not one: this is the hot path.
 */
export async function markPractisedToday(): Promise<void> {
  const today = dayKey(new Date());
  await AsyncStorage.setItem(PRACTISED_KEY, today).catch(() => undefined);

  if (isExpoGo) return;
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.cancelScheduledNotificationAsync(`${ID_PREFIX}${today}`);
  } catch {
    // Nothing scheduled for today, or already delivered. Either way there is nothing to cancel.
  }
}

/**
 * Remembers the practice streak for tomorrow's (or tonight's) reminder and re-arms the window, so the day it
 * is at risk gets the streak copy. Called after a progress read and after a marked take.
 */
export async function rememberStreak(snapshot: StreakSnapshot): Promise<void> {
  const json = JSON.stringify(snapshot);
  // Home reads progress on every focus; only a changed streak is worth a re-arm.
  if (json === lastStreakJson) return;
  lastStreakJson = json;
  await AsyncStorage.setItem(STREAK_KEY, json).catch(() => undefined);
  await armReminders();
}

let lastStreakJson: string | null = null;

async function streakSnapshot(): Promise<StreakSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(STREAK_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StreakSnapshot>) : null;
    if (!parsed || typeof parsed.streak !== 'number') return null;
    return { streak: parsed.streak, riskDay: typeof parsed.riskDay === 'string' ? parsed.riskDay : null };
  } catch {
    return null;
  }
}

async function practisedToday(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRACTISED_KEY)) === dayKey(new Date());
  } catch {
    return false;
  }
}

/**
 * Rebuilds the whole window. Idempotent — running it twice leaves the same 14 requests, because
 * it cancels the existing ones first and the identifiers are derived from the dates.
 *
 * Bails (having cancelled everything) when the toggle is off, on Expo Go, or when notification
 * permission is not granted. That last one matters: a local notification needs the same
 * permission a push does, so scheduling without it silently produces nothing.
 */
export async function armReminders(): Promise<void> {
  if (isExpoGo) return;
  await loadReminderPrefs();

  let Notifications: typeof import('expo-notifications');
  try {
    Notifications = require('expo-notifications') as typeof import('expo-notifications');
  } catch {
    return;
  }

  await cancelWindow(Notifications);
  if (!enabled) return;
  if ((await getPushPermission()) !== 'granted') return;

  await ensureRemindersChannel();

  const hour = reminderHour();
  const skipToday = await practisedToday();
  const streak = await streakSnapshot();
  const now = new Date();

  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    const when = new Date(now);
    when.setDate(when.getDate() + offset);
    const slot = reminderSlot(dayKey(when), hour, streak, COPY[offset % COPY.length]!);
    when.setHours(slot.hour, 0, 0, 0);

    // Today's slot has already passed, or today is already done. Either way there is nothing
    // to say — scheduling a past date would fire it immediately, which is the opposite.
    if (when.getTime() <= now.getTime()) continue;
    if (offset === 0 && skipToday) continue;

    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${ID_PREFIX}${dayKey(when)}`,
        content: {
          title: slot.title,
          body: slot.body,
          data: { screen: slot.screen },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
          channelId: REMINDER_CHANNEL_ID,
        },
      });
    } catch {
      // One day failing to schedule is not worth abandoning the other thirteen.
    }
  }
}

/**
 * Keeps the window topped up: re-arms on mount and every time the app returns to the
 * foreground.
 *
 * Without this the 14 days would simply run down. Re-arming is a schedule read plus at most 14
 * cheap native calls, and it only happens on a foreground transition, so running it every time
 * is cheaper than tracking when it last ran.
 *
 * @param ready Whether the authenticated app is mounted. Nothing to remind a signed-out user of.
 */
export function useReminderWindow(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;

    void armReminders();

    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') void armReminders();
    });
    return () => sub.remove();
  }, [ready]);
}

/**
 * Cancels only this feature's requests, matched on the identifier prefix. Not
 * `cancelAllScheduledNotificationsAsync` — that would also take out anything else the app ever
 * schedules, and a reminder re-arm has no business touching another feature's notifications.
 */
async function cancelWindow(
  Notifications: typeof import('expo-notifications'),
): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined)),
    );
  } catch {
    // Cannot read the schedule. Re-arming would then risk duplicates, so the caller's
    // identifier reuse is the backstop: scheduling the same id twice replaces it.
  }
}
