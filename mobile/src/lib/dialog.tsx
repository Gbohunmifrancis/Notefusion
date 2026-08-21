/**
 * Dialog runtime — mounts one `AppDialog` for the whole app and exposes an
 * imperative `showDialog()` to reach it from anywhere.
 *
 * Imperative rather than a hook on purpose. `Alert.alert` is called from plain async
 * functions — `lib/imagePicker.ts` is the clear case — where no hook can run, and from
 * inside `catch` blocks deep in event handlers. A hook-only API would have forced those
 * modules to thread a callback down from a component just to report a failure, so the
 * module-level function is what makes the ~30 replacements mechanical instead of a
 * refactor. There is deliberately no `useDialog()` alongside it: one way to do this.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { AppDialog, type DialogAction, type DialogOptions } from "../components/AppDialog";

export type { DialogAction, DialogOptions };

/** Set while a provider is mounted. Module-level because the callers are not components. */
let present: ((options: DialogOptions) => void) | null = null;

/**
 * Shows a branded dialog. Fire-and-forget, like `Alert.alert`: handlers hang off the
 * actions rather than a returned promise.
 *
 * A second call while one is open replaces it — the same thing `Alert.alert` does on iOS,
 * and the alternative (a queue) would leave the user dismissing a backlog.
 */
export function showDialog(options: DialogOptions): void {
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
 * Must be mounted inside `ThemeProvider` — the dialog is themed — and should wrap the
 * navigator so dialogs paint above every screen.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<DialogOptions | null>(null);

  useEffect(() => {
    present = setOptions;
    return () => {
      present = null;
    };
  }, []);

  const resolve = useCallback((action?: DialogAction) => {
    setOptions(null);
    // After the close, so a handler that opens another dialog isn't immediately cleared
    // by this one's teardown.
    action?.onPress?.();
  }, []);

  return (
    <>
      {children}
      <AppDialog visible={options !== null} options={options} onResolve={resolve} />
    </>
  );
}
