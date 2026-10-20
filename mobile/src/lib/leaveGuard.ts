/**
 * A screen in the middle of something that would be lost (the Record tab while the mic is on) asks before
 * the tab bar takes the person elsewhere. The guard gets `proceed` and calls it once they agree; the tab bar
 * moves only then. One guard at a time: the screen that set it clears it when the moment is over.
 */
export type LeaveGuard = (proceed: () => void) => void;

let current: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  current = guard;
}

/** Runs `go` at once when nothing is guarded, else hands it to the guard to run on the person's say-so. */
export function leaveThrough(go: () => void): void {
  if (current) current(go);
  else go();
}
