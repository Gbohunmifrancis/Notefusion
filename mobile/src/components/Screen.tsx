import React from "react";
import { ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { spacing, type Palette } from "../design/theme";
import { useTheme, useThemedStyles } from "../lib/theme";

/**
 * Every screen's outer shell: safe-area aware, canvas background, status-bar
 * text that follows the active mode, consistent horizontal padding.
 * `scroll` wraps the content in a ScrollView for form-heavy screens.
 */
export function Screen({
  children,
  scroll = false,
  contentStyle,
  edges,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  edges?: ("top" | "bottom" | "left" | "right")[];
}) {
  const { mode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={styles.safe} edges={edges ?? ["top", "left", "right"]}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      {scroll ? (
        <KeyboardAvoider>
          <ScrollView
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </KeyboardAvoider>
      ) : (
        <View style={[styles.content, styles.flex, contentStyle]}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
    flex: { flex: 1 },
  });
