import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  type RecordingOptions,
} from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useJobPolling } from '../lib/useJobPolling';
import { colors, radii, spacing, typography } from '../design/theme';
import type { RootStackParams } from '../navigation/types';

type Mode = 'melody' | 'poly';
type Phase = 'ready' | 'recording' | 'uploading';

const KEYS = ['Auto', 'C major', 'D major', 'E major', 'F major', 'G major', 'A major', 'Bb major', 'A minor', 'D minor', 'E minor'];

const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22050,
  numberOfChannels: 1,
};

/**
 * Shazam-inspired Real-time Listening & Transcription Interface.
 * Features central interactive Shazam listening trigger, animated concentric soundwaves,
 * key override selector for 100% accurate Solfa mapping, and clear status hints.
 */
export function RecordScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { state, start, reset } = useJobPolling();

  const [phase, setPhase] = useState<Phase>('ready');
  const [mode, setMode] = useState<Mode>('melody');
  const [selectedKey, setSelectedKey] = useState<string>('Auto');
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState<string | null>(null);

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const ripple1 = useRef(new Animated.Value(1)).current;
  const ripple2 = useRef(new Animated.Value(1)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shazam concentric soundwave ripple animation while recording
  useEffect(() => {
    if (phase === 'recording') {
      Animated.timing(rippleOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();

      const anim1 = Animated.loop(
        Animated.sequence([
          Animated.timing(ripple1, { toValue: 1.45, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(ripple1, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
      );

      const anim2 = Animated.loop(
        Animated.sequence([
          Animated.delay(400),
          Animated.timing(ripple2, { toValue: 1.7, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(ripple2, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
      );

      anim1.start();
      anim2.start();

      return () => {
        anim1.stop();
        anim2.stop();
      };
    } else {
      Animated.timing(rippleOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        ripple1.setValue(1);
        ripple2.setValue(1);
      });
    }
  }, [phase, ripple1, ripple2, rippleOpacity]);

  // Navigate to Result once completed
  useEffect(() => {
    if (state.status === 'done' && state.result) {
      const result = state.result;
      reset();
      setPhase('ready');
      setElapsed(0);
      nav.navigate('Result', { result });
    }
  }, [state.status, state.result, nav, reset]);

  async function startRecording() {
    setPermError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setPermError('Microphone permission is required to listen and transcribe.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
      setElapsed(0);
      tick.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      setPermError('Could not start recording. Please try again.');
    }
  }

  async function stopAndSubmit() {
    if (tick.current) clearInterval(tick.current);
    if (!recorder.isRecording) return;
    setPhase('uploading');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setPhase('ready');
        return;
      }
      const keyOpt = selectedKey === 'Auto' ? undefined : selectedKey;
      await start(uri, `clip-${elapsed}s.m4a`, { mode, key: keyOpt });
    } catch {
      setPhase('ready');
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const uploading = phase === 'uploading';

  return (
    <Screen>
      <View style={styles.container}>
        {/* Minimalist Top Header & Mode Switcher */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Listening</Text>
          <View style={styles.modeToggleContainer}>
            {(['melody', 'poly'] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeButton, mode === m && styles.modeButtonActive]}
                onPress={() => phase === 'ready' && setMode(m)}
                disabled={phase !== 'ready'}
              >
                <Text style={[styles.modeButtonText, mode === m && styles.modeButtonTextActive]}>
                  {m === 'melody' ? 'Melody (Monophonic)' : 'Polyphonic'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Key Picker for Accurate Solfa Tonic Mapping */}
        <View style={styles.keyPickerArea}>
          <Text style={styles.keyPickerLabel}>Key Signature:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.keyScroll}>
            {KEYS.map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.keyChip, selectedKey === k && styles.keyChipActive]}
                onPress={() => phase === 'ready' && setSelectedKey(k)}
                disabled={phase !== 'ready'}
              >
                <Text style={[styles.keyChipText, selectedKey === k && styles.keyChipTextActive]}>
                  {k}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Shazam Central Listening Button & Concentric Waves */}
        <View style={styles.shazamArea}>
          <Animated.View
            style={[
              styles.rippleWave,
              styles.rippleOuter,
              { opacity: rippleOpacity, transform: [{ scale: ripple2 }] },
            ]}
          />
          <Animated.View
            style={[
              styles.rippleWave,
              styles.rippleInner,
              { opacity: rippleOpacity, transform: [{ scale: ripple1 }] },
            ]}
          />

          <TouchableOpacity
            activeOpacity={0.88}
            onPress={phase === 'recording' ? stopAndSubmit : phase === 'ready' ? startRecording : undefined}
            disabled={uploading}
            style={[
              styles.shazamButton,
              phase === 'recording' && styles.shazamButtonRecording,
              uploading && styles.shazamButtonUploading,
            ]}
          >
            <Ionicons
              name={uploading ? 'cloud-upload' : phase === 'recording' ? 'stop' : 'radio'}
              size={52}
              color={uploading ? colors.ink : colors.onInk}
            />
          </TouchableOpacity>
        </View>

        {/* Real-time Status Text & Timer */}
        <View style={styles.statusArea}>
          <Text style={styles.statusTitle}>
            {phase === 'ready' && 'Tap to Listen'}
            {phase === 'recording' && 'Listening to audio...'}
            {uploading && (state.status === 'processing' ? 'Transcribing Solfa & Staff...' : 'Processing Audio...')}
          </Text>

          <Text style={styles.timerText}>{uploading ? `${Math.round(state.progress * 100)}%` : mmss}</Text>

          <Text style={styles.statusSubtext}>
            {phase === 'ready' && 'Sing, hum, or play clearly near the mic for accurate note & Solfa extraction.'}
            {phase === 'recording' && 'Tap the button to finish and process.'}
            {uploading && 'Analyzing pitch frequencies and key profile...'}
          </Text>

          {uploading && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(6, state.progress * 100)}%` }]} />
            </View>
          )}
        </View>

        {permError && (
          <Card style={styles.errCard}>
            <Text style={styles.errText}>{permError}</Text>
          </Card>
        )}
        {state.error && (
          <Card style={styles.errCard}>
            <Text style={styles.errText}>{state.error}</Text>
            <Button
              label="Try again"
              variant="secondary"
              onPress={() => {
                reset();
                setPhase('ready');
              }}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xs, paddingBottom: 96 },
  header: { width: '100%', alignItems: 'center', marginTop: spacing.xs },
  headerTitle: { ...typography.title, color: colors.text, marginBottom: spacing.sm, fontSize: 22 },
  modeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  modeButtonActive: {
    backgroundColor: colors.ink,
  },
  modeButtonText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textMuted,
  },
  modeButtonTextActive: {
    color: colors.onInk,
    fontWeight: '700',
  },
  keyPickerArea: {
    width: '100%',
    marginVertical: spacing.xs,
  },
  keyPickerLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  keyScroll: {
    flexDirection: 'row',
  },
  keyChip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.xs,
  },
  keyChipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  keyChipText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
  keyChipTextActive: {
    color: colors.onInk,
    fontWeight: '700',
  },
  shazamArea: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 210,
    height: 210,
    marginVertical: spacing.xs,
  },
  rippleWave: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  rippleInner: {
    width: 160,
    height: 160,
    backgroundColor: 'rgba(127, 216, 232, 0.18)',
  },
  rippleOuter: {
    width: 200,
    height: 200,
    backgroundColor: 'rgba(127, 216, 232, 0.10)',
  },
  shazamButton: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 8,
  },
  shazamButtonRecording: {
    backgroundColor: colors.danger,
    shadowColor: colors.danger,
  },
  shazamButtonUploading: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.ink,
  },
  statusArea: { alignItems: 'center', width: '100%', paddingHorizontal: spacing.lg, marginBottom: spacing.xs },
  statusTitle: { ...typography.heading, color: colors.text, fontSize: 18, marginBottom: spacing.xs },
  timerText: { ...typography.display, color: colors.text, fontSize: 26, marginVertical: spacing.xs, fontVariant: ['tabular-nums'] },
  statusSubtext: { ...typography.body, color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing.xs },
  progressTrack: {
    width: '85%',
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.ink, borderRadius: 2 },
  errCard: { marginTop: spacing.sm, width: '100%' },
  errText: { ...typography.body, color: colors.danger, textAlign: 'center', fontSize: 13 },
});
