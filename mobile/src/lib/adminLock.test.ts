import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDLE_LOCK_MS,
  LOCKED,
  RELOCK_AFTER_MS,
  cleanCode,
  idleExpired,
  isUnlocked,
  lockMethod,
  lockReducer,
  lockedFootnote,
  lockedLine,
  lockedTitle,
  type LockState,
} from "./adminLock.ts";

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 18, 17, 40);

function run(events: Parameters<typeof lockReducer>[1][], from: LockState = LOCKED): LockState {
  return events.reduce(lockReducer, from);
}

test("Admin starts locked and opens only when the phone's lock says so", () => {
  assert.equal(isUnlocked(LOCKED, T0), false);
  const open = run([{ type: "unlock", at: T0 }]);
  assert.equal(isUnlocked(open, T0 + 10 * MIN), true, "no timer while it is in front");
});

test("back within the hour: still open, where it was", () => {
  const s = run([
    { type: "unlock", at: T0 },
    { type: "background", at: T0 },
    { type: "foreground", at: T0 + 3 * MIN },
  ]);
  assert.equal(isUnlocked(s, T0 + 3 * MIN), true);
  assert.equal(s.awayAt, null);
});

test("back after an hour or more: locked before the first frame", () => {
  const away = run([
    { type: "unlock", at: T0 },
    { type: "background", at: T0 },
  ]);
  // Still away, past the line: already locked, even before the app comes back.
  assert.equal(isUnlocked(away, T0 + RELOCK_AFTER_MS), false);
  assert.equal(isUnlocked(away, T0 + RELOCK_AFTER_MS - 1), true);

  const back = lockReducer(away, { type: "foreground", at: T0 + 61 * MIN });
  assert.deepEqual(back, LOCKED);
});

test("the away clock starts at the first background, not a later one", () => {
  const s = run([
    { type: "unlock", at: T0 },
    { type: "background", at: T0 },
    { type: "background", at: T0 + 40 * MIN },
    { type: "foreground", at: T0 + 61 * MIN },
  ]);
  assert.deepEqual(s, LOCKED);
});

test("sign-out, an account change or a lock closes it at once", () => {
  const s = run([{ type: "unlock", at: T0 }, { type: "lock" }]);
  assert.deepEqual(s, LOCKED);
  // Coming back to a locked Admin changes nothing.
  assert.deepEqual(lockReducer(LOCKED, { type: "foreground", at: T0 }), LOCKED);
  assert.deepEqual(lockReducer(LOCKED, { type: "background", at: T0 }), LOCKED);
});

test("a strong fingerprint or face with this phone's key; no sensor, the password and an emailed code", () => {
  assert.equal(lockMethod({ strongBiometrics: true, hasKey: true, wiped: false }), "biometric");
  assert.equal(lockMethod({ strongBiometrics: true, hasKey: false, wiped: false }), "setup");
  // A fingerprint added to the phone wiped the key: set up again, never the phone's PIN.
  assert.equal(lockMethod({ strongBiometrics: true, hasKey: true, wiped: true }), "rekey");
  // No Class 3 sensor (or none enrolled): the password and an emailed code, whatever key there was.
  assert.equal(lockMethod({ strongBiometrics: false, hasKey: true, wiped: false }), "code");
  assert.equal(lockMethod({ strongBiometrics: false, hasKey: false, wiped: false }), "code");
  for (const m of ["biometric", "setup", "rekey", "code"] as const) {
    assert.ok(lockedLine(m).length > 20, m);
    assert.ok(lockedFootnote(m).length > 20, m);
    assert.ok(lockedTitle(m).length > 5, m);
    assert.doesNotMatch(lockedLine(m) + lockedFootnote(m), /\bPIN, pattern\b/, m);
  }
  assert.match(lockedFootnote("biometric"), /never the phone's PIN/);
});

test("an hour without a tap locks Admin, as the server's pass ends", () => {
  assert.equal(idleExpired(T0, T0 + IDLE_LOCK_MS - 1), false);
  assert.equal(idleExpired(T0, T0 + IDLE_LOCK_MS), true);
  assert.equal(IDLE_LOCK_MS, 60 * MIN);
});

test("an emailed code is typed as six digits, whatever the keyboard pasted", () => {
  assert.equal(cleanCode("48 12-90"), "481290");
  assert.equal(cleanCode("1234567"), "123456");
  assert.equal(cleanCode("abc"), "");
});
