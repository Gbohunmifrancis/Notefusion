import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { practiceApi } from '../api/endpoints';
import type { PracticeReminders } from '../api/types';
import { isExpoGo } from './env';
import {
  ensureRemindersChannel,
  getPushPermission,
  loadNotificationPrefs,
  registerForPushAsync,
  soundEnabled,
  REMINDER_CHANNEL_ID,
} from './push';
import { reminderSlot, type StreakSnapshot } from './practiceProgress';
import {
  DEFAULT_REMINDER_HOUR,
  carriedChoice,
  hourFor,
  reminderSetup,
  timeForHour,
} from './reminderPrefs';

/**
 * The daily "come and practise" reminder: sent by the server, by push.
 *
 * ── How it works now ─────────────────────────────────────────────────────────
 * The server keeps every singer's reminder (C# `Application/Practice/Reminders`): it knows their time zone
 * (`X-Time-Zone`, stored on the account) and their practice, and every ten minutes pushes whoever's moment has
 * come — at their hour on a day not yet practised, a "last chance" at 21:30 for a streak of three or more that
 * today would end, then a decaying 1/2/3/5/7/14/30 days after a lapse and a last "we'll stop reminding you". At
 * most two a day, never 22:00–08:00. A tap opens Practice (`data.screen`, `lib/notificationLink`).
 *
 * This file only reads and writes the account's choice (`GET`/`PUT /api/practice/reminders`: on/off, the hour,
 * and the sound switch synced from `lib/push`), tells the server this phone takes its reminders by push
 * (`devicesApi.register` sends `serverReminders: true`), and makes sure no reminder of the phone's own is left
 * scheduled, so nobody gets two.
 *
 * Why it moved: the reminder used to be 14 one-off local notifications re-topped whenever the app came forward,
 * so someone who did not open the app for a fortnight stopped hearing from it — exactly who a reminder is for.
 * A push needs no app open, and the server can follow the streak and the lapse as they happen.
 *
 * ── Old app code, and doubles ────────────────────────────────────────────────
 * Phones still on the code before this one schedule their own reminders. The server cannot tell them by the
 * native build (`appBuild`): this ships over the air and leaves that number as it was. So this code says so
 * itself — every push registration carries `serverReminders: true`, and it re-registers once a launch — and
 * the server sends only to devices that said it. An old phone keeps its own until the update lands; the first
 * launch on this code cancels them, and hands the server the switch and time chosen under them (`carriedChoice`):
 * the server turns reminders on by default for anyone who has practised, and someone who had switched them off
 * here must not find them back on.
 *
 * ── The fallback: when the server cannot be reached at set-up ───────────────
 * On a launch where `GET /api/practice/reminders` fails and the server has never answered on this install (the
 * first launch after the update, offline), the old on-device schedule below stands in, as before: 14 `DATE`
 * triggers from the last choice made on this phone (off unless it was turned on). The next launch that reaches
 * the server cancels them. Once the server has answered here, a failed read schedules nothing: it still pushes
 * (Expo holds a push for a phone that is offline), so a local copy would only be a second reminder
 * (`reminderSetup` in `reminderPrefs.ts`).
 *
 * Why 14 one-off triggers, in the fallback: a `DAILY` trigger has no individual occurrence, so there is nothing to
 * cancel when the user has already practised. Android schedules them inexactly (`SCHEDULE_EXACT_ALARM` is not
 * declared), so under Doze they can drift by minutes. Fine for a nudge.
 */

/** The cached switch and hour: the server's answer, or (before it ever answered) the choice made on this phone. */
const ENABLED_KEY = '@notefusion_reminder';
const TIME_KEY = '@notefusion_reminder_time';
const HOUR_KEY = '@notefusion_reminder_hour';
/** "server" once the server has answered on this install; from then on the phone schedules nothing of its own. */
const MODE_KEY = '@notefusion_reminder_mode';
const PRACTISED_KEY = '@notefusion_practised_on';
const STREAK_KEY = '@notefusion_streak';

/** Identifier prefix, so the local window can be found and cancelled without touching anything else. */
const ID_PREFIX = 'nf.practice.';

/** Days the fallback schedules ahead. */
const WINDOW_DAYS = 14;

