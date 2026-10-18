import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REMINDER_HOUR,
  REMINDER_HOUR_GROUPS,
  REMINDER_TIMES,
  carriedChoice,
  describeReminder,
  hourFor,
  hourLabel,
  isReminderHour,
  reminderMovedLine,
  reminderSetup,
  timeForHour,
} from "./reminderPrefs.ts";

test("the sheet offers every hour the server takes, 8am to 9pm, and nothing else", () => {
  assert.deepEqual(REMINDER_TIMES, [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.ok(REMINDER_TIMES.includes(DEFAULT_REMINDER_HOUR));
  assert.equal(DEFAULT_REMINDER_HOUR, 19);
  for (const h of REMINDER_TIMES) assert.ok(isReminderHour(h));
  assert.equal(isReminderHour(7), false);
  assert.equal(isReminderHour(22), false);
  assert.equal(isReminderHour(9.5), false);
});

test("the hours sit in three rows: morning to 11am, afternoon to 4pm, evening to 9pm", () => {
  assert.deepEqual(
    REMINDER_HOUR_GROUPS.map((g) => [g.label, g.hours.map(hourLabel)]),
    [
      ["Morning", ["8am", "9am", "10am", "11am"]],
      ["Afternoon", ["12pm", "1pm", "2pm", "3pm", "4pm"]],
      ["Evening", ["5pm", "6pm", "7pm", "8pm", "9pm"]],
    ],
  );
  assert.deepEqual(REMINDER_HOUR_GROUPS.flatMap((g) => g.hours), REMINDER_TIMES);
});

test("hours are written like the free-week line, and the toast names the new one", () => {
  assert.equal(hourLabel(0), "12am");
  assert.equal(hourLabel(8), "8am");
  assert.equal(hourLabel(12), "12pm");
  assert.equal(hourLabel(18), "6pm");
  assert.equal(hourLabel(21), "9pm");
  assert.equal(reminderMovedLine(18), "Reminders moved to 6pm");
});

test("an hour stored by older app code shows under the preset it falls in", () => {
  assert.equal(timeForHour(8), "morning");
  assert.equal(timeForHour(11), "morning");
  assert.equal(timeForHour(12), "afternoon");
  assert.equal(timeForHour(16), "afternoon");
  assert.equal(timeForHour(17), "evening");
  assert.equal(timeForHour(21), "evening");
  assert.equal(hourFor("morning"), 9);
  assert.equal(hourFor("afternoon"), 14);
  assert.equal(hourFor("evening"), DEFAULT_REMINDER_HOUR);
});

test("the server keeps the reminders once it has answered, and the phone's own schedule is only the first-launch fallback", () => {
  assert.equal(reminderSetup(true, false), "server");
  assert.equal(reminderSetup(true, true), "server");
  // Offline now, but the server has answered on this install before: it still pushes, so nothing is scheduled here.
  assert.equal(reminderSetup(false, true), "none");
  // Never reached: the old on-device schedule stands in.
  assert.equal(reminderSetup(false, false), "local");
});

test("a choice made under the old on-device reminders is handed to the server once, and a stored no stays no", () => {
  assert.deepEqual(carriedChoice("false", null, null), { enabled: false });
  assert.deepEqual(carriedChoice("true", "morning", null), { enabled: true, hour: 9 });
  assert.deepEqual(carriedChoice(null, "afternoon", null), { hour: 14 });
  // Never touched: nothing to carry, the server's default stands.
  assert.equal(carriedChoice(null, null, null), null);
  // Once the server has answered here, the stored values are its own.
  assert.equal(carriedChoice("false", "morning", "server"), null);
});

test("the reminder row says why it is off, or when it comes", () => {
  assert.equal(describeReminder(true, false), "Needs push notifications");
  assert.equal(describeReminder(false, false), "Needs push notifications");
  assert.equal(describeReminder(false, true), "Off. Nothing will nudge you to practise.");
  assert.equal(describeReminder(true, true), "On days you haven't practised yet");
});
