/**
 * A change shown at once but sent later, so it can be undone (board m-ux-medium: the held delete on the Library and
 * Home, the doh, hymnbook and transposition choices on Result). The screen changes the moment it is asked; what the
 * server is told waits 6 s, the time the "… · Undo" toast stays. Each held change ends exactly once:
 *
 *   - its time is up, or it is sent early (`commit`: the toast was replaced, a later edit needs it sent first, the
 *     screen went, the app left the foreground — `flush`), and then `commit` runs;
 *   - or Undo, and then `undo` runs and nothing is ever sent.
 *
 * Pure: the clock is handed in, so the timing is tested without waiting (`heldChange.test.ts`); the app's one set of
 * holds, with the toast and the app-in-background rule, is `heldChangeRuntime`.
 */

/** How long a change is held: the undo toast's own time (components/Toast `TOAST_ACTION_MS`). */
export const HOLD_MS = 6000;

export interface HeldChange {
  /** Tells the server. Runs at most once, and never after `undo`. */
  commit: () => void | Promise<void>;
  /** Puts the screen back. Runs at most once, and never after `commit`. */
  undo: () => void;
}

export interface Clock {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface Holds {
  /** Starts holding a change; its id settles it early. */
  hold: (change: HeldChange, ms?: number) => number;
  /** Sends it now. False when it had already ended. */
  commit: (id: number) => boolean;
  /** Undoes it: nothing is sent. False when it had already ended (too late to undo). */
  undo: (id: number) => boolean;
  /** Sends every change still held, now (the app is leaving the foreground). */
  flush: () => void;
  /** Whether a change is still held. */
  isHeld: (id: number) => boolean;
}

export function createHolds(clock: Clock): Holds {
  const held = new Map<number, { change: HeldChange; timer: unknown }>();
  let seq = 0;

  function end(id: number, how: "commit" | "undo"): boolean {
    const entry = held.get(id);
    if (!entry) return false;
    held.delete(id);
    clock.clear(entry.timer);
    if (how === "undo") {
      entry.change.undo();
      return true;
    }
    // Started at once (the app may be on its way to the background). A failed send is the change's own to report —
    // it says so and puts the screen back — so nothing it throws escapes here.
    try {
      const sent = entry.change.commit();
      if (sent) sent.catch(() => undefined);
    } catch {
      // reported by the change itself
    }
    return true;
  }

  return {
    hold(change, ms = HOLD_MS) {
      seq += 1;
      const id = seq;
      held.set(id, { change, timer: clock.set(() => end(id, "commit"), ms) });
      return id;
    },
    commit: (id) => end(id, "commit"),
    undo: (id) => end(id, "undo"),
    flush() {
      for (const id of [...held.keys()]) end(id, "commit");
    },
    isHeld: (id) => held.has(id),
  };
}
