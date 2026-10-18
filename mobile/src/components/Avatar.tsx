import React, { useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Touchable } from './Touchable';
import { fonts, gradients, type Palette, type Shadows } from '../design/theme';
import { useThemedStyles } from '../lib/theme';
import { useDataSaver } from '../lib/dataSaver';
import { loadsImages } from '../lib/dataPolicy';

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
  accessibilityLabel,
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
  /** What a tap does, when it is not changing the picture (the header avatar opens Profile). */
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  // Data saver: initials instead of a downloaded photo, except where the photo is being managed.
  const dataSaver = useDataSaver();
  const showPhoto = !!uri && (editable || loadsImages(dataSaver));

  // A URL that will not load (a dead storage link, an expired Google photo) falls back to the
  // initials rather than painting an empty circle. Reset per URL so a new photo gets its chance.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  // The ring is a 3px band around the photo, so every inner radius derives from
  // `size` rather than being hardcoded — one prop scales the whole stack.
  const ring = 3;
  const inner = size - ring * 2;
  const badge = Math.max(24, Math.round(size * 0.28));

  const face = (
    <View style={[styles.face, { width: inner, height: inner, borderRadius: inner / 2 }]}>
      {showPhoto && !failed ? (
        <Image
          source={{ uri: uri! }}
          style={{ width: inner, height: inner, borderRadius: inner / 2 }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          onError={() => setFailed(true)}
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
    // The busy dim is only applied here when the avatar is *not* pressable: when it
    // is, `Touchable`'s own disabled fade covers the same box, and stacking the two
    // would leave a mid-upload photo at a quarter opacity.
    <View style={[styles.wrap, busy && !onPress && styles.busy, style]}>
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
    <Touchable
      onPress={onPress}
      disabled={busy}
      // No ripple and no radius: the premium ring carries a gold glow, and clipping
      // the view to the circle would cut that shadow off. The scale carries the press.
      ripple={false}
      // A small avatar still takes a 44 px tap.
      hitSlop={size < 44 ? Math.ceil((44 - size) / 2) : undefined}
      accessibilityLabel={accessibilityLabel ?? (editable ? 'Change profile picture' : 'Profile picture')}
    >
      {body}
    </Touchable>
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
