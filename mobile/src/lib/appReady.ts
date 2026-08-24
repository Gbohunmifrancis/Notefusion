/**
 * Boot gate — owns everything that has to finish before the navigator mounts.
 *
 * Three things are in flight at launch: the type faces, the "have we been
 * opened before" flag, and a deliberate minimum time on the branded splash.
 * They are gated together here so RootNavigator has a single boolean to check.
 *
 * Both families are needed before the first frame, not just one: Inter carries
 * every piece of UI text and Poppins carries the wordmark the splash is about
 * to draw. The native splash (a flat brand field, configured in app.json) stays
 * up until they are in memory. Without that the branded splash would paint its
 * wordmark in the system face and then snap a frame later — the same class of
 * flash the stored theme preference already exists to avoid.
 */

import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as NativeSplash from "expo-splash-screen";
import {
  Poppins_600SemiBold,
  Poppins_700Bold,
} from "@expo-google-fonts/poppins";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

const LAUNCHED_KEY = "nf.hasLaunched";

/**
 * How long the branded splash holds once the fonts are ready.
 *
 * First run gets long enough for the mark to draw itself and the tagline to
 * land — the animation is the introduction, and at returning-user speed it just
 * flashes past. Every launch after that is kept short, because by then the
 * splash is a toll on the way to the app rather than something to look at.
 */
const HOLD_FIRST_LAUNCH_MS = 2800;
const HOLD_RETURNING_MS = 700;

interface AppReady {
  /** True once fonts are loaded and the splash has had its minimum time. */
  ready: boolean;
  /** First open on this install — drives the longer splash hold. */
  isFirstLaunch: boolean;
}

export function useAppReady(): AppReady {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Display tier only — see the `fonts` block in design/theme.ts. Poppins
    // Regular and Medium are deliberately no longer loaded: nothing sets them.
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  /** null while the flag is still being read — we cannot pick a duration yet. */
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null);
  const [holdDone, setHoldDone] = useState(false);

  // A missing font must not brick the app: a face failing to load is a
  // cosmetic problem, an app stuck on its splash forever is not.
  const fontsReady = fontsLoaded || fontError !== null;

  // ── Which launch is this? Answer once, then remember for next time. ────────
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(LAUNCHED_KEY)
      .then((seen) => {
        if (cancelled) return;
        setFirstLaunch(seen === null);
        if (seen === null) {
          // Best-effort: a failed write costs a returning user one long splash,
          // which is a far better failure than blocking the boot on storage.
          AsyncStorage.setItem(LAUNCHED_KEY, "1").catch(() => undefined);
        }
      })
      .catch(() => {
        // Unreadable storage: treat as a returning user and get out of the way.
        if (!cancelled) setFirstLaunch(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Hand over from the native splash as soon as the faces are in memory ───
  useEffect(() => {
    if (fontsReady) NativeSplash.hideAsync().catch(() => undefined);
  }, [fontsReady]);

  // ── Hold the branded splash ───────────────────────────────────────────────
  // Deliberately started only once the fonts are ready, so the animation gets
  // the full duration on screen rather than sharing it with the font load.
  useEffect(() => {
    if (firstLaunch === null || !fontsReady) return;
    const t = setTimeout(
      () => setHoldDone(true),
      firstLaunch ? HOLD_FIRST_LAUNCH_MS : HOLD_RETURNING_MS,
    );
    return () => clearTimeout(t);
  }, [firstLaunch, fontsReady]);

  return { ready: fontsReady && holdDone, isFirstLaunch: firstLaunch === true };
}
