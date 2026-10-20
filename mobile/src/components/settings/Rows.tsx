import React from "react";
import { Animated, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fonts, motion, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import type { RootStackParams } from "../../navigation/types";

/**
 * The grouped rows of Profile, Settings and Notifications (boards a-core/04, b-system/12a–12c): a small title,
 * then a card of rows, each an icon tile, a label (and a hint only where the row needs one), and a value, a
 * chevron, a switch or a control on the right. One shape for the three pages, so a setting looks the same
 * wherever it lives. The tiles are neutral and their icons ink (e-icons board 04): a switch says on, not the tile.
 */
export function Group({
  title,
  children,
  style,
  cardStyle,
}: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** The card's own style: a sheet's groups take the sheet's row fill (a-core/11). */
  cardStyle?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  // Rows after the first draw the hairline above themselves.
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {title ? (
        <Text style={styles.groupTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, cardStyle]}>
        {rows.map((row, i) =>
          React.isValidElement<RowProps>(row) && row.type === Row ? React.cloneElement(row, { first: i === 0 }) : row,
        )}
      </View>
    </View>
  );
}

export interface RowProps {
  label: string;
  /** The tile's icon; a row without one (Delete account) is the label alone. */
  icon?: IconName;
  /** Drawn in the tile in place of `icon` (Google's G). */
  iconNode?: React.ReactNode;
  /** The choir's violet tile and icon (share with your choir, My choir); every other tile is neutral. */
  choir?: boolean;
  /** A short line under the label, only where the row needs one. */
  hint?: string;
  /** Muted, on the right ("Grace Okafor", "7pm", "Always"). */
  value?: string;
  /** A chevron: the row opens a screen or a sheet. */
  chevron?: boolean;
  /** An arrow out: the row opens the browser. */
  external?: boolean;
  /** A switch on the right. The row itself is then not a button: the switch is. */
  toggle?: { value: boolean; onChange: (on: boolean) => void; disabled?: boolean };
  /** Any other control on the right (Theme's Night | Day). */
  trailing?: React.ReactNode;
  /** The one red word on the page (Delete account): the label in red, nothing else. */
  destructive?: boolean;
  /** Dimmed with what it depends on (the reminder rows while push is off). */
  dim?: boolean;
  /** A blue wash at this opacity (0–1): the reminder hour, just saved, glows for a moment. */
  flash?: Animated.Value;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Set by `Group`. */
  first?: boolean;
}

export function Row({
  label,
  icon,
  iconNode,
  choir = false,
  hint,
  value,
  chevron = false,
  external = false,
  toggle,
  trailing,
  destructive = false,
  dim = false,
  flash,
  onPress,
  accessibilityLabel,
  first = true,
}: RowProps) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const hasTile = Boolean(icon || iconNode);

  const body = (
    <View style={[styles.row, hint ? styles.rowTwo : null]}>
      {flash ? <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} /> : null}
      {!first ? <View style={[styles.rule, hasTile ? styles.ruleInset : null]} /> : null}
      <View style={[styles.inner, dim && styles.dim]}>
        {hasTile ? (
          <View style={[styles.tile, choir && { backgroundColor: c.choirSoft }]}>
            {iconNode ?? <Icon name={icon!} size={18} color={choir ? c.choir : c.icon} />}
          </View>
        ) : null}
        <View style={styles.text}>
          <Text style={[styles.label, destructive && { color: c.dangerText }]} numberOfLines={1}>
            {label}
          </Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
        {value ? (
          <Text style={styles.value} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {trailing}
        {toggle ? (
          <Switch
            value={toggle.value}
            onValueChange={toggle.onChange}
            disabled={toggle.disabled}
            trackColor={{ false: c.grabber, true: c.primary }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={c.grabber}
            accessibilityLabel={label}
          />
        ) : null}
        {chevron ? <Icon name="chevron" size={16} color={c.textFaint} /> : null}
        {external ? <Icon name="external" size={15} color={c.textFaint} /> : null}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Touchable
      onPress={onPress}
      // Full-bleed: a deeper press would pull the row away from both edges of its card.
      scaleTo={motion.scale.row}
      haptic={destructive ? "warning" : "light"}
      accessibilityLabel={accessibilityLabel ?? [label, value].filter(Boolean).join(", ")}
      // The line under the name is read too (the label above replaces the row's own words).
      accessibilityHint={hint}
    >
      {body}
    </Touchable>
  );
}

/** Two or three choices you can see at once (Theme: Night | Day). Each segment takes a 44 px tap. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; icon: IconName }[];
  value: T;
  onChange: (next: T) => void;
  /** Read before each option: "Theme". */
  label: string;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Touchable
            key={o.value}
            onPress={() => {
              if (!on) onChange(o.value);
            }}
            hitSlop={6}
            scaleTo={0.97}
            radius={8}
            ripple={false}
            style={[styles.segItem, on && styles.segOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label}: ${o.label}`}
          >
            <Icon name={o.icon} size={15} color={on ? c.text : c.textMuted} />
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Touchable>
        );
      })}
    </View>
  );
}

/** The plain line under a group: the reminder's rules, "Receipts and sign-in codes always come." */
export function GroupNote({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={[styles.note, style]}>{children}</Text>;
}

/** The back button of a pushed screen (Profile, Settings, Notifications). */
export function BackButton() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Touchable
      onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate("Tabs", { screen: "Home" }))}
      hitSlop={4}
      radius={12}
      accessibilityLabel="Go back"
      style={styles.back}
    >
      <Icon name="back" size={20} color={c.text} />
    </Touchable>
  );
}

/** A pushed screen's big title, under its back button (Settings, Notifications). */
export function PageTitle({ children }: { children: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text style={styles.pageTitle} accessibilityRole="header">
      {children}
    </Text>
  );
}

const TILE = 30;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    groupTitle: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: c.textFaint,
      marginTop: 22,
      marginBottom: 8,
      marginLeft: 4,
    },
    group: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 14,
      overflow: "hidden",
    },
    row: {
      minHeight: 54,
      justifyContent: "center",
      paddingHorizontal: 14,
    },
    rowTwo: {
      minHeight: 64,
      paddingVertical: 10,
    },
    flash: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: c.accentSoft,
    },
    inner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    dim: {
      opacity: 0.4,
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
      left: 14 + TILE + 14,
    },
    tile: {
      width: TILE,
      height: TILE,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.sheetTile,
    },
    text: {
      flex: 1,
      minWidth: 0,
    },
    label: {
      fontFamily: fonts.medium,
      fontSize: 16,
      color: c.text,
    },
    hint: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 17,
      color: c.textMuted,
      marginTop: 2,
    },
    value: {
      flexShrink: 1,
      maxWidth: "55%",
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.textMuted,
    },

    seg: {
      flexDirection: "row",
      gap: 2,
      padding: 3,
      borderRadius: 10,
      backgroundColor: c.sheetTile,
    },
    segItem: {
      height: 32,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    segOn: {
      backgroundColor: c.bgElevated,
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.18,
      shadowRadius: 3,
      elevation: 1,
    },
    segText: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: c.textMuted,
    },
    segTextOn: {
      color: c.text,
    },

    note: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: c.textFaint,
      marginTop: 8,
      marginHorizontal: 16,
    },

    back: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    pageTitle: {
      fontFamily: fonts.bold,
      fontSize: 30,
      lineHeight: 35,
      letterSpacing: -0.6,
      color: c.text,
      marginTop: 14,
      marginBottom: 2,
      marginHorizontal: 4,
    },
  });
