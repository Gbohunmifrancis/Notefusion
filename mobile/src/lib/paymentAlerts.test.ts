import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHIME_FILE,
  DEFAULT_PAYMENT_ALERTS,
  PAYMENTS_CHANNEL,
  PAYMENTS_QUIET_CHANNEL,
  PAYMENT_PROBLEMS_CHANNEL,
  channelFor,
  PAYMENT_CHANNEL_VERSION,
  quietChannel,
  channelsToDelete,
  channelsToKeep,
  isQuietHour,
  mutedLine,
  readPrefs,
} from "./paymentAlerts.ts";

test("the channel ids are the server's (C# PaymentAlertChannels), one per sound and vibration", () => {
  assert.equal(channelFor("chime", true), "payments-v1");
  assert.equal(channelFor("chime", false), "payments-v1-chime-still");
  assert.equal(channelFor("phone", true), "payments-v1-phone");
  assert.equal(channelFor("phone", false), "payments-v1-phone-still");
  assert.equal(channelFor("none", true), "payments-v1-none");
  assert.equal(channelFor("none", false), "payments-v1-none-still");
  assert.equal(PAYMENTS_CHANNEL, "payments-v1");
  assert.equal(PAYMENTS_QUIET_CHANNEL, "payments-v1-none-still");
  assert.equal(PAYMENT_PROBLEMS_CHANNEL, "payment-problems");
  // Apart from the ready and practice channels.
  for (const id of [PAYMENTS_CHANNEL, PAYMENTS_QUIET_CHANNEL, PAYMENT_PROBLEMS_CHANNEL]) {
    assert.ok(!["default", "reminders", "reminders-quiet"].includes(id));
  }
});

test("an admin phone starts loud: the chime and pulses, names shown, quiet at night off", () => {
  assert.deepEqual(DEFAULT_PAYMENT_ALERTS, {
    on: true,
    sound: "chime",
    vibrate: true,
    quietAtNight: false,
    hideNames: false,
    problems: true,
  });
});

test("the phone keeps the chosen channel and the quiet one, and deletes the rest", () => {
  const keep = channelsToKeep({ sound: "chime", vibrate: true });
  assert.deepEqual(keep, [
    { id: "payments-v1", name: "Payments", sound: CHIME_FILE, vibrate: true },
    { id: "payments-v1-none-still", name: "Payments · quiet", sound: null, vibrate: false },
  ]);
  assert.deepEqual(channelsToKeep({ sound: "phone", vibrate: false }).map((c) => [c.id, c.name, c.sound]), [
    ["payments-v1-phone-still", "Payments · phone's sound · no vibration", undefined],
    ["payments-v1-none-still", "Payments · quiet", null],
  ]);
  assert.deepEqual(channelsToKeep({ sound: "none", vibrate: false }).map((c) => c.id), ["payments-v1-none-still"]);

  const existing = ["default", "reminders", "payment-problems", "payments-v1", "payments-v1-phone", "payments-v1-none-still"];
  assert.deepEqual(channelsToDelete(existing, keep), ["payments-v1-phone"]);
});

test("the quiet hours run from 22:00 to 07:00 on the phone's clock", () => {
  assert.equal(isQuietHour(21), false);
  assert.equal(isQuietHour(22), true);
  assert.equal(isQuietHour(3), true);
  assert.equal(isQuietHour(6), true);
  assert.equal(isQuietHour(7), false);
  assert.equal(isQuietHour(18), false);
});

test("stored choices are read field by field, falling back to the defaults", () => {
  assert.deepEqual(readPrefs(null), DEFAULT_PAYMENT_ALERTS);
  assert.deepEqual(readPrefs({ sound: "loud", on: "yes", hideNames: true }), { ...DEFAULT_PAYMENT_ALERTS, hideNames: true });
  assert.deepEqual(readPrefs({ ...DEFAULT_PAYMENT_ALERTS, sound: "none", vibrate: false }), {
    ...DEFAULT_PAYMENT_ALERTS,
    sound: "none",
    vibrate: false,
  });
});

test("a mute is said in the phone's time until it has passed", () => {
  const now = new Date(2026, 9, 18, 18, 42);
  const until = new Date(2026, 9, 18, 19, 42);
  assert.equal(mutedLine(until.toISOString(), now), "Muted until 19:42: banners, no sound");
  assert.equal(mutedLine(new Date(2026, 9, 18, 18, 0).toISOString(), now), null);
  assert.equal(mutedLine(null, now), null);
  assert.equal(mutedLine("not a date", now), null);
});


test("this code makes channels of its own, v2, with the chime; older code's v1 ids are as they were", () => {
  assert.equal(PAYMENT_CHANNEL_VERSION, 2);
  assert.equal(channelFor("chime", true, 2), "payments-v2");
  assert.equal(channelFor("phone", false, 2), "payments-v2-phone-still");
  assert.equal(quietChannel(2), "payments-v2-none-still");
  const keep = channelsToKeep({ sound: "chime", vibrate: true }, 2);
  assert.deepEqual(keep.map((c) => [c.id, c.sound]), [["payments-v2", "payment.wav"], ["payments-v2-none-still", null]]);
  // The broken v1 channels are deleted once a v2 build makes its own.
  assert.deepEqual(channelsToDelete(["payments-v1", "payments-v1-none-still", "payment-problems", "payments-v2"], keep),
    ["payments-v1", "payments-v1-none-still"]);
});
