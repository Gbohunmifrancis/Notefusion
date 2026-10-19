/**
 * The faint crescent moon behind the splash's mark while the Halloween season is on (board j-halloween/01): moon
 * cream at about 8%, with a soft glow round it. It stays still; the caller fades it in with the mark. Drawn with
 * react-native-svg (a radial gradient for the glow, no filter), so it ships over the air.
 */

import React, { useId } from "react";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";

/** Moon cream: the season's small labels on Night, and the crescent. */
const MOON = "#EDE6CF";

export function Crescent({ size, opacity = 0.08 }: { size: number; opacity?: number }) {
  // useId gives ":r1:"; colons are not safe inside an SVG url(#…) reference.
  const id = "moonglow" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <Svg
      width={size}
      height={size}
      viewBox="-20 -20 140 140"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id={id} cx={52} cy={50} r={70} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={MOON} stopOpacity={opacity * 1.6} />
          <Stop offset="0.6" stopColor={MOON} stopOpacity={opacity * 0.5} />
          <Stop offset="1" stopColor={MOON} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={52} cy={50} r={70} fill={`url(#${id})`} />
      <Path d="M64 8a44 44 0 1 0 28 72a36 36 0 1 1 -28 -72z" fill={MOON} opacity={opacity} />
    </Svg>
  );
}
