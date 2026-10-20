import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { fonts, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

/** How long a toast stays, entrance to exit. */
export const TOAST_MS = 2500;
/** A toast with an action (Undo, Rename) stays long enough to reach it (board m-ux-medium P2a). */
export const TOAST_ACTION_MS = 6000;
const IN_MS = 220;
const OUT_MS = 180;
/** It rises this far as it arrives. */
const RISE = 16;
/**
 * The floating tab bar's height (`navigation/TabNavigator`), so the toast clears it by 16 px.
 * On a screen without the bar it sits at the same height, which keeps it off a player dock too.
 */
const TAB_BAR = 64;

/**
 * One toast (board 7c): a mint tick and a few words, centred above the tab bar. It arrives, waits
 * and leaves on its own. A plain toast never takes a tap — the screen under it stays usable; one with an
 * `action` (board m-ux-medium: "Undo", "Rename") takes a tap on that word alone, 44 px tall after a hairline.
 */
export function Toast({
  message,
  icon = "done",
  action,
  onAction,
  onDone,
}: {
  message: string;
  icon?: IconName;
  /** The one text action's word. */
  action?: string;
  onAction?: () => void;
  onDone: () => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  const done = useRef(onDone);
  done.current = onDone;
  const run = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const stay = action ? TOAST_ACTION_MS : TOAST_MS;
    const sequence = Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(stay - IN_MS - OUT_MS),
      Animated.timing(t, { toValue: 0, duration: OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    run.current = sequence;
    sequence.start(({ finished }) => {
      if (finished) done.current();
    });
    return () => sequence.stop();
    // One run per toast: the host keys each toast by its own id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  /** The action was taken: it is done with, so the toast leaves at once. */
  function act() {
    run.current?.stop();
    onAction?.();
    Animated.timing(t, { toValue: 0, duration: OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() =>
      done.current(),
    );
  }

  const bottom = Math.max(insets.bottom, spacing.sm) + spacing.xs + TAB_BAR + 16;
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : RISE, 0] });

  return (
    <Animated.View
      pointerEvents={action ? "box-none" : "none"}
      accessibilityLiveRegion="polite"
      style={[styles.toast, action ? styles.toastAction : null, { bottom, opacity: t, transform: [{ translateY }] }]}
    >
      <Icon name={icon} size={20} color={icon === "done" ? c.success : c.icon} />
      <Text style={[styles.text, action ? styles.textAction : null]} numberOfLines={2}>
        {message}
      </Text>
      {action ? (
        <View style={styles.actionRule}>
          <Pressable
            onPress={act}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            accessibilityRole="button"
            accessibilityLabel={action}
          >
            <Text style={styles.actionLabel}>{action}</Text>
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    toast: {
      position: "absolute",
      alignSelf: "center",
      maxWidth: "88%",
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingLeft: 12,
      paddingRight: 16,
      paddingVertical: 10,
      borderRadius: 14,
      backgroundColor: c.toast,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.25,
      shadowRadius: 18,
      elevation: 10,
    },
    /** The action sits in the toast's own padding, so the toast keeps its height. */
    toastAction: { paddingRight: 4, paddingVertical: 0 },
    text: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: c.text,
    },
    textAction: { paddingVertical: 10 },
    actionRule: {
      marginLeft: 2,
      borderLeftWidth: 1,
      borderLeftColor: c.border,
    },
    action: {
      height: 44,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
    },
    actionPressed: { opacity: 0.6 },
    actionLabel: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: c.link,
    },
  });
