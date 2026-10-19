/**
 * What the brand mark and Doh wear while a season is on: Christmas's cap (board d-christmas/01) or Halloween's witch
 * hat (board j-halloween/01). Each is one SVG, drawn once (design/practice-art/season.mjs, shipped in
 * `practice/art/svgs.ts` as `season-cap` and `season-hat`), placed by lib/season: on the mark's 331 × 438 box (larger
 * at header sizes) or on Doh's 200 × 200. It sits over the picture, which never changes; it is never put on a control
 * (the record button stays bare), and a screen wears one at most.
 *
 * react-native-svg only: no native module, so it ships over the air.
 */

import React, { memo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";

import { ART, type ArtName } from "../practice/art/svgs";
import { Art, artRatio } from "../practice/Art";
import { costumeOnDoh, costumeOnMark, type Costume } from "../../lib/season";

/** A costume's own drawing, its brim's middle moved to (0, 0). */
function drawing(name: ArtName): string {
  const inner = ART[name].replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<g transform='translate(-100 -125)'>${inner}</g>`;
}

const DRAWN: Record<Costume, string> = {
  cap: drawing("season-cap"),
  hat: drawing("season-hat"),
};

const MARK_W = 331;
const MARK_H = 438;
/** Room round the mark's box for the costume, which rises above the "5" and leans out to its left. */
const PAD_TOP = 170;
const PAD_LEFT = 50;

/** The costume over a mark `height` px tall: put it inside a box exactly the mark's size (`position: relative`). */
export const MarkCostume = memo(function MarkCostume({ height, costume }: { height: number; costume: Costume }) {
  const s = height / MARK_H;
  const w = (MARK_W + PAD_LEFT) * s;
  const h = (MARK_H + PAD_TOP) * s;
  const xml = `<svg viewBox='${-PAD_LEFT} ${-PAD_TOP} ${MARK_W + PAD_LEFT} ${MARK_H + PAD_TOP}'><g transform='${costumeOnMark(costume, height)}'>${DRAWN[costume]}</g></svg>`;
  return (
    <View pointerEvents="none" style={[styles.over, { left: -PAD_LEFT * s, top: -PAD_TOP * s, width: w, height: h }]}>
      <SvgXml xml={xml} width={w} height={h} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </View>
  );
});

/** The costume over Doh in a box `width` px wide (Doh's poses are square), tipped back so his note-crest shows. */
export const DohCostume = memo(function DohCostume({ width, pose, costume }: { width: number; pose: string; costume: Costume }) {
  const xml = `<svg viewBox='0 0 200 200'><g transform='${costumeOnDoh(costume, pose)}'>${DRAWN[costume]}</g></svg>`;
  return (
    <View pointerEvents="none" style={[styles.over, { left: 0, top: 0, width, height: width }]}>
      <SvgXml xml={xml} width={width} height={width} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </View>
  );
});

/**
 * A Practice picture, with the season's costume on when it is Doh (Practice only: boards d-christmas/03 and
 * j-halloween/03). `costume` null: the picture as always.
 */
export const CostumedArt = memo(function CostumedArt({
  name,
  width,
  costume,
  style,
}: {
  name: ArtName;
  width: number;
  costume: Costume | null;
  style?: StyleProp<ViewStyle>;
}) {
  const wears = costume != null && name.startsWith("doh-") && name !== "doh-avatar";
  if (!wears) return <Art name={name} width={width} style={style} />;
  return (
    <View style={[{ width, height: Math.round(width * artRatio(name)) }, style]}>
      <Art name={name} width={width} />
      <DohCostume width={width} pose={name} costume={costume} />
    </View>
  );
});

const styles = StyleSheet.create({
  over: { position: "absolute" },
});
