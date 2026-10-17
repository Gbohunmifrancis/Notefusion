import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REMINDER_HOUR,
  REMINDER_TIMES,
  carriedChoice,
  describeReminder,
  hourFor,
  reminderSetup,
  timeForHour,
} from "./reminderPrefs.ts";

test("the three chips are hours the server accepts, and the evening one is its default", () => {
  for (const t of REMINDER_TIMES) assert.ok(t.hour >= 8 && t.hour <= 21, `${t.key} at ${t.hour}`);
  assert.equal(hourFor("evening"), DEFAULT_REMINDER_HOUR);
  assert.equal(DEFAULT_REMINDER_HOUR, 19);
});

test("any hour the server holds shows under the chip it falls in", () => {
  assert.equal(timeForHour(8), "morning");
  assert.equal(timeForHour(11), "morning");
  assert.equal(timeForHour(12), "afternoon");
  assert.equal(timeForHour(16), "afternoon");
  assert.equal(timeForHour(17), "evening");
  assert.equal(timeForHour(21), "evening");
  for (const t of REMINDER_TIMES) assert.equal(timeForHour(t.hour), t.key);
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

test("the Settings hint says why it is off, or when it comes", () => {
  assert.equal(describeReminder(true, 19, false), "Needs push notifications turned on.");
  assert.equal(describeReminder(false, 19, true), "Off — nothing will nudge you to practise.");
  assert.equal(describeReminder(true, 9, true), "Around 9:00 on days you haven't practised yet.");
});
