import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { HomeScreen } from "../screens/HomeScreen";
import { RecordScreen } from "../screens/RecordScreen";
import { LibraryScreen } from "../screens/LibraryScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import {
  fonts,
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { TabParams } from "./types";

const Tab = createBottomTabNavigator<TabParams>();

const TABS: {
  name: keyof TabParams;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}[] = [
  { name: "Home", label: "Home", icon: "home-outline", iconActive: "home" },
  {
    name: "Record",
    label: "Record",
    icon: "radio-outline",
    iconActive: "radio",
  },
  {
    name: "Library",
    label: "Library",
    icon: "albums-outline",
    iconActive: "albums",
  },
  {
    name: "Profile",
    label: "Profile",
    icon: "person-outline",
    iconActive: "person",
  },
];

/**
 * Floating dark-glass tab bar.
 *
 * The bar sits on a Mist canvas inside a glass pill:
 *   • Resting tabs  — muted Zinc (#94A3B8) icon, no label.
 *   • Active tab    — "The Fusion" gradient chip (Deep Blue → Bright Blue)
 *                     with a filled icon + label in Ink Navy.
 *
 * The pill itself uses the same recipe as every Card:
 * White fill, slate hairline border, faint blue shadow.
 */
function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <View
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets.bottom, spacing.md) },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const tab = TABS.find((t) => t.name === route.name) ?? TABS[index];

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={tab.label}
              activeOpacity={0.85}
              onPress={onPress}
              style={styles.itemWrap}
            >
              {focused ? (
                // ── Active — gradient chip ─────────────────────────────────
                <LinearGradient
                  colors={gradients.brand} // #2563EB → #3B82F6
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.itemActive}
                >
                  <Ionicons name={tab.iconActive} size={18} color="#FFFFFF" />
                  <Text style={styles.itemLabel}>{tab.label}</Text>
                </LinearGradient>
              ) : (
                // ── Inactive — muted icon only ─────────────────────────────
                <View style={styles.itemInactive}>
                  <Ionicons
                    name={tab.icon}
                    size={22}
                    color={colors.textFaint}
                  />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Authenticated shell: four primary destinations with a floating glass tab bar. */
export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Record" component={RecordScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    /** Full-width absolute footer — sits above all screen content. */
    wrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
    },

    /**
     * The pill container.
     * Raised fill + hairline border.
     * Blue shadow lifts it off the canvas.
     */
    bar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
      borderWidth: 1,
      borderColor: c.border,
      // Blue halo
      shadowColor: c.purple,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 20,
      elevation: 12,
    },

    /** Outer touch target — same size for active and inactive. */
    itemWrap: {
      alignItems: "center",
      justifyContent: "center",
      minWidth: 52,
    },

    /**
     * Active — gradient pill chip.
     * overflow:hidden clips the gradient to the pill radius on Android.
     */
    itemActive: {
      flexDirection: "row",
      alignItems: "center",
      height: 46,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.pill,
      overflow: "hidden",
      // Gradient glow
      shadowColor: c.purple,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 12,
      elevation: 6,
    },

    /** Active tab label — sits on the brand gradient, so always white. */
    itemLabel: {
      ...typography.label,
      color: "#FFFFFF",
      fontSize: 13,
      fontFamily: fonts.bold,
      marginLeft: spacing.sm,
    },

    /** Inactive — just the muted icon, centred in a square hit area. */
    itemInactive: {
      width: 46,
      height: 46,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.pill,
    },
  });
