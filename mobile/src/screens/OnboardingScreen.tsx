import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { colors, gradients, radii, spacing, typography } from '../design/theme';
import type { AuthStackParams } from '../navigation/types';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'mic-outline' as const,
    title: 'Record a melody',
    body: 'Capture a live tune or hum — a few bars is all it takes.',
  },
  {
    icon: 'sparkles-outline' as const,
    title: 'Instant transcription',
    body: 'We turn it into Tonic Solfa and staff notation, on-key.',
  },
  {
    icon: 'library-outline' as const,
    title: 'Save & re-key',
    body: 'Keep a library and change the Doh anytime — notes never shift.',
  },
];

type Props = NativeStackScreenProps<AuthStackParams, 'Onboarding'>;

/** Three-slide swipeable intro with a paged dot indicator and a clear CTA. */
export function OnboardingScreen({ navigation }: Props) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const next = () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1 });
    } else {
      navigation.navigate('Register');
    }
  };

  return (
    <Screen contentStyle={styles.screen}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width: width - spacing.xl * 2 }]}>
            <LinearGradient colors={gradients.brand} style={styles.iconWrap}>
              <Ionicons name={item.icon} size={64} color={colors.text} />
            </LinearGradient>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View key={s.title} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <Button
        label={index === SLIDES.length - 1 ? 'Get started' : 'Next'}
        onPress={next}
        icon="arrow-forward"
      />
      <Button
        label="I already have an account"
        variant="ghost"
        onPress={() => navigation.navigate('Login')}
        style={styles.secondaryCta}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center' },
  slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  iconWrap: {
    width: 140,
    height: 140,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  title: { ...typography.title, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: spacing.lg,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', marginVertical: spacing.xl },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    marginHorizontal: 5,
  },
  dotActive: { backgroundColor: colors.ink, width: 22 },
  secondaryCta: { marginTop: spacing.sm },
});
