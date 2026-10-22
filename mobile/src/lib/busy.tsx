/**
 * "Working on it": the small card for a tap whose result takes a moment (sharing, filing, deleting, keeping a sheet
 * offline, opening one). It shows 250 ms after the tap, so a quick one never blinks, over a light veil that takes the
 * taps from the first moment, so the same action cannot be started twice while the first is still going.
 *
 * Imperative like `showToast`, for the same reason: the work lives in handlers. `BusyHost` is mounted once, above
 * the navigator and the dialogs.
 */

import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { fonts, radii, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "./theme";

/** A wait shorter than this shows nothing. */
export const BUSY_SHOWN_AFTER_MS = 250;

interface BusyState {
  /** Work is running: the veil takes taps. */
  active: boolean;
  /** The card is on screen. */
  shown: boolean;
  label: string;
}

const IDLE: BusyState = { active: false, shown: false, label: "" };

let state: BusyState = IDLE;
let running = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(s: BusyState) => void>();

function set(next: BusyState) {
  state = next;
  for (const l of listeners) l(next);
}

/** Two frames: long enough for a card just shown to be drawn before synchronous work holds the JS thread. */
const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Runs `work` with the card up ("Sharing…"). `now` shows it at once and lets it paint first, for work that holds the
 * thread (building a sheet's audio) rather than waiting on the network. Whatever `work` throws is thrown on.
 */
export async function withBusy<T>(label: string, work: () => Promise<T> | T, opts?: { now?: boolean }): Promise<T> {
  running += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  if (opts?.now) {
    set({ active: true, shown: true, label });
    await painted();
  } else {
    set({ active: true, shown: state.shown, label });
    timer = setTimeout(() => {
      timer = null;
      if (running > 0) set({ ...state, shown: true });
    }, BUSY_SHOWN_AFTER_MS);
  }
  try {
    return await work();
  } finally {
    running -= 1;
    if (running === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      set(IDLE);
    }
  }
}

/** Whether something is running under the card: a second tap of the same action is ignored then. */
export function isBusy(): boolean {
  return running > 0;
}

export function BusyHost() {
  const [s, setS] = useState(state);
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);

  if (!s.active) return null;
  return (
    <View style={[StyleSheet.absoluteFill, s.shown && styles.veil]} pointerEvents="auto" accessibilityViewIsModal={s.shown}>
      {s.shown ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.card} accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityLabel={s.label}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.label} numberOfLines={1}>
              {s.label}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    veil: { backgroundColor: "rgba(0, 0, 0, 0.18)" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      maxWidth: 320,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      elevation: 6,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    label: { fontFamily: fonts.medium, fontSize: 15, color: c.text, flexShrink: 1 },
  });
