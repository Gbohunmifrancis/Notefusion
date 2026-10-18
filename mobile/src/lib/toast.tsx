/**
 * Toasts: good news that leaves by itself ("Saved", "Renamed", "Password updated", "Up to date").
 * Good news should not need a tap to clear, so it is never a sheet.
 *
 * Imperative like `showDialog`, for the same reason: it is called from the ends of async
 * handlers. `ToastHost` is mounted once, above the navigator.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import type { IconName } from "../components/Icon";
import { Toast } from "../components/Toast";

export interface ToastOptions {
  /** Defaults to the mint tick ("done"); any other icon is ink. */
  icon?: IconName;
}

interface Shown extends ToastOptions {
  message: string;
  /** Changes on every call, so the same words twice still replay. */
  id: number;
}

let present: ((message: string, options?: ToastOptions) => void) | null = null;

/** Shows a toast above the tab bar for 2.5 s. A second one replaces the first. */
export function showToast(message: string, options?: ToastOptions): void {
  present?.(message, options);
}

export function ToastHost() {
  const [shown, setShown] = useState<Shown | null>(null);
  const seq = useRef(0);

  const show = useCallback((message: string, options?: ToastOptions) => {
    seq.current += 1;
    setShown({ message, id: seq.current, ...options });
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  useEffect(() => {
    present = show;
    return () => {
      present = null;
    };
  }, [show]);

  return shown ? (
    <Toast key={shown.id} message={shown.message} icon={shown.icon} onDone={() => setShown(null)} />
  ) : null;
}
