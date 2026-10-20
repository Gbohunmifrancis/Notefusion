/**
 * The app's one set of held changes (`lib/heldChange`), each with its "… · Undo" toast (board m-ux-medium). A change
 * is sent when its toast leaves without Undo — its 6 s are up, or another toast took its place and so its Undo with
 * it — and at once when the app leaves the foreground, so a held delete really happens if the phone is put away or
 * the app closed during those seconds. Undo puts the screen back and nothing is sent.
 */

import { AppState } from "react-native";
import type { IconName } from "../components/Icon";
import { createHolds, HOLD_MS, type HeldChange } from "./heldChange";
import { hideToast, showToast } from "./toast";

const holds = createHolds({
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

/** What each held change's toast is, so sending it early can take its Undo off the screen. */
const toasts = new Map<number, number>();

// Backgrounded, or on its way to being closed: nothing held may wait for a timer that might never run.
AppState.addEventListener("change", (state) => {
  if (state === "active") return;
  for (const [id, toast] of [...toasts]) {
    toasts.delete(id);
    hideToast(toast);
  }
  holds.flush();
});

export interface Held {
  /** Sends it now if it is still held, and takes its Undo away (a later edit needs it sent first; the screen went). */
  settle: () => void;
}

/**
 * Holds `change` for 6 s behind a toast saying `message` with Undo. The screen has already changed; `commit` tells
 * the server, `undo` puts the screen back. `afterMs`: the toast rises once that has played out (a row folding away,
 * board m-ux-medium P2a), and the hold lasts as much longer, so Undo stays for the toast's whole 6 s.
 */
export function holdWithUndo(message: string, change: HeldChange, icon?: IconName, afterMs = 0): Held {
  const id = holds.hold(
    {
      commit: () => {
        toasts.delete(id);
        return change.commit();
      },
      undo: () => {
        toasts.delete(id);
        change.undo();
      },
    },
    HOLD_MS + afterMs,
  );
  const show = () => {
    if (!holds.isHeld(id)) return;
    toasts.set(
      id,
      showToast(message, {
        icon,
        action: { label: "Undo", onPress: () => holds.undo(id) },
        onLeave: () => holds.commit(id),
      }),
    );
  };
  if (afterMs > 0) setTimeout(show, afterMs);
  else show();
  return {
    settle: () => {
      const toast = toasts.get(id);
      if (!holds.commit(id)) return;
      if (toast !== undefined) hideToast(toast);
    },
  };
}
