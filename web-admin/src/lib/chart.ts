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
  /**
   * The five-series palette for the Insights charts (stacked series, multi-line), checked with the
   * dataviz validator: lightness band, chroma floor, colour-blind separation and normal-vision floor all
   * pass in both modes. In light mode slots 3–5 sit under 3:1 against white, so every chart using them
   * carries a legend and a table view. Assigned in order, never cycled.
   */
  series5: readonly string[];
  /** One-hue ramp for magnitude (heatmap cells, retention), light to dark. */
  ramp: readonly string[];
  /** The card surface: the 2px gap between stacked segments is drawn in it. */
  surface: string;
}

export const CHART: Record<ThemeMode, ChartPalette> = {
  light: {
    grid: "#eff3f9",
    axis: "#e2e8f0",
    // Slate 500: axis labels at 4.8:1 on the white card (the old #94a3b8 read at 2.6).
    tick: "#64748b",
    series: "#2563eb",
    sky: "#0ea5e9",
    success: "#16a34a",
    danger: "#dc2626",
    faint: "#94a3b8",
    categorical: ["#2563eb", "#0ea5e9", "#6366f1", "#94a3b8"],
    series5: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
    ramp: ["#eef4fc", "#cfe0f7", "#9fc2ef", "#5f9be3", "#2a78d6", "#1a56a3"],
    surface: "#ffffff",
  },
  dark: {
    // The night palette (globals.css `.dark`): cool hairlines, the app's faint text for ticks
    // (5.0:1 on the card), the lifted brand blue for the line, mint and red for outcomes.
    grid: "#161b25",
    axis: "#1e2533",
    tick: "#8089a0",
    series: "#4d8dff",
    sky: "#38bdf8",
    success: "#3ddc97",
    danger: "#ff4d5e",
    faint: "#5a6478",
    categorical: ["#4d8dff", "#38bdf8", "#818cf8", "#8089a0"],
    series5: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
    ramp: ["#141a24", "#1b2b45", "#21416d", "#2a5c9c", "#3987e5", "#8fbaf2"],
    surface: "#0e121a",
  },
};

/**
 * The palette for the current mode.
 *
 * `resolvedTheme` is undefined until next-themes has read the stored preference on the
 * client, so this falls back to dark — the console's default, and the same thing the page
 * paints underneath for most operators. A chart that mounts in light mode therefore renders
 * once with dark grid lines; recharts re-renders on the prop change a tick later, and the
 * alternative (blocking the chart on a mounted flag) trades an invisible flicker for a visible gap.
 */
export function useChartPalette(): ChartPalette {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? CHART.light : CHART.dark;
}