/**
 * The fallback's words, rotated by day offset so consecutive days differ. The server's own (in Doh's voice) are
 * C# `PracticeReminderCopy`.
 */
const COPY: { title: string; body: string }[] = [
  { title: 'Time to practise', body: 'Play something and let NoteFusion write it down.' },
  { title: 'Got a minute?', body: 'One short recording is enough to keep your ear sharp.' },
  { title: 'Your keyboard misses you', body: 'Try a scale, or transcribe that tune in your head.' },
  { title: 'Practice makes solfa', body: 'Record a few bars and see them in doh-re-mi.' },
  { title: 'Keep the streak going', body: 'A couple of minutes today beats an hour on Sunday.' },
];

/** Until anything is read: off (the server's default for someone who has not practised), evening. */
let enabled = false;
let hour = DEFAULT_REMINDER_HOUR;
let serverAnsweredBefore = false;
/** The switch and time chosen under the old on-device reminders, handed to the server on its first answer here. */
let carried: Partial<PracticeReminders> | null = null;
let loaded: Promise<void> | null = null;
/** The fallback's window is scheduled this launch (so a new streak re-arms it). */
let fallbackArmed = false;
/** This launch has re-registered for push (with `serverReminders`), once. */
let registeredThisLaunch = false;

/** Reads the cached choice once. Every entry point awaits this. */
export function loadReminderPrefs(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const [on, when, at, mode] = await AsyncStorage.multiGet([ENABLED_KEY, TIME_KEY, HOUR_KEY, MODE_KEY]);
        if (on[1] !== null) enabled = on[1] === 'true';
        const stored = Number(at[1]);
        if (at[1] !== null && Number.isInteger(stored)) hour = stored;
        else if (when[1] === 'morning' || when[1] === 'afternoon' || when[1] === 'evening') hour = hourFor(when[1]);
        serverAnsweredBefore = mode[1] === 'server';
        carried = carriedChoice(on[1], when[1], mode[1]);
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

export function reminderHour(): number {
  return hour;
}

/** Keeps the server's answer: the cache Settings paints from, and proof the server takes care of reminders here. */
async function adopt(server: PracticeReminders): Promise<void> {
  enabled = server.enabled;
  hour = server.hour;
  serverAnsweredBefore = true;
  await AsyncStorage.multiSet([
    [ENABLED_KEY, String(server.enabled)],
    [HOUR_KEY, String(server.hour)],
    [TIME_KEY, timeForHour(server.hour)],
    [MODE_KEY, 'server'],
  ]).catch(() => undefined);
}

/**
 * Asks the server for the account's reminders and keeps the answer. False when it could not be reached; the
 * cached values stand.
 */
export async function refreshReminderPrefs(): Promise<boolean> {
  await loadReminderPrefs();
  try {
    await adopt(await readServer());
    return true;
  } catch {
    return false;
  }
}

/**
 * The account's reminders. On the server's first answer on this install, the choice made here under the old
 * on-device reminders (a "no" above all) is handed over first, so it becomes the account's rather than being
 * replaced by the server's default; a failed hand-over is tried again next time.
 */
async function readServer(): Promise<PracticeReminders> {
  if (!carried) return practiceApi.reminders();
  const answer = await practiceApi.setReminders(carried);
  carried = null;
  return answer;
}

/** The Notifications switch. False when the server did not take it (offline): the caller puts the switch back. */
export async function setReminderEnabled(on: boolean): Promise<boolean> {
  return saveReminders({ enabled: on });
}

/** The reminder-time sheet: any hour the server takes (8–21). False when the server did not take it. */
export async function setReminderHour(next: number): Promise<boolean> {
  return saveReminders({ hour: next });
}

/**
 * The app's notification sound switch, told to the server: with it off, reminders arrive silently (the quiet
 * Android channel, no iOS sound). Best effort; the next launch's set-up corrects a missed one.
 */
export async function syncReminderSound(on: boolean): Promise<void> {
  await saveReminders({ sound: on });
}

async function saveReminders(change: Partial<PracticeReminders>): Promise<boolean> {
  await loadReminderPrefs();
  try {
    // A choice still waiting to be handed over goes with it; what was just chosen wins.
    await adopt(await practiceApi.setReminders({ ...carried, ...change }));
    carried = null;
    await cancelWindow();
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date, `yyyy-mm-dd`. Local on purpose: "today" is the user's day, not UTC's. */
function dayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Records that the user practised today and drops today's fallback reminder if one is scheduled. The server
 * needs no telling: it sees the marked take itself.
 *
 * Fire-and-forget from the places that mean it — a marked take, a finished transcription, a saved free-play take.
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
 * Remembers the practice streak for the fallback's streak-day wording, and re-arms its window when the fallback
 * is what this launch runs on. Called after a progress read and after a marked take.
 */
export async function rememberStreak(snapshot: StreakSnapshot): Promise<void> {
  const json = JSON.stringify(snapshot);
  // Home reads progress on every focus; only a changed streak is worth a write.
  if (json === lastStreakJson) return;
  lastStreakJson = json;
  await AsyncStorage.setItem(STREAK_KEY, json).catch(() => undefined);
  if (fallbackArmed) await armFallback();
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
 * The set-up, on mount and every time the app comes forward: the server's reminders if it answers (cancelling
 * anything the phone scheduled, re-registering this phone once a launch so the server knows it takes server
 * reminders, and syncing the sound switch), else the fallback — see the header.
 */
export async function syncReminders(): Promise<void> {
  if (isExpoGo) return;
  await loadReminderPrefs();
  const answeredBefore = serverAnsweredBefore;

  let server: PracticeReminders | null = null;
  try {
    server = await readServer();
  } catch {
    server = null;
  }

  const setup = reminderSetup(server !== null, answeredBefore);
  if (setup === 'local') {
    await armFallback();
    return;
  }

  fallbackArmed = false;
  await cancelWindow();
  if (!server) return;

  await adopt(server);
  if (!registeredThisLaunch) {
    registeredThisLaunch = true;
    // Honours the push switch and never prompts: a phone with notifications off stays unregistered.
    void registerForPushAsync().catch(() => undefined);
  }
  await loadNotificationPrefs();
  if (server.sound !== soundEnabled()) void syncReminderSound(soundEnabled());
}

/**
 * The fallback: rebuilds the 14-day local window from the cached choice. Idempotent — it cancels the existing
 * requests first and the identifiers are derived from the dates. Schedules nothing when the switch is off, on
 * Expo Go, or without notification permission.
 */
async function armFallback(): Promise<void> {
  if (isExpoGo) return;
  await loadReminderPrefs();

  let Notifications: typeof import('expo-notifications');
  try {
    Notifications = require('expo-notifications') as typeof import('expo-notifications');
  } catch {
    return;
  }

  await cancelWindow();
  fallbackArmed = true;
  if (!enabled) return;
  if ((await getPushPermission()) !== 'granted') return;

  await ensureRemindersChannel();

  const skipToday = await practisedToday();
  const streak = await streakSnapshot();
  const now = new Date();

  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    const when = new Date(now);
    when.setDate(when.getDate() + offset);
    const slot = reminderSlot(dayKey(when), hour, streak, COPY[offset % COPY.length]!);
    when.setHours(slot.hour, 0, 0, 0);

    // Today's slot has already passed, or today is already done: scheduling a past date would fire it at once.
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

/** Coming forward re-reads the reminder settings at most this often: they change on this phone or in Settings. */
const FOREGROUND_SYNC_MS = 10 * 60_000;

/**
 * Keeps the reminders set up: on mount and when the app returns to the foreground, at most once per
 * `FOREGROUND_SYNC_MS` (one small read; the re-registration runs once a launch).
 *
 * @param ready Whether the authenticated app is mounted. Nothing to remind a signed-out user of.
 */
export function useReminderSync(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;

    let lastSync = Date.now();
    void syncReminders();

    const sub = AppState.addEventListener('change', (status) => {
      if (status !== 'active' || Date.now() - lastSync < FOREGROUND_SYNC_MS) return;
      lastSync = Date.now();
      void syncReminders();
    });
    return () => sub.remove();
  }, [ready]);
}

/**
 * Cancels only this feature's local requests, matched on the identifier prefix. Not
 * `cancelAllScheduledNotificationsAsync` — that would also take out anything else the app ever schedules.
 */
async function cancelWindow(): Promise<void> {
  if (isExpoGo) return;
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined)),
    );
  } catch {
    // Cannot read the schedule. Scheduling the same identifier again replaces it, so the fallback cannot double.
  }
}
