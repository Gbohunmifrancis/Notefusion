import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

// 22.05 kHz mono matches the pipeline's expected input. Start from the m4a/AAC
// HIGH_QUALITY preset and override the top-level rate/channels.
const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22050,
  numberOfChannels: 1,
};

/**
 * Capture → submit → poll. Records 22.05 kHz mono (matches the pipeline's expected
 * input), uploads to the C# gateway, then polls the job and hands the finished
 * result to the Result screen. A pulsing ring makes the recording state obvious.
 */
export function RecordScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { state, start, reset } = useJobPolling();

  const [phase, setPhase] = useState<Phase>('ready');
  const [mode, setMode] = useState<Mode>('melody');
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState<string | null>(null);

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const pulse = useRef(new Animated.Value(1)).current;
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animate the mic ring only while recording.
  useEffect(() => {
    if (phase === 'recording') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.25, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [phase, pulse]);

  // Once the job finishes, route to Result and reset for the next take.
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
        setPermError('Microphone permission is needed to record.');
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
      await start(uri, `clip-${elapsed}s.m4a`, { mode });
    } catch {
      setPhase('ready');
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const uploading = phase === 'uploading';

  return (
    <Screen>
      <View style={styles.container}>
        <Text style={styles.title}>Record</Text>

        {/* Mode selector */}
        <View style={styles.modeRow}>
          {(['melody', 'poly'] as Mode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeChip, mode === m && styles.modeChipActive]}
              onPress={() => phase === 'ready' && setMode(m)}
              disabled={phase !== 'ready'}
            >
              <Ionicons
                name={m === 'melody' ? 'musical-note' : 'layers'}
                size={16}
                color={mode === m ? colors.text : colors.textMuted}
              />
              <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                {m === 'melody' ? 'Melody' : 'Polyphonic'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Mic */}
        <View style={styles.micArea}>
          <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulse }] }]} />
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={phase === 'recording' ? stopAndSubmit : phase === 'ready' ? startRecording : undefined}
            disabled={uploading}
            style={[styles.micButton, phase === 'recording' && styles.micButtonActive]}
          >
            <Ionicons
              name={uploading ? 'hourglass' : phase === 'recording' ? 'stop' : 'mic'}
              size={44}
              color={colors.text}
            />
          </TouchableOpacity>
        </View>

        <Text style={styles.timer}>{uploading ? 'Transcribing…' : mmss}</Text>
        <Text style={styles.hint}>
          {phase === 'ready' && 'Tap to record. Keep it to a short, clear phrase.'}
          {phase === 'recording' && 'Tap the square to stop and transcribe.'}
          {uploading && (state.status === 'processing'
            ? `Analyzing audio · ${Math.round(state.progress * 100)}%`
            : 'Uploading your clip…')}
        </Text>

        {uploading && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(8, state.progress * 100)}%` }]} />
          </View>
        )}

        {permError && <Card style={styles.errCard}><Text style={styles.errText}>{permError}</Text></Card>}
        {state.error && (
          <Card style={styles.errCard}>
            <Text style={styles.errText}>{state.error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => { reset(); setPhase('ready'); }} style={{ marginTop: spacing.md }} />
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  title: { ...typography.title, color: colors.text, alignSelf: 'flex-start', marginTop: spacing.sm },
  modeRow: { flexDirection: 'row', marginTop: spacing.xl, gap: spacing.md },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  modeText: { ...typography.label, color: colors.textMuted, marginLeft: spacing.sm },
  modeTextActive: { color: colors.text },
  micArea: { marginTop: spacing.xxxl * 1.2, alignItems: 'center', justifyContent: 'center', height: 220 },
  pulseRing: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.accentSoft,
  },
  micButton: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonActive: { backgroundColor: colors.danger },
  timer: { ...typography.display, color: colors.text, marginTop: spacing.xl, fontVariant: ['tabular-nums'] },
  hint: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.xl },
  progressTrack: {
    width: '80%',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface,
    marginTop: spacing.xl,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  errCard: { marginTop: spacing.xl, width: '100%' },
  errText: { ...typography.body, color: colors.danger, textAlign: 'center' },
});
