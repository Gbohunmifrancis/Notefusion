import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen";
import { RecordScreen } from "../screens/RecordScreen";
import { LibraryScreen } from "../screens/LibraryScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { Touchable } from "../components/Touchable";
import { Mark } from "../components/night/NightUI";
import { motion, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams, TabParams } from "../navigation/types";

const Tab = createBottomTabNavigator<TabParams>();

/**
 * Five cells, not three — and five because the count must be odd.
 *
 * Every cell is `flex: 1` in a `space-around` row, so only an odd count puts the mic
 * in the geometric middle. Profile came back off the side bar to make the count work
 * and because it is a destination people look for in a tab bar. Songs is a *launcher*:
 * pasting a link is an action, not a place to be. Its entry in `TABS` carries a `push`
 * key, and `onPress` navigates the root stack rather than switching tabs; it has no
 * `Tab.Screen` and `focused` is always false — it reads as an action, like Record.
 *
 * Order: Home · Library · Record(centre) · Songs · Profile.
 */

interface TabEntry {
  name: keyof TabParams;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  isCenter?: boolean;
  /** When set, pressing this cell pushes a root-stack route instead of switching tabs. */
  push?: keyof RootStackParams;
}

const TABS: TabEntry[] = [
  { name: "Home",    label: "Home",    icon: "home-outline",          iconActive: "home" },
  { name: "Library", label: "Library", icon: "albums-outline",        iconActive: "albums" },
  { name: "Record",  label: "Record",  icon: "mic",                   iconActive: "mic",   isCenter: true },
  // Songs is a push action — `name` is a placeholder (no Tab.Screen exists for it,
  // so `focused` is always false) and `push` drives the actual navigation.
  { name: "Home", label: "Songs", icon: "link-outline", iconActive: "link", push: "Link" },
  { name: "Profile", label: "Profile", icon: "person-outline",        iconActive: "person" },
];

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

  if (keyboardVisible) return null;

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.xs }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        {TABS.map((tab, index) => {
          // Songs launcher: always unfocused, pushes the root stack.
          if (tab.push) {
            return (
              <Touchable
                key={`push-${tab.label}`}
                accessibilityLabel="Transcribe a song from a link"
                accessibilityRole="button"
                onPress={() =>
                  navigation
                    .getParent<NativeStackNavigationProp<RootStackParams>>()
                    ?.navigate("Link")
                }
                ripple="borderless"
                style={styles.tabItem}
              >
                <Ionicons name={tab.icon} size={23} color={colors.textMuted} />
                <View style={styles.dotSlot} />
              </Touchable>
            );
          }

          const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
          const focused = state.index === routeIndex;

          const onPress = () => {
            const route = state.routes.find((r) => r.name === tab.name);
            if (route) {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(tab.name);
              }
            }
          };

          if (tab.isCenter) {
            // The mark is the record button: the one thing the app is for.
            return (
              <Touchable
                key={`center-${tab.label}`}
                accessibilityLabel="Record a melody"
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
              key={`${tab.label}-${index}`}
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={tab.label}
              accessibilityRole="button"
              onPress={onPress}
              ripple="borderless"
              style={styles.tabItem}
            >
              <Ionicons
                name={focused ? tab.iconActive : tab.icon}
                size={23}
                color={focused ? colors.text : colors.textMuted}
              />
              <View style={styles.dotSlot}>{focused && <View style={styles.dot} />}</View>
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
      <Tab.Screen name="Home"    component={HomeScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="Record"  component={RecordScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
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
    dotSlot: { height: 4, marginTop: 5, justifyContent: "center" },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.accent },
    centerBtn: {
      width: 52,
      height: 52,
      borderRadius: 26,
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
