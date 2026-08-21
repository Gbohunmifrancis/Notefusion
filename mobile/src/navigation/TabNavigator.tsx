import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { HomeScreen } from "../screens/HomeScreen";
import { RecordScreen } from "../screens/RecordScreen";
import { LibraryScreen } from "../screens/LibraryScreen";
import {
  fonts,
  spacing,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { TabParams } from "../navigation/types";

const Tab = createBottomTabNavigator<TabParams>();

const TABS: {
  name: keyof TabParams;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
  isCenter?: boolean;
}[] = [
  { name: "Home", label: "Home", icon: "home-outline", iconActive: "home" },
  { name: "Record", label: "Record", icon: "mic", iconActive: "mic", isCenter: true },
  { name: "Library", label: "Library", icon: "folder-outline", iconActive: "folder" },
];

/**
 * Tab bar matching Image 3 design sheet:
 * Automatically hides when software keyboard is open so bottom icons never shift up over inputs.
 *
 * Three items, with the mic in the middle. It used to be five: Profile and Subscription were
 * kept purely because dropping to four left the mic off-centre, and the mic is the one control
 * this layout is built around. Every cell is `flex: 1` in a `space-around` row, so what centres
 * the mic is an *odd* count — three does it as well as five, without two tabs nobody reached
 * for. Both of those destinations now live in the side bar (`components/AppDrawer.tsx`).
 */
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

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Hide bottom tab bar completely when keyboard is open
  if (keyboardVisible) {
    return null;
  }

  return (
    <View
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets.bottom, spacing.xs) },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        {TABS.map((tab, index) => {
          let targetRouteName: keyof TabParams = tab.name;
          const routeIndex = state.routes.findIndex((r) => r.name === targetRouteName);
          const focused = state.index === routeIndex;

          const onPress = () => {
            const route = state.routes.find((r) => r.name === targetRouteName);
            if (route) {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(targetRouteName);
              }
            }
          };

          if (tab.isCenter) {
            return (
              <TouchableOpacity
                key={`center-${tab.label}`}
                accessibilityRole="button"
                accessibilityLabel="Record melody"
                activeOpacity={0.85}
                onPress={onPress}
                style={styles.centerBtnWrap}
              >
                <View style={styles.centerBtn}>
                  <Ionicons name="mic" size={26} color="#FFFFFF" />
                </View>
                <Text style={[styles.tabLabel, styles.centerLabel]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={`${tab.label}-${index}`}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={tab.label}
              activeOpacity={0.85}
              onPress={onPress}
              style={styles.tabItem}
            >
              <Ionicons
                name={focused ? tab.iconActive : tab.icon}
                size={22}
                color={focused ? colors.accent : colors.textMuted}
              />
              <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
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
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Record" component={RecordScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
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
      alignItems: "center",
      backgroundColor: "transparent",
    },

    bar: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-around",
      backgroundColor: c.surface,
      width: "100%",
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs + 2,
      borderTopWidth: 0,
      elevation: 8,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
    },

    tabItem: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 2,
    },

    tabLabel: {
      fontSize: 11,
      fontFamily: fonts.medium,
      color: c.textMuted,
      marginTop: 3,
    },

    tabLabelActive: {
      fontFamily: fonts.bold,
      color: c.accent,
    },

    centerBtnWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      marginTop: -20,
    },

    centerBtn: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: "#2563EB",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#2563EB",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 10,
      elevation: 8,
    },

    centerLabel: {
      marginTop: 4,
      fontFamily: fonts.bold,
      color: c.accent,
    },
  });
