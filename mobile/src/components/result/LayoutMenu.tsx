import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "../Icon";
import { Sheet, SheetTitle } from "../Sheet";
import { Touchable } from "../Touchable";
import { fonts, radii, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { layoutsFor, type SolfaLayout } from "../../lib/readingLayouts";

const ICONS: Record<SolfaLayout, IconName> = { bars: "solfa", grid: "rhythm", curwen: "music", hymn: "lyrics" };

/** A layout's sample: the tune's first bar as it writes it, and for Hymn the words sung on it. */
export type LayoutSamples = Partial<Record<SolfaLayout, { solfa: string; words?: string } | null>>;

/**
 * The Layout menu (board n-ux-low Q1b): the app's options sheet, a row per way of reading the solfa, each with its
 * name, what it is in a line, and the tune's own first bar as that layout writes it, so the difference is seen before
 * the tap. The one in use is ticked; Hymn is listed only when the sheet has words.
 */
export function LayoutMenu({
  visible,
  current,
  hasLyrics,
  samples,
  onChoose,
  onClose,
}: {
  visible: boolean;
  current: SolfaLayout;
  hasLyrics: boolean;
  samples: LayoutSamples;
  onChoose: (layout: SolfaLayout) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle>Layout</SheetTitle>
      {/* Grows to its rows; on a short phone they scroll rather than push the sheet off the top. */}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={styles.group}>
          {layoutsFor(hasLyrics).map((layout, i) => {
            const on = layout.id === current;
            const sample = samples[layout.id];
            return (
              <Touchable
                key={layout.id}
                onPress={() => (on ? onClose() : onChoose(layout.id))}
                scaleTo={0.99}
                ripple={false}
                style={styles.row}
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${layout.name}. ${layout.line}`}
              >
                {i > 0 ? <View style={styles.rule} /> : null}
                <View style={styles.tile}>
                  <Icon name={ICONS[layout.id]} size={18} color={on ? colors.link : colors.icon} />
                </View>
                <View style={styles.text}>
                  <Text style={[styles.name, on && styles.nameOn]}>{layout.name}</Text>
                  <Text style={styles.line}>{layout.line}</Text>
                  {sample ? (
                    <Text style={styles.sample} numberOfLines={1}>
                      {sample.solfa}
                    </Text>
                  ) : null}
                  {sample?.words ? (
                    <Text style={styles.words} numberOfLines={1}>
                      {sample.words}
                    </Text>
                  ) : null}
                </View>
                {on ? <Icon name="check" size={20} color={colors.link} /> : null}
              </Touchable>
            );
          })}
        </View>
        <Text style={styles.foot}>Hymn shows when the sheet has words.</Text>
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    scroll: { flexGrow: 0 },
    group: {
      marginTop: 4,
      backgroundColor: c.sheetRow,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 64,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    rule: {
      position: "absolute",
      top: 0,
      left: 58,
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    tile: {
      width: 30,
      height: 30,
      borderRadius: radii.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.sheetTile,
      alignSelf: "flex-start",
      marginTop: 2,
    },
    text: { flex: 1, minWidth: 0 },
    name: { fontFamily: fonts.medium, fontSize: 16, color: c.text },
    nameOn: { fontFamily: fonts.semibold, color: c.link },
    line: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: c.textMuted, marginTop: 2 },
    sample: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 13,
      letterSpacing: 0.3,
      color: c.textMuted,
      marginTop: 4,
    },
    words: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 1 },
    foot: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 10 },
  });
