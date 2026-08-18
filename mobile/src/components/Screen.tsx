import { ScrollView, StatusBar, StyleSheet, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  scrollRef,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  edges?: ("top" | "bottom" | "left" | "right")[];
  /** Handle on the inner ScrollView, for screens that need to scroll to a
   *  section on arrival. Ignored unless `scroll` is set. */
  scrollRef?: React.RefObject<ScrollView | null>;
}) {
  const { mode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={styles.safe} edges={edges ?? ["top", "left", "right"]}>
      <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} backgroundColor="transparent" translucent />
      {scroll ? (
        <KeyboardAvoider>
          <ScrollView
            ref={scrollRef}
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
