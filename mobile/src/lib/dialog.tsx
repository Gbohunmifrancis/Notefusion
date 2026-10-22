/**
 * Dialog runtime — mounts one `AppDialog` (the bottom sheet) for the whole app and exposes an
 * imperative `showDialog()` to reach it from anywhere.
 *
 * Imperative rather than a hook on purpose. `Alert.alert` is called from plain async
 * functions — `lib/imagePicker.ts` is the clear case — where no hook can run, and from
 * inside `catch` blocks deep in event handlers. A hook-only API would have forced those
 * modules to thread a callback down from a component just to report a failure, so the
 * module-level function is what makes the ~30 replacements mechanical instead of a
 * refactor. There is deliberately no `useDialog()` alongside it: one way to do this.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  AppDialog,
  type DialogAction,
  type DialogChoice,
  type DialogOptions,
  type DialogOutcome,
} from "../components/AppDialog";
import { logAppEvent } from "./appEvents";
import { isProblemSheet, shownTitle } from "./sheetKind";

export type { DialogAction, DialogChoice, DialogOptions };

/** Set while a provider is mounted. Module-level because the callers are not components. */
let present: ((options: DialogOptions) => void) | null = null;

/**
 * Shows a dialog as the app's bottom sheet. Fire-and-forget, like `Alert.alert`: handlers hang
 * off the actions rather than a returned promise.
 *
 * A second call while one is open replaces it — the same thing `Alert.alert` does on iOS, and the
 * alternative (a queue) would leave the user dismissing a backlog. One asked for while a sheet is
 * leaving rises once it has gone.
 */
export function showDialog(options: DialogOptions): void {
  // Problems people were shown reach the console's activity feed: the app's own title only, never the message.
  if (isProblemSheet(options)) logAppEvent("error_shown", { via: "sheet", title: shownTitle(options.title) });
  if (present) {
    present(options);
    return;
  }

  // Only reachable before the provider mounts, which in practice means never — it wraps
  // the navigator. Falls back rather than returning silently because the messages routed
  // here include failures, and a swallowed error report is worse than an unstyled one.
  Alert.alert(options.title, options.message);
}

/**
 * Must be mounted inside `ThemeProvider` and `SafeAreaProvider` — the sheet is themed and sits
 * above the home indicator — and should wrap the navigator so dialogs paint above every screen.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  /** What the sheet shows; null while it is closed or leaving. */
  const [options, setOptions] = useState<DialogOptions | null>(null);
  /** An action was chosen and its sheet is leaving. */
  const closing = useRef(false);
  /** Asked for while a sheet was leaving: shown once it has gone. */
  const waiting = useRef<DialogOptions | null>(null);
  /** The chosen action's handler, run once its sheet has gone. */
  const after = useRef<(() => void) | null>(null);
  /** Counts the dialogs asked for, to tell whether a handler opened one of its own. */
  const asked = useRef(0);

  const open = useCallback((next: DialogOptions) => {
    asked.current += 1;
    if (closing.current) {
      waiting.current = next;
      return;
    }
    setOptions(next);
  }, []);

  useEffect(() => {
    present = open;
    return () => {
      present = null;
    };
  }, [open]);

  const resolve = useCallback((outcome: DialogOutcome) => {
    // A second tap while the sheet leaves changes nothing.
    if (closing.current) return;
    closing.current = true;
    after.current = outcome?.onPress ?? null;
    setOptions(null);
  }, []);

  /**
   * The handler runs after the sheet has left, not while it is leaving: it may open another
   * sheet, the share sheet, the photo picker or a new screen, and on iOS none of those can be
   * presented while a modal is still on screen.
   */
  const closed = useCallback(() => {
    closing.current = false;
    const run = after.current;
    after.current = null;
    const next = waiting.current;
    waiting.current = null;
    const before = asked.current;
    run?.();
    // A dialog the handler opened is the newer one; otherwise show what waited.
    if (next && asked.current === before) setOptions(next);
  }, []);

  return (
    <>
      {children}
      <AppDialog visible={options !== null} options={options} onResolve={resolve} onClosed={closed} />
    </>
  );
}
