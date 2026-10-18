import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, type Palette } from "../design/theme";
import { useThemedStyles } from "../lib/theme";

/** Scrim in, sheet in, both out (board 7a, item 6). No spring. */
const SCRIM_IN_MS = 150;
const SHEET_IN_MS = 220;
const OUT_MS = 180;
/** How far the sheet rises as it fades in. */
const RISE = 24;

interface Props {
  visible: boolean;
  /** Scrim tap, Android back and a swipe down. Ignored while `dismissable` is false. */
  onClose?: () => void;
  /**
   * False for a sheet that must be answered (Update required, "What is this recording?" after a
   * take): no grabber, and the scrim, back and swipe do nothing.
   */
  dismissable?: boolean;
  /** Runs once the sheet has left the screen, after its exit. */
  onClosed?: () => void;
  /** Lifts the sheet over the keyboard on iOS, for a sheet with a field in it. */
  avoidKeyboard?: boolean;
  /** Extra style for the surface, e.g. a taller `maxHeight`. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * The one popup surface: a bottom sheet over a scrim. Every dialog (`AppDialog`), the record
 * options, the hymn verses, the feedback sheets and the welcomes are drawn on it, so they share
 * one shape, one grabber and one motion.
 *
 * Motion: the scrim fades in over 150 ms while the sheet rises 24 px and fades in over 220 ms,
 * ease-out; it leaves in 180 ms. With Reduce Motion it only fades. A swipe down follows the
 * finger and closes past a third of the sheet's height (or on a quick flick).
 *
 * The children are kept through the exit: a caller usually clears what the sheet showed in the
 * same tick it hides it, and the sheet should leave looking like itself, not empty.
 */
export function Sheet({
  visible,
  onClose,
  dismissable = true,
  onClosed,
  avoidKeyboard = false,
  style,
  children,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);

  const scrim = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const height = useRef(0);

  const last = useRef(children);
  if (visible) last.current = children;

  // Read from the gesture handlers, which are made once.
  const live = useRef({ dismissable, onClose });
  live.current = { dismissable, onClose };
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      Animated.parallel([
        Animated.timing(scrim, {
          toValue: 1,
          duration: SCRIM_IN_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(enter, {
          toValue: 1,
          duration: SHEET_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }
    if (!mounted) return;
    Animated.parallel([
      Animated.timing(scrim, { toValue: 0, duration: OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(enter, { toValue: 0, duration: OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => {
      // Not finished means it was shown again mid-exit: stay mounted.
      if (!finished) return;
      setMounted(false);
      onClosedRef.current?.();
    });
    // `mounted` is read, not followed: only `visible` starts or ends the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          live.current.dismissable && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > height.current / 3 || g.vy > 1.2) {
            Animated.timing(drag, {
              toValue: height.current || 400,
              duration: OUT_MS,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }).start();
            live.current.onClose?.();
          } else {
            Animated.timing(drag, {
              toValue: 0,
              duration: OUT_MS,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.timing(drag, { toValue: 0, duration: OUT_MS, useNativeDriver: true }).start();
        },
      }),
    [drag],
  );

  if (!mounted && !visible) return null;

  const close = () => {
    if (dismissable) onClose?.();
  };

  const rise = reduceMotion ? 0 : RISE;
  const translateY = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }),
    drag,
  );

  const surface = (
    <Animated.View
      {...pan.panHandlers}
      onLayout={(e) => {
        height.current = e.nativeEvent.layout.height;
      }}
      accessibilityViewIsModal
      style={[
        styles.sheet,
        { paddingBottom: Math.max(34, insets.bottom + 14), opacity: enter, transform: [{ translateY }] },
        style,
      ]}
    >
      {dismissable ? <View style={styles.grabber} /> : <View style={styles.grabberSpace} />}
      {visible ? children : last.current}
    </Animated.View>
  );

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessible={dismissable}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>
        {avoidKeyboard ? (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none">
            {surface}
          </KeyboardAvoidingView>
        ) : (
          surface
        )}
      </View>
    </Modal>
  );
}

/** A sheet's title: 19 / semibold, sentence case, ideally one line. An optional leading node (an icon, a tile). */
export function SheetTitle({ children, leading }: { children: React.ReactNode; leading?: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.titleRow}>
      {leading}
      <Text style={styles.title} accessibilityRole="header">
        {children}
      </Text>
    </View>
  );
}

/** The line or two under the title: 15 / 1.45, muted. */
export function SheetMessage({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.message}>{children}</Text>;
}

/** The action row: one row on the right, text button first, the pill last. Never stacked. */
export function SheetActions({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.actions, style]}>{children}</View>;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: "flex-end",
    },
    scrim: {
      backgroundColor: c.scrim,
    },
    sheet: {
      backgroundColor: c.bgElevated,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingTop: 10,
      paddingHorizontal: 20,
      maxHeight: "90%",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: -12 },
      shadowOpacity: 0.35,
      shadowRadius: 20,
      elevation: 16,
    },
    grabber: {
      alignSelf: "center",
      width: 38,
      height: 5,
      borderRadius: 3,
      backgroundColor: c.grabber,
      marginBottom: 18,
    },
    /** A sheet that cannot be swiped away has no grabber; the space keeps the title where it was. */
    grabberSpace: {
      height: 14,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 6,
    },
    title: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 19,
      lineHeight: 25,
      letterSpacing: -0.2,
      color: c.text,
    },
    message: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: c.textMuted,
      marginBottom: 20,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 10,
    },
  });
