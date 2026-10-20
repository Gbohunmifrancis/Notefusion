import React, { useEffect, useState } from "react";
import { Animated, Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useReducedMotion } from "react-native-reanimated";
import { HomeScreen } from "../screens/HomeScreen";
import { RecordScreen } from "../screens/RecordScreen";
import { LibraryScreen } from "../screens/LibraryScreen";
import { PracticeScreen } from "../screens/PracticeScreen";
import { HymnsScreen } from "../screens/HymnsScreen";
import { Icon, type IconName } from "../components/Icon";
import { Touchable } from "../components/Touchable";
import { Mark } from "../components/night/NightUI";
import { fonts, motion, spacing, type Palette } from "../design/theme";
import { useColors, useTheme, useThemedStyles } from "../lib/theme";
import { useBreath } from "../lib/breath";
import { TAB_ORDER, type TabName } from "../lib/navTargets";
import { leaveThrough } from "../lib/leaveGuard";
import type { TabParams } from "../navigation/types";

const Tab = createBottomTabNavigator<TabParams>();

/**
 * Five labelled cells (board a-core/04): Home · Library · Record (centre) · Practice · Hymns, in `TAB_ORDER`.
 * Every cell is `flex: 1` in the row, so the odd count puts the record button in the geometric middle. Labels,
 * because a tuning fork or a hymnal alone does not say "Practice" or "Hymns". Our own glyphs (e-icons board 01):
 * a house, a stack of sheets with a note, the tuning fork (the flame is the streak's), an open hymnal. The active
 * tab is the same line in blue over a 20% wash, never a heavier glyph. The record button is the mark on its ink
 * circle, with a slow halo behind it ({@link RecordHalo}); it has no icon. On the Record tab it takes the selected
 * look instead (board m-ux-medium P3d): the mark in link blue on a 20% wash inside a blue line, no glow, so it reads
 * "you are here" and never as a second record button under the real one.
 */
const CELLS: Record<TabName, { label: string; icon: IconName }> = {
  Home: { label: "Home", icon: "home" },
  Library: { label: "Library", icon: "library" },
  Record: { label: "Record", icon: "mic" },
  Practice: { label: "Practice", icon: "practice" },
  Hymns: { label: "Hymns", icon: "hymns" },
};

/** The record button and its halo, by diameter. */
const RECORD = 52;
const HALO = 116;

function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // The bar (and with it the halo's breath) goes while the keyboard is up.
  if (keyboardVisible) return null;

  const current = state.routes[state.index]?.name;

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.xs }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        {TAB_ORDER.map((name) => {
          const cell = CELLS[name];
          const route = state.routes.find((r) => r.name === name);
          const focused = current === name;

          const onPress = () => {
            if (!route) return;
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            // A take being recorded asks first (lib/leaveGuard): the tab bar no longer walks away from it.
            if (!focused && !event.defaultPrevented) leaveThrough(() => navigation.navigate(name));
          };

          if (name === "Record") {
            // The mark is the record button: the one thing the app is for.
            return (
              <Touchable
                key={name}
                accessibilityLabel="Record"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityRole="button"
                onPress={onPress}
                haptic="medium"
                scaleTo={motion.scale.large}
                ripple={false}
                style={styles.tabItem}
              >
                <View style={styles.centre}>
                  {focused ? null : <RecordHalo breathing />}
                  <View style={[styles.centerBtn, focused && styles.centerBtnHere]}>
                    <Mark height={26} color={focused ? colors.link : undefined} />
                  </View>
                </View>
              </Touchable>
            );
          }

          return (
            <Touchable
              key={name}
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={cell.label}
              accessibilityRole="button"
              onPress={onPress}
              ripple="borderless"
              style={styles.tabItem}
            >
              <Icon name={cell.icon} size={24} filled={focused} color={focused ? colors.link : colors.textFaint} />
              <Text
                style={[styles.label, focused && styles.labelOn]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {cell.label}
              </Text>
            </Touchable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The record button's halo (board a-core/05): a soft blue light behind it that swells and settles every 3.6 s,
 * on the breath Home's big mic shares (`lib/breath`). The button itself never moves or changes colour, so it
 * never reads as already recording. Night 0.08 → 0.26 at the core, Day 0.05 → 0.16, scale 0.96 → 1.04. It is
 * gone on the Record tab; Reduce Motion holds it at 0.14 (Day 0.09). Opacity and scale only, on the native driver.
 */
function RecordHalo({ breathing }: { breathing: boolean }) {
  const colors = useColors();
  const { mode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const breath = useBreath(breathing && !reduceMotion);
  const night = mode === "dark";

  const opacity = reduceMotion
    ? night ? 0.14 : 0.09
    : breath.interpolate({ inputRange: [0, 1], outputRange: night ? [0.08, 0.26] : [0.05, 0.16] });
  const scale = reduceMotion ? 1 : breath.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] });

  return (
    <Animated.View pointerEvents="none" style={[styles.halo, { opacity, transform: [{ scale }] }]}>
      <Svg width={HALO} height={HALO}>
        <Defs>
          <RadialGradient id="recordHalo" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.primary} stopOpacity={1} />
            <Stop offset="0.42" stopColor={colors.primary} stopOpacity={1} />
            <Stop offset="0.66" stopColor={colors.primary} stopOpacity={0.38} />
            <Stop offset="1" stopColor={colors.primary} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={HALO / 2} cy={HALO / 2} r={HALO / 2} fill="url(#recordHalo)" />
      </Svg>
    </Animated.View>
  );
}

/** Authenticated shell with bottom tab bar. */
export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="Record" component={RecordScreen} />
      <Tab.Screen name="Practice" component={PracticeScreen} />
      <Tab.Screen name="Hymns" component={HymnsScreen} />
    </Tab.Navigator>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.lg,
      backgroundColor: "transparent",
    },
    /** A floating glass pill: semi-opaque rather than blurred, so it ships over the air. */
    bar: {
      flexDirection: "row",
      alignItems: "center",
      height: 64,
      borderRadius: 32,
      paddingHorizontal: spacing.sm,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.35,
      shadowRadius: 24,
      elevation: 12,
    },
    tabItem: {
      flex: 1,
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      marginTop: 3,
      fontFamily: fonts.medium,
      fontSize: 11,
      color: c.textFaint,
    },
    labelOn: {
      fontFamily: fonts.semibold,
      color: c.text,
    },
    /** Centres the halo and the button on one point; the halo spills past the bar, untouchable. */
    centre: {
      width: RECORD,
      height: RECORD,
      alignItems: "center",
      justifyContent: "center",
    },
    halo: {
      position: "absolute",
      width: HALO,
      height: HALO,
      left: (RECORD - HALO) / 2,
      top: (RECORD - HALO) / 2,
    },
    centerBtn: {
      width: RECORD,
      height: RECORD,
      borderRadius: RECORD / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.ink,
      shadowColor: c.ink,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.5,
      shadowRadius: 14,
      elevation: 10,
    },
    /** On the Record tab: the tabs' selected look, the brand blue's 20% wash inside its line, no glow. */
    centerBtnHere: {
      backgroundColor: c.purple + "33",
      borderWidth: 1.5,
      borderColor: c.accent,
      shadowOpacity: 0,
      elevation: 0,
    },
  });
