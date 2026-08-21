/**
 * Theme runtime — owns the light/dark choice for the console.
 *
 * The colours themselves live in `src/index.css` as CSS variables, so switching
 * mode is one class on `<html>` and every Tailwind utility follows without a
 * re-render. This module's whole job is the choice: read it, persist it, apply
 * it, and hand the one consumer that cannot use a class (recharts, which takes
 * colours as props) the right hexes.
 *
 * Light is the default, matching the app.
 *
 * The stored mode is applied at import time rather than in an effect. localStorage
 * is synchronous, so there is no reason to paint light and then correct it — the
 * app has to hold its splash for AsyncStorage, and the browser does not.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "nf.themeMode";

/**
 * Chart colours for recharts, which styles through props and never sees a class.
 *
 * These duplicate values from `index.css` — the only duplication in the theme, and
 * deliberate: reading the computed variables back out of the document would make every
 * chart depend on paint order. If a token changes there, change it here.
 */
export interface ChartPalette {
  /** Horizontal grid lines. */
  grid: string;
  /** Axis lines. */
  axis: string;
  /** Axis labels. */
  tick: string;
  /** The unfilled part of a bar's track. */
  track: string;
  /** Default series colour. */
  series: string;
  /** Second series colour, for the chart that sits beside the first. */
  sky: string;
  /** Outcome slices. */
  success: string;
  danger: string;
  /** The slice for a category beyond the end of `categorical`. */
  faint: string;
  /**
   * Categorical slices, in order. Four, because the breakdown they colour has four
   * possible labels; a fifth would wrap and reuse the first.
   */
  categorical: readonly string[];
}

const CHART: Record<ThemeMode, ChartPalette> = {
  light: {
    grid: "#eff3f9",
    axis: "#e2e8f0",
    tick: "#94a3b8",
    track: "#eff3f9",
    series: "#2563eb",
    sky: "#0ea5e9",
    success: "#16a34a",
    danger: "#dc2626",
    faint: "#94a3b8",
    categorical: ["#2563eb", "#0ea5e9", "#6366f1", "#94a3b8"],
  },
  dark: {
    grid: "#1c2739",
    axis: "#243146",
    tick: "#64748b",
    track: "#1b2739",
    series: "#3b82f6",
    sky: "#38bdf8",
    success: "#22c55e",
    danger: "#f87171",
    faint: "#64748b",
    categorical: ["#60a5fa", "#38bdf8", "#818cf8", "#64748b"],
  },
};

function storedMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : "light";
  } catch {
    // Private-browsing modes throw on access rather than returning null.
    return "light";
  }
}

/**
 * Applies the mode to the document: the class Tailwind's `dark:` variant reads,
 * and the `color-scheme` property so form controls, scrollbars and the browser's
 * own chrome stop rendering light widgets on a dark page.
 */
function applyMode(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.style.colorScheme = mode;
}

// At import time, before the first paint. A Vite SPA with no server render, so
// there is always a document here.
const initialMode = storedMode();
applyMode(initialMode);

interface ThemeState {
  mode: ThemeMode;
  chart: ChartPalette;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  const setMode = useCallback((next: ThemeMode) => {
    // Applied to the document first, so the paint that follows this state change
    // already has the right variables. The write is best-effort: a storage failure
    // costs the preference next visit, not the click just made.
    applyMode(next);
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ThemeState>(
    () => ({
      mode,
      chart: CHART[mode],
      setMode,
      toggle: () => setMode(mode === "dark" ? "light" : "dark"),
    }),
    [mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
