import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCKED, RELOCK_AFTER_MS, isUnlocked, lockMethod, lockReducer, lockedLine, type LockState } from "./adminLock.ts";

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

test("back within 5 minutes: still open, where it was", () => {
  const s = run([
    { type: "unlock", at: T0 },
    { type: "background", at: T0 },
    { type: "foreground", at: T0 + 3 * MIN },
  ]);
  assert.equal(isUnlocked(s, T0 + 3 * MIN), true);
  assert.equal(s.awayAt, null);
});

test("back after 5 minutes or more: locked before the first frame", () => {
  const away = run([
    { type: "unlock", at: T0 },
    { type: "background", at: T0 },
  ]);
  // Still away, past the line: already locked, even before the app comes back.
  assert.equal(isUnlocked(away, T0 + RELOCK_AFTER_MS), false);
  assert.equal(isUnlocked(away, T0 + RELOCK_AFTER_MS - 1), true);

  const back = lockReducer(away, { type: "foreground", at: T0 + 6 * MIN });
  assert.deepEqual(back, LOCKED);
});

test("the away clock starts at the first background, not a later one", () => {
  const s = run([
    { type: "unlock", at: T0 },
    { type: "background", at: T0 },
    { type: "background", at: T0 + 4 * MIN },
    { type: "foreground", at: T0 + 6 * MIN },
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

test("fingerprint or face first, then the phone's PIN, then the account password", () => {
  assert.equal(lockMethod({ available: true, hasHardware: true, level: 3 }), "biometric");
  assert.equal(lockMethod({ available: true, hasHardware: true, level: 2 }), "biometric");
  assert.equal(lockMethod({ available: true, hasHardware: true, level: 1 }), "device");
  assert.equal(lockMethod({ available: true, hasHardware: false, level: 1 }), "device");
  assert.equal(lockMethod({ available: true, hasHardware: true, level: 0 }), "password");
  assert.equal(lockMethod({ available: true, hasHardware: false, level: 0 }), "password");
  // A build without the module (no store build yet) asks for the password rather than opening.
  assert.equal(lockMethod({ available: false, hasHardware: true, level: 3 }), "password");
  for (const m of ["biometric", "device", "password"] as const) assert.ok(lockedLine(m).length > 20);
});
