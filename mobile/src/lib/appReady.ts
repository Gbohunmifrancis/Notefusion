/**
 * Boot gate — owns everything that has to finish before the navigator mounts.
 *
 * Three things are in flight at launch: the type faces, the "have we been
 * opened before" flag, and a deliberate minimum time on the branded splash.
 * They are gated together here so RootNavigator has a single boolean to check.
 *
 * Every family is needed before the first frame: Geist carries the interface
 * and Nunito the wordmark the splash is about to draw. The native splash (a flat brand field, configured in app.json) stays
 * up until they are in memory. Without that the branded splash would paint its
 * wordmark in the system face and then snap a frame later — the same class of
 * flash the stored theme preference already exists to avoid.
 */

import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as NativeSplash from "expo-splash-screen";
import { useFonts } from "expo-font";
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from "@expo-google-fonts/geist";
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from "@expo-google-fonts/jetbrains-mono";
import { Nunito_900Black } from "@expo-google-fonts/nunito";
import {
  SEASON_CACHE_KEY,
  activeSeason,
  costumeOf,
  parseSeason,
  seasonIntroKey,
  seasonKey,
  splashSeason,
  type Costume,
  type SeasonName,
  type SplashSeason,
} from "./season";
import { primeSeason } from "./seasonStore";

const LAUNCHED_KEY = "nf.hasLaunched";

/**
 * How long the branded splash holds once the fonts are ready.
 *
 * First run gets long enough for the mark to draw itself and the tagline to
 * land (1.66 s) — the animation is the introduction, and at returning-user speed
 * it just flashes past. Every cold start after that plays the 0.6 s version and
 * hands over at 0.65 s, because by then the splash is a toll on the way to the
 * app rather than something to look at (board a-core/02).
 */
const HOLD_FIRST_LAUNCH_MS = 1700;
const HOLD_RETURNING_MS = 650;

interface AppReady {
  /** True once fonts are loaded and the splash has had its minimum time. */
  ready: boolean;
  /** First open on this install — drives the longer splash hold. */
  isFirstLaunch: boolean;
  /**
   * What the branded splash should play. `hold` while the faces load and the
   * launch flag is read (the native splash still covers the screen), then the
   * full `intro` on a first open or the `brief` reveal on every open after.
   */
  splash: "hold" | "intro" | "brief";
  /**
   * The season as this phone last heard it (lib/season `splashSeason`): `none` (as always), `intro` once a season (the
   * full four beats, the costume dropping on, a few seconds of snow or bats and the chime) or `dressed` after that.
   */
  season: SplashSeason;
  /** Which season that is: Christmas (the cap) or Halloween (the witch hat); null with `none`. */
  seasonName: SeasonName | null;
  costume: Costume | null;
}

export function useAppReady(): AppReady {
  const [fontsLoaded, fontError] = useFonts({
    // Geist is every piece of interface text, JetBrains Mono the solfa, and
    // Nunito the wordmark the splash draws — see `fonts` / `nightFonts` in
    // design/theme.ts. All of them have to be in memory before the first frame.
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    Nunito_900Black,
  });

  /** null while the flag is still being read — we cannot pick a duration yet. */
  const [firstLaunch, setFirstLaunch] = useState<boolean | null>(null);
  const [season, setSeason] = useState<SplashSeason>("none");
  const [seasonName, setSeasonName] = useState<SeasonName | null>(null);
  const [holdDone, setHoldDone] = useState(false);

  // A missing font must not brick the app: a face failing to load is a
  // cosmetic problem, an app stuck on its splash forever is not.
  const fontsReady = fontsLoaded || fontError !== null;

  // ── Which launch is this? Answer once, then remember for next time. ────────
  // The season as the phone last heard it is read here too: the splash dresses before the network is up, which is
  // why a season switched on shows on the splash from the next launch (lib/seasonStore reads the server).
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.multiGet([LAUNCHED_KEY, SEASON_CACHE_KEY, seasonIntroKey("christmas"), seasonIntroKey("halloween")])
      .then(([[, seen], [, cached], [, christmasIntro], [, halloweenIntro]]) => {
        if (cancelled) return;
        const flag = parseSeason(cached);
        primeSeason(flag);
        const now = new Date();
        const on = activeSeason(flag);
        const lastIntro = on === "halloween" ? halloweenIntro : christmasIntro;
        const dressed = seen === null ? "none" : splashSeason(flag, lastIntro, now);
        setSeason(dressed);
        setSeasonName(dressed === "none" ? null : on);
        // Once a season: the intro is spent the moment it is chosen, chime or no chime.
        if (dressed === "intro" && on) AsyncStorage.setItem(seasonIntroKey(on), seasonKey(now, on)).catch(() => undefined);
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
      firstLaunch || season === "intro" ? HOLD_FIRST_LAUNCH_MS : HOLD_RETURNING_MS,
    );
    return () => clearTimeout(t);
  }, [firstLaunch, fontsReady, season]);

  return {
    ready: fontsReady && holdDone,
    isFirstLaunch: firstLaunch === true,
    // The season's intro is the full four beats, as a first open's is.
    splash: !fontsReady || firstLaunch === null ? "hold" : firstLaunch || season === "intro" ? "intro" : "brief",
    season,
    seasonName,
    costume: costumeOf(seasonName),
  };
}
