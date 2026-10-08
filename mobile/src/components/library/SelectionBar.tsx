import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { FadeOutDown, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Touchable } from "../Touchable";
import { useColors, useThemedStyles } from "../../lib/theme";
import { fonts, radii, spacing, type Palette } from "../../design/theme";

/**
 * The floating glass bar of select mode. It sits just above the tab bar, whose height
 * (64 + the inset rule in `TabNavigator`) is repeated here because the bar is absolutely
 * positioned and the navigator exposes no measurement to read.
 */
export function SelectionBar({
  count,
  sharing,
  onClose,
  onDelete,
  onMove,
  onShare,
}: {
  count: number;
  sharing: boolean;
  onClose: () => void;
  onDelete: () => void;
  onMove: () => void;
  onShare: () => void;
}) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const bottom = 64 + Math.max(insets.bottom, spacing.sm) + spacing.xs + 10;

  return (
    <Animated.View
      entering={SlideInDown.duration(220)}
      exiting={FadeOutDown.duration(160)}
      style={[styles.bar, { bottom }]}
    >
      <Touchable onPress={onClose} hitSlop={8} ripple="borderless" style={styles.close} accessibilityLabel="Stop selecting">
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Touchable>
      <Text style={styles.count} numberOfLines={1}>
        {count} selected
      </Text>
      <Touchable onPress={onDelete} style={styles.iconBtn} radius={radii.pill} accessibilityLabel={`Delete ${count} selected`}>
        <Ionicons name="trash-outline" size={20} color={colors.text} />
      </Touchable>
      <Touchable onPress={onMove} style={styles.iconBtn} radius={radii.pill} accessibilityLabel={`Move ${count} selected to a folder`}>
        <Ionicons name="folder-outline" size={20} color={colors.text} />
      </Touchable>
      <Touchable
        onPress={onShare}
        disabled={sharing}
        style={styles.share}
        radius={radii.pill}
        accessibilityLabel={`Share a link to ${count === 1 ? "the selected sheet" : `the ${count} selected sheets`}`}
      >
        {sharing ? <ActivityIndicator size="small" color={colors.bg} /> : <Text style={styles.shareLabel}>Share link</Text>}
      </Touchable>
    </Animated.View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      position: "absolute",
      left: 14,
      right: 14,
      height: 66,
      borderRadius: 33,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingLeft: 12,
      paddingRight: 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.35,
      shadowRadius: 24,
      elevation: 12,
    },
    close: { padding: 4 },
    count: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 14,
      color: c.text,
    },
    iconBtn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    // The one white pill of the screen: `text` on `bg` inverts with the mode.
    share: {
      height: 48,
      minWidth: 108,
      paddingHorizontal: 20,
      borderRadius: 24,
      backgroundColor: c.text,
      alignItems: "center",
      justifyContent: "center",
    },
    shareLabel: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: c.bg,
    },
  });
