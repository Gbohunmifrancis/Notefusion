/**
 * Toasts: good news that leaves by itself ("Saved", "Renamed", "Password updated", "Up to date").
 * Good news should not need a tap to clear, so it is never a sheet. One may carry a single text action
 * ("Rename", "Undo"; board m-ux-medium), and then it stays 6 s instead of 2.5.
 *
 * Imperative like `showDialog`, for the same reason: it is called from the ends of async
 * handlers. `ToastHost` is mounted once, above the navigator.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import type { IconName } from "../components/Icon";
import { Toast } from "../components/Toast";

export interface ToastAction {
  /** One short word: "Undo", "Rename". */
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  /** Defaults to the mint tick ("done"); any other icon is ink. */
  icon?: IconName;
  /** The toast's one text action. */
  action?: ToastAction;
  /**
   * It went without its action being taken: its time was up, another toast took its place, or it was hidden. An
   * Undo toast's held change is sent then (`heldChangeRuntime`).
   */
  onLeave?: () => void;
}

interface Shown extends ToastOptions {
  message: string;
  /** Changes on every call, so the same words twice still replay. */
  id: number;
  /** Asked to go before its time (`hideToast`): it leaves as it would have. */
  leaving?: boolean;
}

let present: ((message: string, options?: ToastOptions) => number) | null = null;
let dismiss: ((id: number) => void) | null = null;

/**
 * Shows a toast above the tab bar for 2.5 s, or 6 s with an action. A second one replaces the first. Returns its id,
 * for `hideToast`; 0 when no host is mounted.
 */
export function showToast(message: string, options?: ToastOptions): number {
  return present?.(message, options) ?? 0;
}

/** Sends that toast away now, if it is still the one shown (its Undo no longer means anything). */
export function hideToast(id: number): void {
  dismiss?.(id);
}

export function ToastHost() {
  const [shown, setShown] = useState<Shown | null>(null);
  const seq = useRef(0);
  /** The toast on screen, read outside a render: the one a new toast replaces. */
  const current = useRef<Shown | null>(null);

  /** It goes without its action taken (time up, replaced, hidden): say so once. */
  const left = useCallback((toast: Shown | null) => {
    if (!toast?.onLeave) return;
    const onLeave = toast.onLeave;
    toast.onLeave = undefined;
    onLeave();
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      seq.current += 1;
      const next: Shown = { message, id: seq.current, ...options };
      left(current.current);
      current.current = next;
      setShown(next);
      AccessibilityInfo.announceForAccessibility(options?.action ? `${message}. ${options.action.label}.` : message);
      return next.id;
    },
    [left],
  );

  const hide = useCallback(
    (id: number) => {
      if (current.current?.id !== id) return;
      left(current.current);
      setShown((s) => (s?.id === id ? { ...s, leaving: true } : s));
    },
    [left],
  );

  useEffect(() => {
    present = show;
    dismiss = hide;
    return () => {
      present = null;
      dismiss = null;
    };
  }, [show, hide]);

  function gone(toast: Shown) {
    left(toast);
    if (current.current?.id === toast.id) current.current = null;
    setShown((s) => (s?.id === toast.id ? null : s));
  }

  return shown ? (
    <Toast
      key={shown.id}
      message={shown.message}
      icon={shown.icon}
      action={shown.action?.label}
      leaving={shown.leaving}
      onAction={() => {
        // Taken: it does not count as leaving without it.
        shown.onLeave = undefined;
        if (current.current) current.current.onLeave = undefined;
        shown.action?.onPress();
      }}
      onDone={() => gone(shown)}
    />
  ) : null;
}
