/**
 * The Christmas cap (board d-christmas/01), laid over the brand mark or over Doh while the season is on. One SVG,
 * drawn once (design/practice-art/season.mjs, shipped in `practice/art/svgs.ts`), placed by lib/season: on the
 * mark's 331 × 438 box (a third larger at header sizes) or on Doh's 200 × 200. It sits over the picture, which never
 * changes; it is never put on a control (the record button stays bare), and a screen wears one at most.
 *
 * react-native-svg only: no native module, so it ships over the air.
 */

import React, { memo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";

import { ART, type ArtName } from "../practice/art/svgs";
import { Art, artRatio } from "../practice/Art";
import { capOnDoh, capOnMark } from "../../lib/season";

/** The cap's own drawing, its brim's middle moved to (0, 0). */
const CAP = (() => {
  const inner = ART["season-cap"].replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<g transform='translate(-100 -125)'>${inner}</g>`;
})();

const MARK_W = 331;
const MARK_H = 438;
/** Room round the mark's box for the cap, which rises above the "5" and leans out to its left. */
const PAD_TOP = 170;
const PAD_LEFT = 50;

/** The cap over a mark `height` px tall: put it inside a box exactly the mark's size (`position: relative`). */
export const MarkCap = memo(function MarkCap({ height }: { height: number }) {
  const s = height / MARK_H;
  const w = (MARK_W + PAD_LEFT) * s;
  const h = (MARK_H + PAD_TOP) * s;
  const xml = `<svg viewBox='${-PAD_LEFT} ${-PAD_TOP} ${MARK_W + PAD_LEFT} ${MARK_H + PAD_TOP}'><g transform='${capOnMark(height)}'>${CAP}</g></svg>`;
  return (
    <View pointerEvents="none" style={[styles.over, { left: -PAD_LEFT * s, top: -PAD_TOP * s, width: w, height: h }]}>
      <SvgXml xml={xml} width={w} height={h} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </View>
  );
});

/** The cap over Doh in a box `width` px wide (Doh's poses are square), tipped back so his note-crest shows. */
export const DohCap = memo(function DohCap({ width, pose }: { width: number; pose: string }) {
  const xml = `<svg viewBox='0 0 200 200'><g transform='${capOnDoh(pose)}'>${CAP}</g></svg>`;
  return (
    <View pointerEvents="none" style={[styles.over, { left: 0, top: 0, width, height: width }]}>
      <SvgXml xml={xml} width={width} height={width} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </View>
  );
});

/** A Practice picture, with the cap on when it is Doh and the season is on (Practice only: board d-christmas/03). */
export const CappedArt = memo(function CappedArt({
  name,
  width,
  cap,
  style,
}: {
  name: ArtName;
  width: number;
  cap: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const wears = cap && name.startsWith("doh-") && name !== "doh-avatar";
  if (!wears) return <Art name={name} width={width} style={style} />;
  return (
    <View style={[{ width, height: Math.round(width * artRatio(name)) }, style]}>
      <Art name={name} width={width} />
      <DohCap width={width} pose={name} />
    </View>
  );
});

const styles = StyleSheet.create({
  over: { position: "absolute" },
});
