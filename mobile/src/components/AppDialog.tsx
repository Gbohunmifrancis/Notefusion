import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "./Button";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

/** How an action is weighted. Mirrors `Alert.alert`'s button styles so replacing a call is mechanical. */
export type DialogActionStyle = "default" | "cancel" | "destructive";

export interface DialogAction {
  label: string;
  style?: DialogActionStyle;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}

export interface DialogOptions {
  title: string;
  message?: string;
  /** Glyph for the header medallion. Omit for a plain text dialog. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Tints the medallion. `premium` is the amber upsell tone; `danger` warns. */
  tone?: "brand" | "premium" | "danger";
  /** Defaults to a single "OK", matching `Alert.alert` with no buttons. */
  actions?: DialogAction[];
  /**
   * Removes every way out except the actions: the backdrop stops dismissing and the Android
   * back button does nothing. For the one case that has no "later" — a build below the
   * minimum the server will serve, where letting the user past the dialog only lands them
   * on a screen that cannot work.
   *
   * Withholding a `cancel` action is not enough on its own, because both dismissal paths
   * call `onResolve(undefined)`, which still closes the dialog.
   */
  blocking?: boolean;
}

interface Props {
  visible: boolean;
  options: DialogOptions | null;
  /** Runs the action's own handler, then closes. Called with nothing on a backdrop/back dismissal. */
  onResolve: (action?: DialogAction) => void;
}

const DEFAULT_ACTIONS: DialogAction[] = [{ label: "OK" }];

/**
 * Entrance spring for the card. Softer than `motion.press` — a dialog arriving is
 * an announcement, not a button acknowledging a finger — but still damped enough
 * that it lands rather than wobbling.
 */
const ENTER_SPRING = { damping: 18, stiffness: 240, mass: 0.7 } as const;

/**
 * The app's dialog surface — brand canvas, brand radii, and the same gradient
 * button as every other primary action.
 *
 * Replaces `Alert.alert`, whose OS-drawn sheet ignored the theme entirely: it stayed
 * light in dark mode, used the system font, and rendered destructive actions in iOS
 * blue-and-red rather than the palette's own danger tone. On a screen this carefully
 * themed, that read as a different app interrupting.
 *
 * The card scales and rises in under its own spring rather than sharing the Modal's
 * flat cross-fade. Fading a whole dialog up at uniform opacity is what made this one
 * read as pasted on: the scrim and the card arrived as one flat layer, so nothing
 * signalled that the card sits *above* the screen.
 *
 * Presentational only — mounting, queueing, and the imperative entry point live in
 * `lib/dialog.tsx`.
 */
