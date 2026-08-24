/**
 * Chart colours for recharts, which styles through props and never sees a class.
 *
 * These duplicate values from `src/app/globals.css` — the only duplication in the theme, and
 * deliberate: reading the computed variables back out of the document would make every chart
 * depend on paint order. If a token changes there, change it here.
 *
 * The shadcn `<ChartContainer>` does read CSS variables (`--color-chart-1` and friends, which
 * globals.css exports for it), so anything styled purely through its config needs nothing from
 * this file. The props recharts still takes directly — grid stroke, axis tick fill, a `Cell`'s
 * colour — come from here.
 */

"use client";

import { useTheme } from "next-themes";

export type ThemeMode = "light" | "dark";

export interface ChartPalette {
  /** Horizontal grid lines. */
  grid: string;
  /** Axis lines. */
  axis: string;
  /** Axis labels. */
  tick: string;
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

export const CHART: Record<ThemeMode, ChartPalette> = {
  light: {
    grid: "#eff3f9",
    axis: "#e2e8f0",
    tick: "#94a3b8",
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
    series: "#3b82f6",
    sky: "#38bdf8",
    success: "#22c55e",
    danger: "#f87171",
    faint: "#64748b",
    categorical: ["#60a5fa", "#38bdf8", "#818cf8", "#64748b"],
  },
};

/**
 * The palette for the current mode.
 *
 * `resolvedTheme` is undefined until next-themes has read the stored preference on the
 * client, so this falls back to light — the app's default, and the same thing the page
 * paints underneath. A chart that mounts in dark mode therefore renders once with light
 * grid lines; recharts re-renders on the prop change a tick later, and the alternative
 * (blocking the chart on a mounted flag) trades an invisible flicker for a visible gap.
 */
export function useChartPalette(): ChartPalette {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? CHART.dark : CHART.light;
}
