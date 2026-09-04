import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from './Avatar';
import { Touchable } from './Touchable';
import { useAuth } from '../lib/auth';
import { useSubscription } from '../lib/subscription';
import { showDialog } from '../lib/dialog';
import { fonts, motion, radii, spacing, type Palette, type Shadows } from '../design/theme';
import { useColors, useThemedStyles } from '../lib/theme';
import type { RootStackParams } from '../navigation/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The caller's already-fetched avatar, so opening the drawer costs no request. */
  pictureUrl?: string | null;
}

/** Slide durations. Out is quicker than in — a dismissal should feel immediate. */
const OPEN_MS = 230;
const CLOSE_MS = 170;

/**
 * The account side bar, opened by tapping the avatar in the top-left of Home.
 *
 * It exists because the account and the plan were competing with the microphone
 * for space in the tab bar. The plan is still here — your plan is a decision, not a
 * destination — while Profile moved back into the tab bar when the bar went to an
 * odd count of five so the piano could join it. Only the plan badge doubles this
 * drawer's identity block, which still routes to the Profile tab.
 *
 * Deliberately not `@react-navigation/drawer`: it is not installed, and the ask was
 * tap-to-open, not swipe. A `Modal` needs no dependency and no restructuring of the
 * navigation tree — the drawer paints above the whole app, tab bar included, which a
 * screen inside the stack could not do.
 */
export function AppDrawer({ open, onClose, pictureUrl }: Props) {
  const { user, signOut, isAdmin } = useAuth();
  const { isPro, known } = useSubscription();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  // Mount tracks the panel's presence on screen, which outlives `open` by one animation:
  // unmounting the Modal the instant `open` goes false would make the drawer vanish rather
  // than slide away.
  const [mounted, setMounted] = useState(open);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Keyed on `open` as well as `mounted` so reopening mid-close animates in from wherever
  // the panel got to, instead of freezing half-way off-screen.
  useEffect(() => {
    if (!mounted) return;
    const animation = Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: open ? OPEN_MS : CLOSE_MS,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
    return () => animation.stop();
  }, [mounted, open, slide]);

  // Wide enough to read a full name, never so wide that the app behind it disappears —
  // seeing what you are on top of is what makes a drawer feel dismissible.
  const panelWidth = Math.min(320, width * 0.82);

  /**
   * Closes and navigates in the same tick. Waiting for the slide-out first would add
   * CLOSE_MS of dead time to every row tap, and the outgoing panel over the incoming
   * screen is what the platform drawers do anyway.
   */
  function go(navigate: () => void) {
    onClose();
    navigate();
  }

  function confirmSignOut() {
    onClose();
    // Confirmed, unlike the button at the bottom of Profile: this row sits one tap from
    // the avatar and directly below "Settings and privacy", so a mis-tap here is easy and
    // costs the whole session.
    showDialog({
      title: 'Sign out?',
      message: "You'll need your password to get back in. Saved transcriptions stay in your library.",
      icon: 'log-out-outline',
      tone: 'danger',
      actions: [
        { label: 'Sign out', style: 'destructive', icon: 'log-out-outline', onPress: () => signOut() },
        { label: 'Stay signed in', style: 'cancel' },
      ],
    });
  }

  return (
    <Modal
      visible={mounted}
      transparent
      // We animate the panel ourselves; letting the Modal fade at the same time reads as
      // two things happening at once.
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.backdrop, { opacity: slide }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.panel,
          {
            width: panelWidth,
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-panelWidth, 0],
                }),
              },
            ],
          },
        ]}
      >
        {/* ── Identity: the whole block is the route to the profile ─────────── */}
        <Touchable
          onPress={() => go(() => nav.navigate('Tabs', { screen: 'Profile' }))}
          style={styles.identity}
          // The rows only shrink a hair: the panel slides in as it is pressed, and
          // a deep press on top of that reads as two animations arguing.
          scaleTo={motion.scale.row}
          accessibilityLabel="View profile"
        >
          <Avatar uri={pictureUrl} name={user?.fullName} size={52} premium={isPro} />
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>
              {user?.fullName ?? 'Your account'}
            </Text>
            <Text style={styles.viewProfile}>View profile</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Touchable>

        <View style={styles.rule} />

        {/* ── Rows ─────────────────────────────────────────────────────────── */}
        <Row
          icon={isPro ? 'star' : 'star-outline'}
          label="Your plan"
          onPress={() => go(() => nav.navigate('Upgrade'))}
          styles={styles}
          color={colors.text}
          /* No badge until billing has answered. `isPro` is false while unknown, so a
             badge would tell a paying customer they are on Free — worse than saying
             nothing for the half-second it takes to find out. */
          trailing={
            known ? (
              <View style={[styles.badge, isPro && styles.badgePro]}>
                <Text style={[styles.badgeText, isPro && styles.badgeTextPro]}>
                  {isPro ? 'PRO' : 'FREE'}
                </Text>
              </View>
            ) : null
          }
        />

        <Row
          icon="folder-outline"
          label="Your library"
          onPress={() => go(() => nav.navigate('Tabs', { screen: 'Library' }))}
          styles={styles}
          color={colors.text}
        />

        <Row
          icon="settings-outline"
          label="Settings and privacy"
          onPress={() => go(() => nav.navigate('Settings'))}
          styles={styles}
          color={colors.text}
        />

        <Row
          icon="help-circle-outline"
          label="Help & support"
          onPress={() => go(() => nav.navigate('Help'))}
          styles={styles}
          color={colors.text}
        />

        {/* Admin. Hidden for everyone else — the routes themselves are behind the
            server's Admin policy, so this row is about not showing an operator
            surface to a customer, not about keeping them out of it. */}
        {isAdmin && (
          <>
            <View style={styles.rule} />
            <Row
              icon="shield-checkmark-outline"
              label="Admin"
              onPress={() => go(() => nav.navigate('AdminHome'))}
              styles={styles}
              color={colors.accent}
            />
          </>
        )}

        <View style={styles.rule} />

        <Row
          icon="log-out-outline"
          label="Sign out"
          onPress={confirmSignOut}
          styles={styles}
          color={colors.danger}
          danger
        />
      </Animated.View>
    </Modal>
  );
}

