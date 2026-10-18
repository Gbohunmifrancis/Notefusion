import React, { useEffect, useState } from "react";
import { Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { HomeScreen } from "../screens/HomeScreen";
import { RecordScreen } from "../screens/RecordScreen";
import { LibraryScreen } from "../screens/LibraryScreen";
import { PracticeScreen } from "../screens/PracticeScreen";
import { HymnsScreen } from "../screens/HymnsScreen";
import { Touchable } from "../components/Touchable";
import { Mark } from "../components/night/NightUI";
import { fonts, motion, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { TAB_ORDER, type TabName } from "../lib/navTargets";
import type { TabParams } from "../navigation/types";

const Tab = createBottomTabNavigator<TabParams>();

/**
 * Five labelled cells (board a-core/04): Home · Library · Record (centre) · Practice · Hymns, in `TAB_ORDER`.
 * Every cell is `flex: 1` in the row, so the odd count puts the record button in the geometric middle. Labels,
 * because a flame or a book alone does not say "Practice" or "Hymns". The record button is the mark on its ink
 * circle.
 */
const CELLS: Record<TabName, { label: string; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap }> = {
  Home: { label: "Home", icon: "home-outline", iconActive: "home" },
  Library: { label: "Library", icon: "albums-outline", iconActive: "albums" },
  Record: { label: "Record", icon: "mic", iconActive: "mic" },
  Practice: { label: "Practice", icon: "flame-outline", iconActive: "flame" },
  Hymns: { label: "Hymns", icon: "book-outline", iconActive: "book" },
};

/** The record button, by diameter. */
const RECORD = 52;

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

  // The bar goes while the keyboard is up.
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
            if (!focused && !event.defaultPrevented) navigation.navigate(name);
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
                <View style={styles.centerBtn}>
                  <Mark height={26} />
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
              <Ionicons
                name={focused ? cell.iconActive : cell.icon}
                size={22}
                color={focused ? colors.link : colors.textFaint}
              />
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
  });
