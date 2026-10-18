import React, { memo } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { ICON_GLYPHS, ICON_LICENCE, type IconName } from "../design/iconGlyphs";
import { useColors } from "../lib/theme";

export type { IconName };

interface Props {
  name: IconName;
  /** The box, in px. The drawing is on a 24 grid, so the line thins with it (1.46 at 20). */
  size?: number;
  /**
   * Ink at rest (`text` for controls, `icon` for row and chip icons, `textMuted` for secondary). Colour is a
   * signal and nothing else: blue (`link`/`primary`) only for active, selected or on; `warning` only on
   * "problem", `success` only on "done"/"check", `premium` only on "pro", `choir` for the choir, `play` for the
   * Playful track and a live streak. Never `danger`: a destructive action is a grey icon beside a red word.
   */
  color?: string;
  /** In grid units. Every icon is drawn at the website's 1.75. */
  strokeWidth?: number;
  /** The selected treatment (the active tab, a saved sheet): the same line over a 20% wash of the shape. */
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The app's one icon: our line glyphs for the music ideas, Lucide for the rest, generated into
 * `design/iconGlyphs.ts` by `npm run build:icons` (only the names the app uses). Decorative to assistive
 * tech; the control around it carries the label.
 */
function IconBase({ name, size = 20, color, strokeWidth = 1.75, filled = false, style }: Props) {
  const c = useColors();
  const ink = color ?? c.text;
  const g = ICON_GLYPHS[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {filled && g.w ? <Path d={g.w} fill={ink} fillOpacity={0.2} /> : null}
      <Path
        d={g.s}
        fill="none"
        stroke={ink}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {g.k ? <Path d={g.k} fill={ink} /> : null}
    </Svg>
  );
}

export const Icon = memo(IconBase);
// Kept on the component so the licence notice stays in the bundle however it is shaken.
(Icon as { licence?: string }).licence = ICON_LICENCE;
