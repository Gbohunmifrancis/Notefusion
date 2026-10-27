import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "./Icon";
import { Touchable } from "./Touchable";
import { fonts, radii, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

export interface ChoiceChip {
  label: string;
  /** `accent` for "Last time"; `neutral` (default) for a cost or a note. */
  tone?: "accent" | "neutral";
}

export interface ChoiceRowProps {
  title: string;
  /** A plain line under the title ("One more transcription. No subscription."). */
  detail?: string;
  /** Right-aligned on the title line ("₦3,000"); `priceUnit` follows it small ("/ month"). */
  price?: string;
  priceUnit?: string;
  /** The tile's icon; a row without one is a plain choice (a reason, an answer). */
  icon?: IconName;
  /** The tile's colour: neutral with an ink icon by default (blue once selected), gold for Pro, violet for the choir. */
  tone?: "accent" | "premium" | "choir";
  chips?: ChoiceChip[];
  /** Drawn chosen (blue border and wash), for a choice that a button then confirms. */
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

/**
 * A choice you tap once (board 7b, a-core/03): an icon tile, the choice, what it costs. Used by
 * offer sheets, "What is this recording?" and the cancel survey.
 */
export function ChoiceRow({
  title,
  detail,
  price,
  priceUnit,
  icon,
  tone = "accent",
  chips,
  selected = false,
  onPress,
  accessibilityLabel,
}: ChoiceRowProps) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const tile = tone === "premium" ? c.premiumSoft : tone === "choir" ? c.choirSoft : c.sheetTile;
  const ink = tone === "premium" ? c.premium : tone === "choir" ? c.choir : selected ? c.link : c.icon;
  return (
    <Touchable
      onPress={onPress}
      scaleTo={0.98}
      radius={14}
      style={[styles.choice, !icon && styles.choicePlain, selected && styles.choiceOn]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={
        accessibilityLabel ??
        [title, price && `${price}${priceUnit ? ` ${priceUnit}` : ""}`, detail, ...(chips ?? []).map((x) => x.label)]
          .filter(Boolean)
          .join(", ")
      }
    >
      {icon ? (
        <View style={[styles.tile, { backgroundColor: tile }]}>
          <Icon name={icon} size={22} color={ink} />
        </View>
      ) : null}
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.title}>{title}</Text>
          {price ? (
            <Text style={styles.price}>
              {price}
              {priceUnit ? <Text style={styles.unit}> {priceUnit}</Text> : null}
            </Text>
          ) : null}
        </View>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        {chips && chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((chip) => (
              <View key={chip.label} style={[styles.chip, chip.tone === "accent" && styles.chipAccent]}>
                <Text style={[styles.chipText, chip.tone === "accent" && styles.chipTextAccent]}>{chip.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Touchable>
  );
}

export interface OptionRowProps {
  label: string;
  icon?: IconName;
  /** A line under the label, in full (About's piano credit, which the licence asks for word for word). */
  detail?: string;
  /** An arrow out: the row opens the browser. */
  external?: boolean;
  /** A tick on the current choice (the sort order, the folder a sheet is in). */
  selected?: boolean;
  /** A loss: the word in red, the icon left neutral. Opens a destructive confirm, never acts at once. */
  destructive?: boolean;
  /** First row of the sheet: no rule above it. */
  first?: boolean;
  onPress?: () => void;
}

/** One action in an options sheet (board 7c): a small icon, the action, a tick if it is the current one. */
export function OptionRow({
  label,
  icon,
  detail,
  external = false,
  selected = false,
  destructive = false,
  first = false,
  onPress,
}: OptionRowProps) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const labelText = (
    <Text
      style={[styles.optionLabel, detail ? styles.optionLabelOver : null, destructive && { color: c.dangerText }]}
      numberOfLines={2}
    >
      {label}
    </Text>
  );
  return (
    <Touchable
      onPress={onPress}
      disabled={!onPress}
      scaleTo={0.99}
      radius={10}
      haptic={destructive ? "warning" : "light"}
      style={[styles.option, detail ? styles.optionTall : null]}
      accessibilityRole={external ? "link" : undefined}
      accessibilityState={{ selected }}
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
    >
      {!first ? <View style={[styles.rule, icon ? styles.ruleInset : null]} /> : null}
      {icon ? (
        <View style={[styles.optionIcon, destructive && styles.optionIconPlain]}>
          <Icon name={icon} size={18} color={destructive ? c.textMuted : c.icon} />
        </View>
      ) : null}
      {detail ? (
        <View style={styles.optionText}>
          {labelText}
          <Text style={styles.optionDetail}>{detail}</Text>
        </View>
      ) : (
        labelText
      )}
      {selected ? <Icon name="check" size={20} color={c.link} /> : null}
      {external ? (
        <Icon name="external" size={15} color={c.textFaint} style={detail ? styles.optionArrowTop : undefined} />
      ) : null}
    </Touchable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    choice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 72,
      padding: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.sheetRow,
      marginBottom: 10,
    },
    choicePlain: {
      minHeight: 52,
      paddingVertical: 12,
    },
    choiceOn: {
      borderColor: c.primary,
      backgroundColor: c.accentSoft,
    },
    tile: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    body: {
      flex: 1,
      minWidth: 0,
    },
    top: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 10,
    },
    title: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 16,
      lineHeight: 20,
      color: c.text,
    },
    price: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: c.text,
    },
    unit: {
      fontFamily: fonts.medium,
      fontSize: 12,
      color: c.textMuted,
    },
    detail: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: c.textMuted,
      marginTop: 3,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 7,
    },
    chip: {
      height: 24,
      paddingHorizontal: 9,
      borderRadius: radii.pill,
      justifyContent: "center",
      backgroundColor: c.sheetTile,
    },
    chipAccent: {
      backgroundColor: c.accentSoft,
    },
    chipText: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: c.textMuted,
    },
    chipTextAccent: {
      color: c.link,
    },

    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 52,
      paddingVertical: 8,
    },
    rule: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    ruleInset: {
      left: 44,
    },
    optionIcon: {
      width: 30,
      height: 30,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.sheetTile,
    },
    optionIconPlain: {
      backgroundColor: "transparent",
    },
    optionLabel: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 16,
      color: c.text,
    },
    /** A row with a line under its label: the icon, label and arrow hold the top, the line runs on below. */
    optionTall: {
      alignItems: "flex-start",
      paddingVertical: 12,
    },
    /** The label and its line; the label's first line centred on the 30 px tile. */
    optionText: {
      flex: 1,
      paddingTop: 5,
    },
    /** Over its line, the label takes its own height in the column rather than flexing. */
    optionLabelOver: {
      flex: 0,
      lineHeight: 20,
    },
    optionDetail: {
      fontFamily: fonts.regular,
      fontSize: 14,
      lineHeight: 20,
      color: c.textMuted,
      marginTop: 2,
    },
    /** The arrow on the label's first line. */
    optionArrowTop: {
      marginTop: 8,
    },
  });
