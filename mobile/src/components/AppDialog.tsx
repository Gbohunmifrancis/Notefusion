import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
}

interface Props {
  visible: boolean;
  options: DialogOptions | null;
  /** Runs the action's own handler, then closes. Called with nothing on a backdrop/back dismissal. */
  onResolve: (action?: DialogAction) => void;
}

const DEFAULT_ACTIONS: DialogAction[] = [{ label: "OK" }];

/**
 * The app's dialog surface — brand canvas, brand radii, Poppins, and the same gradient
 * button as every other primary action.
 *
 * Replaces `Alert.alert`, whose OS-drawn sheet ignored the theme entirely: it stayed
 * light in dark mode, used the system font, and rendered destructive actions in iOS
 * blue-and-red rather than the palette's own danger tone. On a screen this carefully
 * themed, that read as a different app interrupting.
 *
 * Presentational only — mounting, queueing, and the imperative entry point live in
 * `lib/dialog.tsx`.
 */
export function AppDialog({ visible, options, onResolve }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  const actions = options?.actions?.length ? options.actions : DEFAULT_ACTIONS;
  const cancel = actions.find((a) => a.style === "cancel");
  const rest = actions.filter((a) => a.style !== "cancel");

  // One real choice gets the full-weight treatment. Several (a sort picker, an options
  // sheet) become a list instead — four stacked gradient buttons is a wall, not a choice.
  const emphasised = rest.length === 1;

  const tone = options?.tone ?? "brand";
  const toneColor =
    tone === "premium" ? c.premium : tone === "danger" ? c.danger : c.accent;
  const toneWash =
    tone === "premium" ? c.premiumSoft : tone === "danger" ? "rgba(220, 38, 38, 0.12)" : c.accentSoft;

  return (
    <Modal
      visible={visible && options !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android hardware back resolves the same way a backdrop tap does.
      onRequestClose={() => onResolve(cancel)}
    >
      <Pressable style={styles.overlay} onPress={() => onResolve(cancel)}>
        {/* Swallows taps on the card so they don't reach the dismissing backdrop. */}
        <Pressable style={styles.card} onPress={() => undefined}>
          {options?.icon && (
            <View style={[styles.medallion, { backgroundColor: toneWash }]}>
              <Ionicons name={options.icon} size={26} color={toneColor} />
            </View>
          )}

          <Text style={styles.title}>{options?.title}</Text>

          {options?.message ? (
            <ScrollView
              style={styles.messageScroll}
              contentContainerStyle={styles.messageContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.message}>{options.message}</Text>
            </ScrollView>
          ) : null}

          <View style={styles.actions}>
            {rest.map((action) => (
              <Button
                key={action.label}
                label={action.label}
                icon={action.icon}
                variant={
                  action.style === "destructive"
                    ? "danger"
                    : emphasised
                      ? "primary"
                      : "secondary"
                }
                onPress={() => onResolve(action)}
                style={styles.action}
              />
            ))}

            {cancel && (
              <Button
                label={cancel.label}
                variant="ghost"
                onPress={() => onResolve(cancel)}
                style={styles.action}
              />
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)", // matches the account-settings modal
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },

    card: {
      width: "100%",
      maxWidth: 400,
      backgroundColor: c.bgElevated,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.xl,
      alignItems: "center",
    },

    medallion: {
      width: 56,
      height: 56,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
    },

    title: {
      fontSize: 19,
      fontFamily: fonts.bold,
      color: c.text,
      textAlign: "center",
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

    actions: {
      alignSelf: "stretch",
      marginTop: spacing.xl,
    },
    action: {
      marginBottom: spacing.sm,
    },
  });
