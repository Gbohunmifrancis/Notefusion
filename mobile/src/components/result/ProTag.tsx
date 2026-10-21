import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { fonts, radii, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

/** The short PRO tag on a locked row (an export a 314 px row has no room to price). Gold is Pro's alone. */
export function ProTag() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.short}>
      <Icon name="pro" size={11} color={colors.premiumDeep} />
      <Text style={styles.shortText}>PRO</Text>
    </View>
  );
}

/**
 * The tag on a locked panel's heading (board n-ux-low Q1h): what Pro costs, "Pro · ₦7,500 a month" (`lib/price`
 * `monthPrice`), so the tap to Upgrade is not a tap to find out. "Pro" alone until the plans have loaded.
 */
export function ProPriceTag({ price }: { price: string | null }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.priced}>
      <Icon name="pro" size={12} color={colors.premiumDeep} />
      <Text style={styles.pricedText} numberOfLines={1}>
        {price ? `Pro · ${price}` : "Pro"}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    short: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: c.premiumSoft,
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    shortText: { ...typography.caption, color: c.premiumText, fontFamily: fonts.semibold, fontSize: 10 },
    priced: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      height: 24,
      paddingHorizontal: 9,
      borderRadius: radii.pill,
      backgroundColor: c.premiumSoft,
      flexShrink: 1,
    },
    pricedText: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 12, color: c.premiumText },
  });
