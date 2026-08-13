import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";

/**
 * Lifts its children clear of the software keyboard.
 *
 * Platform behavior:
 *  - iOS   → `behavior="padding"`: iOS does not resize the window automatically,
 *    so KAV adds bottom padding to keep focused inputs visible.
 *  - Android → `behavior=undefined`: Android's window resizes natively (softwareKeyboardLayoutMode: resize)
 *    and the ScrollView inside auto-scrolls focused fields. Adding "padding" or "height" on Android
 *    causes double-compensation (layout jumps up, loses focus, keyboard dismisses, cycle repeats).
 */
export function KeyboardAvoider({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

export default KeyboardAvoider;

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
