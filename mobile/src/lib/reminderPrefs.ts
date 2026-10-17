/**
 * The practice reminder's choices and decisions, as plain functions (tests: reminderPrefs.test.ts). The reminders
 * themselves are the server's (C# `Application/Practice/Reminders`); `lib/practiceReminder` reads and writes them.
 */

/**
 * Chips rather than a time picker: a real one needs `@react-native-community/datetimepicker`,
 * which is a new native dependency and therefore a new build. Three presets cover morning,
 * afternoon and evening practice, which is the actual shape of the choice. The server takes any
 * hour from 8 to 21; these are the three the app offers.
 */
export type ReminderTime = "morning" | "afternoon" | "evening";

export const REMINDER_TIMES: { key: ReminderTime; label: string; hour: number }[] = [
  { key: "morning", label: "Morning", hour: 9 },
  { key: "afternoon", label: "Afternoon", hour: 14 },
  { key: "evening", label: "Evening", hour: 19 },
];

/** The server's default hour (C# `PracticeReminderRules.DefaultHour`). */
export const DEFAULT_REMINDER_HOUR = 19;

/** The chip an hour the server holds falls under: before noon morning, before five afternoon, else evening. */
export function timeForHour(hour: number): ReminderTime {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function hourFor(time: ReminderTime): number {
  return REMINDER_TIMES.find((t) => t.key === time)?.hour ?? DEFAULT_REMINDER_HOUR;
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
 * The Settings row's hint: which of the reasons it is off ("off because notifications are off" cannot be fixed
 * there; "off because you turned it off" can), or when it comes.
 */
export function describeReminder(on: boolean, hour: number, pushOn: boolean): string {
  if (!pushOn) return "Needs push notifications turned on.";
  if (!on) return "Off — nothing will nudge you to practise.";
  return `Around ${hour}:00 on days you haven't practised yet.`;
}
