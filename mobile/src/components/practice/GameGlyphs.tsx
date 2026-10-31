/**
 * The game-coloured Practice's two small drawings, as the web draws them (web-site/assets/practice-view.js `gem`,
 * `chestIcon`): the XP's gem (two facets) and the quests' chest, shut or open. Decorative: the words beside them say
 * what they show, so screen readers skip them.
 */

import React from "react";
import Svg, { Path, Rect } from "react-native-svg";

export function Gem({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M10 2 18 8 10 18 2 8Z" fill={color} />
      <Path d="M10 2 14 8 10 18 6 8Z" fill="#fff" opacity={0.45} />
    </Svg>
  );
}

export function Chest({ open, width = 28, color }: { open: boolean; width?: number; color: string }) {
  const height = Math.round((width * 24) / 28);
  return (
    <Svg width={width} height={height} viewBox="0 0 28 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M3 11h22v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={color} />
      {open ? (
        <>
          <Path d="M4 9 7 2h14l3 7z" fill={color} opacity={0.65} />
          <Path d="M8 7l2-3M14 6V2M20 7l-2-3" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
          <Rect x={12} y={13} width={4} height={5} rx={1} fill="#fff" opacity={0.8} />
        </>
      ) : (
        <>
          <Path d="M3 11a4 4 0 0 1 4-6h14a4 4 0 0 1 4 6z" fill={color} opacity={0.65} />
          <Rect x={12} y={9} width={4} height={7} rx={1} fill="#fff" opacity={0.8} />
        </>
      )}
    </Svg>
  );
}
