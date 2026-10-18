/**
 * What the Notifications screen says about push, as plain functions (tests: pushStatus.test.ts). Two separate
 * pieces of state meet here: what the phone allows (the OS permission, which the app can ask for but not grant)
 * and what the user chose on this phone (`lib/push`). The screen shows one line for both, because a switch that
 * is off because the phone said no needs different words from one the user turned off.
 */
import type { PushPermission } from "./push";

export interface PushStatus {
  /** What the push switch shows. */
  on: boolean;
  /** The switch can be used (not while checking, not when the phone blocks it or cannot push at all). */
  switchable: boolean;
  /** Push actually reaches this phone: the rows that depend on it (sound, the reminder) are live. */
  live: boolean;
  /** The one line under the switches. */
  line: string;
  /** A mint tick for "allowed", an amber icon when the phone is in the way, nothing otherwise. */
  tone: "ok" | "warn" | "plain";
  /** "Open settings" beside the line: only when the phone's own settings are the fix. */
  openSettings: boolean;
}

export function pushStatus(permission: PushPermission | null, chosen: boolean): PushStatus {
  if (permission === null) {
    return { on: chosen, switchable: false, live: chosen, line: "Checking…", tone: "plain", openSettings: false };
  }
  if (permission === "unsupported") {
    return {
      on: false,
      switchable: false,
      live: false,
      line: "This phone can't get notifications from this copy of the app.",
      tone: "warn",
      openSettings: false,
    };
  }
  if (permission === "denied") {
    return { on: false, switchable: false, live: false, line: "Blocked in your phone's settings.", tone: "warn", openSettings: true };
  }
  if (permission === "granted" && chosen) {
    return { on: true, switchable: true, live: true, line: "Your phone lets NoteFusion notify you.", tone: "ok", openSettings: false };
  }
  if (permission === "undetermined" && chosen) {
    // Never asked: turning the switch on is what asks.
    return { on: false, switchable: true, live: false, line: "Turn it on and your phone will ask once.", tone: "plain", openSettings: false };
  }
  return { on: false, switchable: true, live: false, line: "Off. You won't hear when a score is done.", tone: "plain", openSettings: false };
}

/** The "Transcription ready" row has no switch of its own: push is all or nothing on a phone. */
export function readyValue(status: PushStatus): "Always" | "Off" {
  return status.live ? "Always" : "Off";
}

/** Profile's Notifications row. */
export function notificationsValue(permission: PushPermission | null, chosen: boolean): "On" | "Off" | null {
  if (permission === null) return null;
  return pushStatus(permission, chosen).live ? "On" : "Off";
}
