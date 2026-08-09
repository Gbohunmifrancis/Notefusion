import React from "react";
import { Image, View, StyleSheet } from "react-native";
import Svg, { Rect } from "react-native-svg";

const MARK = require("../../assets/brand/mark.png");

/**
 * Aspect of the shipped artwork, read from the asset so it tracks any re-run of
 * `npm run build:brand` instead of drifting against a hard-coded number. The
 * fallback matches the current export (331 × 438) for the rare platform where
 * `resolveAssetSource` returns nothing.
 */
const MARK_ASPECT = (() => {
  const meta = Image.resolveAssetSource(MARK);
  return meta?.width && meta?.height ? meta.width / meta.height : 331 / 438;
})();

interface Props {
  /** Rendered height in px; width follows the artwork's aspect. */
  size?: number;
  /** Mark colour — white on the blue splash, brand blue on light canvases. */
  color?: string;
  /** Colour of the flanking waveform bars; defaults to a faded `color`. */
  waveColor?: string;
  /** Draw the waveform bars either side of the ring, as on splash and login. */
  showWaves?: boolean;
}

/**
 * The NoteFusion mark: a stylised "5" whose bowl is an oversized open ring, with
 * a dot and three descending bars standing inside it.
 *
 * The glyph ships as a white silhouette with an alpha channel and is recoloured
 * per surface with `tintColor`, which keeps the one-mark-many-colours property
 * the old SVG had. It is *not* hand-authored: earlier attempts to reproduce
 * these curves as paths never matched the real artwork, so
 * `scripts/build-brand-assets.mjs` lifts it out of the splash design render,
 * where the mark is pure white on a known blue field. The design file stays the
 * single source of truth for the shape.
 *
 * The flanking waveform bars remain vector — they are plain rectangles, and
 * drawing them here keeps `waveColor` and their opacity ramp independent of the
 * mark's tint.
 */
export function BrandMark({
  size = 96,
  color = "#2563EB",
  waveColor,
  showWaves = false,
}: Props) {
  const wave = waveColor ?? color;
  const markWidth = size * MARK_ASPECT;
  // The side bars sit outside the mark's own box, so the wrapper is widened
  // rather than shrinking the mark to make room for them.
  const waveWidth = size * 0.36;
  const totalWidth = showWaves ? markWidth + waveWidth * 2 : markWidth;

  return (
    <View style={[styles.row, { width: totalWidth, height: size }]}>
      {showWaves && <SideWave size={size} color={wave} mirrored={false} />}

      <Image
        source={MARK}
        style={{ width: markWidth, height: size }}
        resizeMode="contain"
        tintColor={color}
        accessibilityIgnoresInvertColors
      />

      {showWaves && <SideWave size={size} color={wave} mirrored />}
    </View>
  );
}

/**
 * The five-bar waveform flanking the mark. Bars are symmetric about the middle
 * so the two sides mirror each other; `mirrored` reverses the order for the
 * right-hand copy.
 */
function SideWave({
  size,
  color,
  mirrored,
}: {
  size: number;
  color: string;
  mirrored: boolean;
}) {
  const w = size * 0.36;
  const bars = [0.32, 0.58, 0.86, 0.5, 0.24];
  const ordered = mirrored ? [...bars].reverse() : bars;

  return (
    <Svg width={w} height={size} viewBox="0 0 36 100">
      {ordered.map((h, i) => {
        const barH = h * 74;
        return (
          <Rect
            key={i}
            x={i * 7.4}
            y={50 - barH / 2}
            width="4"
            height={barH}
            rx="2"
            fill={color}
            // Outer bars fade out, so the group reads as sound trailing off
            // rather than as a solid block competing with the mark.
            opacity={0.35 + h * 0.45}
          />
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
