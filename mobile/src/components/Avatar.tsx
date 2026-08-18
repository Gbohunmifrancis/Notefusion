import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fonts, gradients, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles } from '../lib/theme';

/**
 * Derives up to two initials from a display name. Exported because the same
 * fallback is wanted anywhere a name stands in for a missing picture.
 */
export function initialsFor(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/**
 * The user's picture, with the premium ring.
 *
 * `premium` is the whole point of this component: the gold gradient ring is a paid
 * signal, so it must be driven by one boolean coming from `useSubscription().isPro`
 * rather than re-derived per screen. A free (or unknown) account gets a plain
 * hairline ring — visibly the same shape, none of the gold.
 *
 * Uses `gradients.premium` / `shadow.premiumGlow`, NOT the `gold` tokens: those are
 * blue, having kept their names through the light redesign.
 */
export function Avatar({
  uri,
  name,
  size = 104,
  premium = false,
  onPress,
  busy = false,
  editable = false,
  style,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
  premium?: boolean;
  onPress?: () => void;
  /** Shows a dimmed state while an upload is in flight. */
  busy?: boolean;
  /** Renders the camera affordance. Independent of `onPress` so a read-only
   *  avatar can still be tappable (e.g. to open a profile). */
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);

  // The ring is a 3px band around the photo, so every inner radius derives from
  // `size` rather than being hardcoded — one prop scales the whole stack.
  const ring = 3;
  const inner = size - ring * 2;
  const badge = Math.max(24, Math.round(size * 0.28));

  const face = (
    <View style={[styles.face, { width: inner, height: inner, borderRadius: inner / 2 }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: inner, height: inner, borderRadius: inner / 2 }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          style={[
            styles.initials,
            premium ? styles.initialsPremium : styles.initialsPlain,
            { fontSize: Math.round(size * 0.33) },
          ]}
        >
          {initialsFor(name)}
        </Text>
      )}
    </View>
  );

  const ringStyle = { width: size, height: size, borderRadius: size / 2, padding: ring };

  const framed = premium ? (
    <LinearGradient
      colors={gradients.premium}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.ring, styles.ringPremium, ringStyle]}
    >
      {face}
    </LinearGradient>
  ) : (
    <View style={[styles.ring, styles.ringPlain, ringStyle]}>{face}</View>
  );

  const body = (
    <View style={[styles.wrap, busy && styles.busy, style]}>
      {framed}
      {editable ? (
        <View
          style={[
            styles.cameraBadge,
            { width: badge, height: badge, borderRadius: badge / 2 },
          ]}
        >
          <Ionicons
            name={busy ? 'ellipsis-horizontal' : 'camera'}
            size={Math.round(badge * 0.52)}
            color="#FFFFFF"
          />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={editable ? 'Change profile picture' : 'Profile picture'}
    >
      {body}
    </TouchableOpacity>
  );
}

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    wrap: {
      alignSelf: 'center',
    },
    busy: {
      opacity: 0.6,
    },

    ring: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringPremium: {
      ...s.premiumGlow,
    },
    ringPlain: {
      backgroundColor: c.border,
    },

    face: {
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },

    initials: {
      fontFamily: fonts.bold,
    },
    initialsPremium: {
      color: c.premium,
    },
    initialsPlain: {
      color: c.textMuted,
    },

    cameraBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: c.bg,
    },
  });
