import { useEffect } from "react";
import { Animated, AppState, Easing, type NativeEventSubscription } from "react-native";

/**
 * One breath for the app's record buttons: Home's big mic and the tab bar's halo read the same value, so the two
 * swell together instead of beating against each other (board a-core/05). 0 → 1 → 0 over 3.6 s (1.8 s in, 1.8 s
 * out, ease-in-out sine), on the native driver: an idle loop costs nothing on the JS thread.
 *
 * It runs only while something on screen wants it (`useBreath(true)`) and the app is in the foreground, and
 * settles back to rest otherwise, so nothing breathes behind another screen or with the phone in a pocket.
 */
export const BREATH_HALF_MS = 1800;

const breath = new Animated.Value(0);
let users = 0;
let loop: Animated.CompositeAnimation | null = null;
let active = AppState.currentState !== "background";
let appState: NativeEventSubscription | null = null;

function update() {
  const run = users > 0 && active;
  if (run && !loop) {
    breath.setValue(0);
    loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: BREATH_HALF_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: BREATH_HALF_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
  } else if (!run && loop) {
    loop.stop();
    loop = null;
    breath.setValue(0);
  }
}

/**
 * The shared breath, 0 (rest) to 1 (peak). `running` says this caller wants it moving now (focused, not under
 * Reduce Motion); with no caller running it holds at rest.
 */
export function useBreath(running: boolean): Animated.Value {
  useEffect(() => {
    if (!running) return undefined;
    if (!appState) {
      appState = AppState.addEventListener("change", (next) => {
        active = next !== "background";
        update();
      });
    }
    users += 1;
    update();
    return () => {
      users -= 1;
      update();
    };
  }, [running]);
  return breath;
}
