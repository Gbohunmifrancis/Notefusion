/**
 * The result's first-open moment (board c-practice/8b): Doh cheers beside a one-line toast with the headline numbers
 * and one offer. It takes the player dock's place while it shows, so it never covers the solfa; it leaves after 5 s,
 * on a tap on it, or when the screen is touched anywhere (the caller sets `visible` false). Shown once per finished
 * job, never on a reopen from the Library. A sheet the server filed as it finished (option A, board 12) gets the same
 * toast with an icon in Doh's place: "Saved to your Library", with Rename.
 */

import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Button } from "../Button";
import { Icon, type IconName } from "../Icon";
import { Doh, type DohPose } from "./Doh";
import { fonts, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";

/** How long the toast stays before it leaves by itself. */
export const DOH_TOAST_MS = 5000;
const IN_MS = 220;
const OUT_MS = 180;
const RISE = 16;
const DOH = 62;

export function DohToast({
  visible,
  pose,
  icon,
  iconColor,
  title,
  body,
  action,
  bottom,
  onTouched,
  onAction,
  onHide,
  onGone,
}: {
  /** False sends it away (then `onGone`). */
  visible: boolean;
  /** Doh's pose; or `icon` in his place. */
  pose?: DohPose;
  icon?: IconName;
  iconColor?: string;
  title: string;
  body: string;
  action: string;
  /** Where the player docks. */
  bottom: number;
  /** A touch began on the toast (before it reaches the screen, which sends the toast away on any other). */
  onTouched?: () => void;
  onAction: () => void;
  /** It asks to leave: its time is up, or it was tapped. */
  onHide: () => void;
  onGone: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const reduce = useReducedMotion();
  const shown = useSharedValue(0);
  const hide = useRef(onHide);
  hide.current = onHide;
  const gone = useRef(onGone);
  gone.current = onGone;

  useEffect(() => {
    const easing = visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad);
    shown.value = withTiming(visible ? 1 : 0, { duration: visible ? IN_MS : OUT_MS, easing });
    if (visible) {
      const timer = setTimeout(() => hide.current(), DOH_TOAST_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => gone.current(), OUT_MS);
    return () => clearTimeout(timer);
  }, [visible, shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: reduce ? 0 : (1 - shown.value) * RISE }],
  }));

  return (
    <Animated.View
      style={[styles.wrap, { bottom }, style]}
      onTouchStart={onTouched}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityLiveRegion="polite"
    >
      <Pressable onPress={() => hide.current()} style={[styles.toast, icon ? styles.toastIcon : null]} accessibilityLabel={`${title} ${body}`}>
        {icon ? (
          <Icon name={icon} size={22} color={iconColor} />
        ) : (
          <Doh pose={pose ?? "cheer-notes"} size={DOH} entrance={(pose ?? "cheer-notes") === "cheer-notes" ? "cheer" : "hop"} idle={false} style={styles.doh} />
        )}
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {body}
          </Text>
        </View>
        <Button label={action} variant="text" size="sm" onPress={onAction} />
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      position: "absolute",
      left: 14,
      right: 14,
    },
    toast: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: DOH + 12,
      paddingRight: 4,
      paddingVertical: 10,
      borderRadius: 22,
      backgroundColor: c.toast,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.3,
      shadowRadius: 24,
      elevation: 12,
    },
    toastIcon: {
      paddingLeft: 18,
      gap: 14,
    },
    doh: {
      position: "absolute",
      left: 6,
      bottom: 4,
    },
    text: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 14.5,
      lineHeight: 19,
      color: c.text,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 17.5,
      color: c.textMuted,
      marginTop: 1,
    },
  });
