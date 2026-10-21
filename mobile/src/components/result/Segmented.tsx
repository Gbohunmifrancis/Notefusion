import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import { fonts, radii, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

export interface Segment<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
  /** Defaults to the label. */
  accessibilityLabel?: string;
}

/**
 * A two-way switch (board n-ux-low Q1a): one 44 px track, the chosen half in the tab's selected look (wash, accent
 * line, link words). The Result's Solfa | Staff and the doh picker's Major | Minor. `stretch` fills the width.
 */
export function Segmented<T extends string>({
  segments,
  value,
  onChange,
  stretch = false,
  style,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (id: T) => void;
  stretch?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.track, stretch && styles.trackStretch, style]} accessibilityRole="tablist">
      {segments.map((s) => {
        const on = s.id === value;
        return (
          <Touchable
            key={s.id}
            onPress={() => (on ? undefined : onChange(s.id))}
            style={[styles.segment, stretch && styles.segmentStretch, on && styles.segmentOn]}
            radius={19}
            haptic="none"
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={s.accessibilityLabel ?? s.label}
          >
            {s.icon ? <Icon name={s.icon} size={16} color={on ? colors.link : colors.textMuted} /> : null}
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {s.label}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    track: {
      flexDirection: "row",
      height: 44,
      padding: 3,
      borderRadius: radii.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignSelf: "flex-start",
    },
    trackStretch: { alignSelf: "stretch" },
    segment: {
      minWidth: 84,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingHorizontal: 14,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: "transparent",
    },
    segmentStretch: { flex: 1 },
    segmentOn: { backgroundColor: c.selectedWash, borderColor: c.accent },
    label: { fontFamily: fonts.medium, fontSize: 15, color: c.textMuted },
    labelOn: { fontFamily: fonts.semibold, color: c.link },
  });
