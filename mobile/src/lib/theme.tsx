/**
 * Theme runtime — owns the light/dark choice and hands screens the active palette.
 *
 * Why a provider rather than swapping the exported `colors` object: RN's
 * StyleSheet.create runs once at module evaluation and freezes the values it
 * read, so a mutated palette would never reach an already-imported stylesheet.
 * Screens therefore build styles through `useThemedStyles(factory)`, which
 * re-runs the factory when the mode changes.
 *
 * The preference lives in AsyncStorage, not SecureStore: it is a display setting,
 * not a credential, and it has to be readable on the very first frame — which is
 * why AppRoot waits for `loading` before rendering rather than flashing light
 * and then correcting itself.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  paletteFor,
  shadowsFor,
  type Palette,
  type Shadows,
  type ThemeMode,
} from "../design/theme";

const STORAGE_KEY = "nf.themeMode";

interface ThemeState {
  mode: ThemeMode;
  palette: Palette;
  shadows: Shadows;
  /** True until the stored preference has been read; AppRoot holds the splash for it. */
  loading: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Night is the default look; a stored "light" (Day) choice still wins below.
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === "light" || stored === "dark")) {
          setModeState(stored);
        }
      })
      .catch(() => undefined) // an unreadable preference just means the default
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    // Applied immediately; the write is best-effort so a storage failure costs
    // the user the preference next launch, not the tap they just made.
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({
      mode,
      palette: paletteFor(mode),
      shadows: shadowsFor(mode),
      loading,
      setMode,
      toggle: () => setMode(mode === "dark" ? "light" : "dark"),
    }),
    [mode, loading, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/** The active palette. The common case — most components need nothing else. */
export function useColors(): Palette {
  return useTheme().palette;
}

/**
 * Builds a stylesheet from the active palette, rebuilding only when the mode
 * flips. Call with a module-scope factory so the reference is stable:
 *
 *   const makeStyles = (c: Palette) => StyleSheet.create({ … });
 *   const styles = useThemedStyles(makeStyles);
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (palette: Palette, shadows: Shadows) => T,
): T {
  const { palette, shadows } = useTheme();
  return useMemo(() => factory(palette, shadows), [factory, palette, shadows]);
}