function Row({
  icon,
  label,
  onPress,
  trailing,
  styles,
  color,
  danger = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  trailing?: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
  color: string;
  danger?: boolean;
}) {
  return (
    <Touchable
      onPress={onPress}
      style={styles.row}
      scaleTo={motion.scale.row}
      // `danger` is only ever the sign-out row, and that one opens a confirmation —
      // the warning pattern is what marks it as the row you did not mean to hit.
      haptic={danger ? 'warning' : 'light'}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={21} color={color} />
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]} numberOfLines={1}>
        {label}
      </Text>
      {trailing}
    </Touchable>
  );
}

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    backdrop: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      backgroundColor: c.scrim, // same wash as AppDialog
    },

    panel: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: c.bgElevated,
      borderTopRightRadius: radii.lg,
      borderBottomRightRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      ...s.card,
    },

    // ── Identity block ──────────────────────────────────────────────────────
    identity: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    identityText: {
      flex: 1,
      marginLeft: spacing.md,
    },
    name: {
      fontSize: 17,
      fontFamily: fonts.bold,
      color: c.text,
    },
    viewProfile: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: c.textMuted,
      marginTop: 1,
    },

    rule: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: spacing.md,
    },

    // ── Rows ────────────────────────────────────────────────────────────────
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: fonts.semibold,
      color: c.text,
    },
    rowLabelDanger: {
      color: c.danger,
    },

    // ── Plan badge ──────────────────────────────────────────────────────────
    badge: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    badgePro: {
      borderColor: c.premiumBorder,
      backgroundColor: c.premiumSoft,
    },
    badgeText: {
      fontSize: 9.5,
      fontFamily: fonts.bold,
      color: c.textMuted,
      letterSpacing: 0.8,
    },
    badgeTextPro: {
      color: c.premiumDeep,
    },
  });
