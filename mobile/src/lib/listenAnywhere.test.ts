import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_TAKE_SECONDS,
  PRO_TAKE_SECONDS,
  SETUP_STEPS,
  canStartTake,
  formatTakeCap,
  groupNote,
  KIND_CHOICES,
  kindLabel,
  takeSubmitOptions,
  listenAllowance,
  nextSetupStep,
  noneLeftLine,
  pillLine,
  setupButtonLabel,
  setupDone,
  sourceLabel,
  type AllowanceSource,
} from "./listenAnywhere.ts";

const FREE: AllowanceSource = { isPro: false, known: true, freeRemaining: 2, freePerWeek: 3, freeBack: "Friday 6pm", boughtRemaining: 0 };

test("the allowance the overlay reads: free, bought, Pro and not yet known", () => {
  const free = listenAllowance(FREE);
  assert.deepEqual(free, { freeLeft: 2, freePerWeek: 3, boughtLeft: 0, capSeconds: FREE_TAKE_SECONDS, back: "Friday 6pm", isPro: false, known: true });
  assert.equal(canStartTake(free), true);
  assert.equal(pillLine(free), "Free: 2 of 3 left this week · up to 3:00");

  const none = listenAllowance({ ...FREE, freeRemaining: 0 });
  assert.equal(canStartTake(none), false, "no free one and no bought one: the take does not start");
  assert.equal(noneLeftLine(none), "No free transcriptions left this week — back on Friday 6pm");

  const bought = listenAllowance({ ...FREE, freeRemaining: 0, boughtRemaining: 1 });
  assert.equal(canStartTake(bought), true);
  assert.equal(pillLine(bought), "1 bought left · up to 3:00", "a bought one is spent only when the free ones are gone");

  const pro = listenAllowance({ ...FREE, isPro: true, boughtRemaining: 4 });
  assert.equal(pro.capSeconds, PRO_TAKE_SECONDS);
  assert.equal(pro.boughtLeft, 0, "Pro spends no bought ones");
  assert.equal(pillLine(pro), "Up to 6:00 · sends when you stop");

  const unknown = listenAllowance({ ...FREE, known: false, freeRemaining: 0 });
  assert.equal(canStartTake(unknown), true, "the server not heard from: nothing is refused on a guess (the gates fail open too)");
  assert.equal(pillLine(unknown), "Up to 3:00 · sends when you stop");
});

test("the caps and the Settings note", () => {
  assert.equal(formatTakeCap(180), "3:00");
  assert.equal(formatTakeCap(360), "6:00");
  assert.equal(formatTakeCap(65), "1:05");
  assert.equal(groupNote(listenAllowance(FREE)), "Each take is a transcription, like one from the Record screen. Free: 3 a week, up to 3:00 each, from the tile. The floating button and the notification are part of Pro.");
  assert.equal(groupNote(listenAllowance({ ...FREE, isPro: true })), "Each take is a transcription, like one from the Record screen. Pro: up to 6:00 each, no weekly limit. It stops by itself when the music does.");
  assert.equal(sourceLabel("room"), "The room");
  assert.equal(sourceLabel("phone"), "This phone’s sound");
});

test("setup goes microphone, notifications, display over other apps, and the button names the next one", () => {
  assert.deepEqual(SETUP_STEPS.map((s) => s.step), ["mic", "notifications", "overlay"]);
  const none = { mic: false, notifications: false, overlay: false };
  assert.equal(nextSetupStep(none), "mic");
  assert.equal(setupButtonLabel(none), "Allow microphone");
  assert.equal(setupButtonLabel({ ...none, mic: true }), "Allow notifications");
  assert.equal(setupButtonLabel({ ...none, mic: true, notifications: true }), "Open settings");
  // Given out of order (notifications already allowed from a push), the sheet still asks for the first missing one.
  assert.equal(nextSetupStep({ mic: false, notifications: true, overlay: true }), "mic");
  const all = { mic: true, notifications: true, overlay: true };
  assert.equal(nextSetupStep(all), null);
  assert.equal(setupDone(all), true);
  assert.equal(setupButtonLabel(all), "Done");
});

test("a Listen take is sent as what it was taken for, and Singing carries the chords safety net", () => {
  assert.deepEqual(takeSubmitOptions("melody"), { mode: "melody", noVoiceAsChords: true });
  assert.deepEqual(takeSubmitOptions("poly"), { mode: "poly" });
  assert.deepEqual(takeSubmitOptions("chords"), { mode: "chords" });
  // Older native builds send no kind: Singing, as every take was before.
  assert.deepEqual(takeSubmitOptions(undefined), { mode: "melody", noVoiceAsChords: true });
  assert.deepEqual(takeSubmitOptions("nonsense"), { mode: "melody", noVoiceAsChords: true });
});

test("a take swept in later is sent as the kind its file name carries", () => {
  assert.deepEqual(takeSubmitOptions(undefined, "take-1767225600000-chords.m4a"), { mode: "chords" });
  assert.deepEqual(takeSubmitOptions(undefined, "take-1767225600000-poly.m4a"), { mode: "poly" });
  assert.deepEqual(takeSubmitOptions(undefined, "take-1767225600000.m4a"), { mode: "melody", noVoiceAsChords: true });
  // What the native side said wins over the name.
  assert.deepEqual(takeSubmitOptions("melody", "take-1-chords.m4a"), { mode: "melody", noVoiceAsChords: true });
});

test("the Listen-for choices step Singing, Instrument, Chords", () => {
  assert.deepEqual(KIND_CHOICES.map((k) => k.kind), ["melody", "poly", "chords"]);
  assert.equal(kindLabel("poly"), "Instrument");
  assert.equal(kindLabel(undefined), "Singing");
});