export function AppDialog({ visible, options, onResolve }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  /**
   * Retained through the exit. `options` goes null the instant an action fires while
   * the Modal's own fade-out is still playing, so rendering straight from the prop
   * empties the card — title, message and buttons all gone — for the length of that
   * fade. Keeping the last set means the dialog fades out looking like itself.
   */
  const [shown, setShown] = useState<DialogOptions | null>(options);
  useEffect(() => {
    if (options) setShown(options);
  }, [options]);

  // ── Entrance ──────────────────────────────────────────────────────────────
  const enter = useSharedValue(0);
  useEffect(() => {
    if (!options) return; // Exit is the Modal's fade; nothing to drive here.
    enter.value = 0;
    enter.value = withSpring(1, ENTER_SPRING);
  }, [options, enter]);

  const cardStyle = useAnimatedStyle(() => ({
    // Clamped: the spring overshoots slightly past 1, which is welcome on scale
    // and meaningless on opacity.
    opacity: Math.min(enter.value, 1),
    transform: [
      { scale: 0.94 + enter.value * 0.06 },
      { translateY: (1 - enter.value) * 12 },
    ],
  }));

  const actions = shown?.actions?.length ? shown.actions : DEFAULT_ACTIONS;
  const cancel = actions.find((a) => a.style === "cancel");
  const rest = actions.filter((a) => a.style !== "cancel");

  // One real choice gets the full-weight treatment. Several (a sort picker, an options
  // sheet) become a list instead — four stacked gradient buttons is a wall, not a choice.
  const emphasised = rest.length === 1;

  /** The backdrop and the Android back button. Both dead while `blocking`. */
  const dismiss = () => {
    if (shown?.blocking) return;
    onResolve(cancel);
  };

  const tone = shown?.tone ?? "brand";
  const toneColor =
    tone === "premium" ? c.premium : tone === "danger" ? c.danger : c.accent;
  const toneWash =
    tone === "premium" ? c.premiumSoft : tone === "danger" ? c.dangerSoft : c.accentSoft;

  const variantFor = (action: DialogAction) => {
    if (action.style === "destructive") {
      // A confirmation dialog's destructive action *is* its primary action, and a
      // 12 % tint in that slot reads hollow — as if the app were hedging about the
      // very thing it just asked you to confirm.
      return emphasised ? "dangerSolid" : "danger";
    }
    return emphasised ? "primary" : "secondary";
  };

  return (
    <Modal
      visible={visible && shown !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android hardware back resolves the same way a backdrop tap does.
      onRequestClose={dismiss}
    >
      <Pressable style={styles.overlay} onPress={dismiss}>
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          {/* Swallows taps on the card so they don't reach the dismissing backdrop. */}
          <Pressable style={styles.card} onPress={() => undefined}>
            {shown?.icon && (
              <View style={[styles.medallion, { backgroundColor: toneWash }]}>
                <Ionicons name={shown.icon} size={26} color={toneColor} />
              </View>
            )}

            <Text style={styles.title}>{shown?.title}</Text>

            {shown?.message ? (
              <ScrollView
                style={styles.messageScroll}
                contentContainerStyle={styles.messageContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.message}>{shown.message}</Text>
              </ScrollView>
            ) : null}

            <View style={styles.actions}>
              {rest.map((action) => (
                <Button
                  key={action.label}
                  label={action.label}
                  icon={action.icon}
                  variant={variantFor(action)}
                  onPress={() => onResolve(action)}
                />
              ))}

              {cancel && (
                <Button
                  label={cancel.label}
                  variant="ghost"
                  onPress={() => onResolve(cancel)}
                />
              )}
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },

    /** Carries the entrance transform, so the card's own padding stays untouched. */
    cardWrap: {
      width: "100%",
      maxWidth: 400,
    },

    card: {
      backgroundColor: c.bgElevated,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: c.border,
      paddingTop: spacing.xl,
      // Lighter than the top: the actions already carry their own breathing room,
      // and matching xl here left a dead band under the last button.
      paddingBottom: spacing.lg,
      paddingHorizontal: spacing.xl,
      alignItems: "center",
    },

    medallion: {
      width: 56,
      height: 56,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.md,
    },

    title: {
      fontSize: 20,
      // Poppins. A dialog title is the one piece of in-app text that is announcing
      // rather than reading, and it is short enough that the display face's wide
      // sidebearings cost nothing.
      fontFamily: fonts.display,
      color: c.text,
      textAlign: "center",
      letterSpacing: -0.3,
    },

    /** Capped so a long server message scrolls instead of pushing the actions off-screen. */
    messageScroll: {
      maxHeight: 220,
      marginTop: spacing.sm,
      alignSelf: "stretch",
    },
    messageContent: {
      paddingBottom: spacing.xs,
    },
    message: {
      ...typography.body,
      color: c.textMuted,
      textAlign: "center",
      lineHeight: 22,
    },

    /** `gap`, not a margin on each child — a per-child `marginBottom` also fires on
     *  the last one, which is what left the card hanging open below its cancel. */
    actions: {
      alignSelf: "stretch",
      marginTop: spacing.lg,
      gap: spacing.sm,
    },
  });
