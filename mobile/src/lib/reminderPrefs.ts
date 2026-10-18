/**
 * The practice reminder's choices and decisions, as plain functions (tests: reminderPrefs.test.ts). The reminders
 * themselves are the server's (C# `Application/Practice/Reminders`); `lib/practiceReminder` reads and writes them.
 */

/** The first and last hour the server takes (C# `PracticeReminderRules`): 8am to 9pm, the singer's own time. */
export const FIRST_REMINDER_HOUR = 8;
export const LAST_REMINDER_HOUR = 21;

/**
 * Every hour the server takes, as the reminder-time sheet offers them: plain buttons drawn in JavaScript, so it
 * ships over the air (a real time picker needs `@react-native-community/datetimepicker`, a new native module, and
 * offers minutes the server ignores).
 */
export const REMINDER_TIMES: number[] = Array.from(
  { length: LAST_REMINDER_HOUR - FIRST_REMINDER_HOUR + 1 },
  (_, i) => FIRST_REMINDER_HOUR + i,
);

/** The sheet's three rows: morning to 11am, afternoon to 4pm, evening to 9pm. */
export const REMINDER_HOUR_GROUPS: { label: "Morning" | "Afternoon" | "Evening"; hours: number[] }[] = [
  { label: "Morning", hours: REMINDER_TIMES.filter((h) => h < 12) },
  { label: "Afternoon", hours: REMINDER_TIMES.filter((h) => h >= 12 && h < 17) },
  { label: "Evening", hours: REMINDER_TIMES.filter((h) => h >= 17) },
];

/** The server's default hour (C# `PracticeReminderRules.DefaultHour`). */
export const DEFAULT_REMINDER_HOUR = 19;

export function isReminderHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= FIRST_REMINDER_HOUR && hour <= LAST_REMINDER_HOUR;
}

/** An hour as the app writes times elsewhere ("back Friday 6pm"): 8am, 12pm, 6pm. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${h < 12 ? "am" : "pm"}`;
}

/** The toast after a new hour is saved. */
export function reminderMovedLine(hour: number): string {
  return `Reminders moved to ${hourLabel(hour)}`;
}

/**
 * The three presets the app offered before the hour sheet ("morning" 9:00, "afternoon" 14:00, "evening" 19:00).
 * Still read from what older app code stored on the phone, and handed to the server once (`carriedChoice`).
 */
export type ReminderTime = "morning" | "afternoon" | "evening";

const PRESET_HOURS: Record<ReminderTime, number> = { morning: 9, afternoon: 14, evening: 19 };

/** The preset an hour the server holds falls under: before noon morning, before five afternoon, else evening. */
export function timeForHour(hour: number): ReminderTime {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function hourFor(time: ReminderTime): number {
  return PRESET_HOURS[time] ?? DEFAULT_REMINDER_HOUR;
}

/**
 * How this launch's reminders are kept:
 * - `server`: the server answered — it pushes the reminders, and the phone schedules none of its own;
 * - `none`: it did not answer now, but has before on this install — the server still pushes (Expo holds a push
 *   for a phone that is offline), so scheduling here too would only double them;
 * - `local`: it has never answered on this install (the first launch after the update, offline) — the old
 *   on-device schedule stands in until it does.
 */
export type ReminderSetup = "server" | "none" | "local";

export function reminderSetup(serverAnswered: boolean, answeredBefore: boolean): ReminderSetup {
  if (serverAnswered) return "server";
  return answeredBefore ? "none" : "local";
}

/**
 * The choice made on this phone under the old on-device reminders, to hand to the server once: the switch and
 * the time as stored, but only while the server has never answered here (after that the stored values are the
 * server's own). The old switch was stored only when someone touched it, so a stored "false" is a real "no" —
 * and the server, which turns reminders on by default for anyone who has practised, must hear it.
 */
export function carriedChoice(
  storedEnabled: string | null,
  storedTime: string | null,
  mode: string | null,
): { enabled?: boolean; hour?: number } | null {
  if (mode === "server") return null;
  const choice: { enabled?: boolean; hour?: number } = {};
  if (storedEnabled === "true" || storedEnabled === "false") choice.enabled = storedEnabled === "true";
  if (storedTime === "morning" || storedTime === "afternoon" || storedTime === "evening") choice.hour = hourFor(storedTime);
  return Object.keys(choice).length > 0 ? choice : null;
}

/**
 * The Practice reminder row's hint (Notifications): why it is off when that cannot be fixed there ("needs push"),
 * or when it comes. The hour is the Reminder time row's.
 */
export function describeReminder(on: boolean, pushLive: boolean): string {
  if (!pushLive) return "Needs push notifications";
  if (!on) return "Off. Nothing will nudge you to practise.";
  return "On days you haven't practised yet";
}
