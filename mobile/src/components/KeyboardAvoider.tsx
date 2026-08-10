import React from "react";
import { KeyboardAvoidingView, StyleSheet } from "react-native";

/**
 * Lifts its children clear of the software keyboard.
 *
 * Android used to do this for free: the system resized the window and a
 * ScrollView inside it simply got shorter. Edge-to-edge display — mandatory on
 * Android since Expo SDK 54 and not something an app can opt out of — ends that.
 * The app now draws behind the IME on both platforms, so the compensation has to
 * happen in JS or the focused field stays under the keyboard.
 *
 * `behavior="padding"` on both platforms is deliberate:
 *
 *  - Leaving Android with no behavior at all (`Platform.OS === 'ios' ? … :
 *    undefined`, the shape these screens used to have) is a no-op, so nothing
 *    compensated.
 *  - Forcing the window to pan instead, via `softwareKeyboardLayoutMode: "pan"`,
 *    is worse than nothing. The native window pans while the ScrollView
 *    independently scrolls the focused input into view; the two disagree about
 *    where the input belongs, focus is dropped, and the keyboard opens and shuts
 *    again in the space of a frame. That is the "keyboard flashes and vanishes"
 *    bug, and it is why app.json now asks for "resize".
 *
 * Wraps rather than configures because three call sites need it — both auth
 * screens and `Screen`'s scrolling variant — and the reasoning above should live
 * in one place, not be re-derived at each of them.
 */
export function KeyboardAvoider({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}

export default KeyboardAvoider;

const styles = StyleSheet.create({
  // Not a themed makeStyles factory: nothing here reads the palette.
  flex: { flex: 1 },
});
