import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { RecordScreen } from '../screens/RecordScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { colors, radii, shadow, spacing, typography } from '../design/theme';
import type { TabParams } from './types';

const Tab = createBottomTabNavigator<TabParams>();

const TABS: { name: keyof TabParams; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'Home', label: 'Home', icon: 'home' },
  { name: 'Record', label: 'Listen', icon: 'radio' },
  { name: 'Library', label: 'Library', icon: 'albums' },
  { name: 'Profile', label: 'Profile', icon: 'person' },
];

/**
 * A floating white pill tab bar. The active destination expands into a dark ink
 * chip with its label beside the icon; the rest stay as muted glyphs — matching
 * the light-pastel reference kit.
 */
function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} pointerEvents="box-none">
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const tab = TABS.find((t) => t.name === route.name) ?? TABS[index];

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={tab.label}
              activeOpacity={0.85}
              onPress={onPress}
              style={[styles.item, focused && styles.itemActive]}
            >
              <Ionicons name={tab.icon} size={20} color={focused ? colors.onInk : colors.textFaint} />
              {focused && <Text style={styles.itemLabel}>{tab.label}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Authenticated shell: four primary destinations with a floating pill tab bar. */
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

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  itemActive: {
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.lg,
  },
  itemLabel: {
    ...typography.label,
    color: colors.onInk,
    fontSize: 13,
    marginLeft: spacing.sm,
  },
});
