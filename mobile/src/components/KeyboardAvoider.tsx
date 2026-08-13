import React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";

/**
 * Lifts its children clear of the software keyboard.
 *
 * Since Expo SDK 52, Android uses edge-to-edge rendering — the app window
 * draws behind the IME (keyboard). There is no longer a system-level resize
 * that shrinks the layout automatically.
 *
 * Platform behavior:
 *  - iOS   → behavior="padding": KAV adds bottom padding equal to the keyboard
 *    height. Correct with SafeAreaView on top.
 *  - Android → behavior="height": KAV reduces its own height by the keyboard
 *    height. Using "padding" on Android with edge-to-edge causes the view to
 *    both shift AND get padded simultaneously — the double-compensation that
 *    produces the keyboard-flashes-and-vanishes shake bug.
 *
 * The app.json softwareKeyboardLayoutMode entry is intentionally absent:
 * it was "resize", which conflicts with KAV's own compensation on SDK 52+ and
 * produces the same double-shift bug from the other direction.
 */
export function KeyboardAvoider({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

export default KeyboardAvoider;

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
