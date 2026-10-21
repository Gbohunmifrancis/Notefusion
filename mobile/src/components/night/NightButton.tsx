import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Button } from "../Button";
import { ThemeOverride } from "../../lib/theme";
import { night } from "../../design/theme";

type Variant = "white" | "blue" | "ghost";

interface Props {
  label: string;
  onPress?: () => void;
  /**
   * `white` and `blue` are both the one primary now (the shared blue `Button`); `ghost` is the
   * secondary choice beside it, edged (below). The two primary names stay so the first-run screens
   * read as before.
   */
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  /** Drawn before the label, e.g. Google's "G". */
  icon?: React.ReactNode;
  /** A small trailing chip, e.g. "Last used". */
  badge?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The first-run screens' action (welcome, sign-in, verify, onboarding): the shared `Button` as a
 * block, in the night palette whatever the app's mode, because those screens are always drawn on
 * the night canvas.
 */
export function NightButton({
  label,
  onPress,
  variant = "white",
  loading = false,
  disabled = false,
  icon,
  badge,
  style,
}: Props) {
  const primary = variant !== "ghost";
  return (
    <ThemeOverride mode="dark">
      <Button
        label={label}
        onPress={onPress}
        variant={primary ? "primary" : "secondary"}
        block
        // Google's G keeps its colours on a white disc: its own blue would vanish on the blue pill.
        leading={icon ? primary ? <View style={styles.disc}>{icon}</View> : icon : undefined}
        badge={badge}
        // The quiet pill's fill is 1.16:1 on Welcome's deep canvas, so its edge could not be seen: a 1 px night.dim
        // hairline gives it one at 3.39:1 (board n-ux-low Q3b).
        edgeColor={primary ? undefined : night.dim}
        loading={loading}
        disabled={disabled}
        style={style}
      />
    </ThemeOverride>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
});
