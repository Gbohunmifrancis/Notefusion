/**
 * NotePlayer
 * ──────────────────────────────────────────────────────────────────────────
 * Playback control for a transcribed melody: a gradient play/pause button,
 * a seekable progress bar, and a horizontally-scrolling strip of tonic-solfa
 * syllable chips. The chip matching the audio's current playback position is
 * highlighted with "The Fusion" gradient (Deep Blue → Bright Blue) and a
 * light spring "pop", and the strip auto-scrolls to keep it centred.
 *
 * This component is intentionally *purely presentational*. All audio
 * loading, `Audio.Sound` lifecycle management, and playback-position/
 * current-note tracking live in `useNotePlayer` (see `../lib/useNotePlayer`)
 * — that hook is the single source of truth for playback state. This file
 * only:
 *   1. Calls the hook and renders based on the state it returns.
 *   2. Translates gestures on the progress bar into `seekTo()` calls.
 *   3. Owns small UI-only concerns that have no bearing on playback state
 *      itself — the in-drag preview fraction, chip layout measurements for
 *      auto-scroll, and the "pop" animation triggered when the highlighted
 *      chip changes.
 *
 * Previously this component created and managed its own `Audio.Sound`
 * instance in parallel with `useNotePlayer`, duplicating the entire loading/
 * status-tracking logic. That duplication is gone: there is now exactly one
 * `Audio.Sound` per rendered preview, owned by the hook.
 *
 * The one exception to "presentational only" is the click track. A metronome
 * and a count-in are not transport settings — they change what the audio *is* —
 * so when either is on this component synthesises its own clip from `notes`
 * (`lib/synth`) instead of playing `audioPreviewBase64`, and tells the hook how
 * long the resulting lead-in is. Mixing clicks into the melody's own buffer is
 * the only way to keep them from drifting; a second player would. This is only
 * acceptable because the local and server voices are deliberately identical
 * (see the header of `lib/synth.ts`), so turning the metronome on changes the
 * timing information and nothing about the timbre.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  InteractionManager,
  PanResponder,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { fonts, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { beatsPerBar } from "../lib/musicxml";
import { leadInSec, synthesizeMelodyWavBase64, type SynthOptions } from "../lib/synth";
import { useNotePlayer } from "../lib/useNotePlayer";
import type { NoteEvent } from "../api/types";

// ─── Props ──────────────────────────────────────────────────────────────────

export interface NotePlayerProps {
  /**
   * Base64-encoded WAV audio preview to play (from
   * `TranscriptionResult.audioPreviewBase64`), or null/undefined when the
   * preview isn't ready yet.
   */
  audioPreviewBase64?: string | null;
  /**
   * Ordered note events from the transcription result. Timed in beats —
   * `useNotePlayer` converts each note's `startBeat`/`durBeats` into an
   * absolute time window using `tempoBpm`, and reports which note is
   * currently sounding via `currentNoteIndex`.
   */
  notes: NoteEvent[];
  /** Tempo in BPM; used by the hook to convert note beat positions to seconds. */
  tempoBpm: number;
  /**
   * The transcription's time signature, e.g. "6/8". Decides where the
   * metronome's accent falls and how long a count-in bar is. 4/4 if absent.
   */
  timeSignature?: string;
  /** Optional small caption rendered above the transport controls. */
  title?: string;
  /**
   * Best-effort notification that playback has reached the end of the clip.
   * Derived from the hook's state transition (isPlaying: true → false with
   * position reset to 0) rather than a raw `didJustFinish` flag, since the
   * hook does not expose the underlying `AVPlaybackStatus` directly.
   */
  onPlaybackComplete?: () => void;
  /**
   * The note currently sounding, or −1 when nothing is. Lets a sibling view —
   * the stave — follow playback without a second Audio.Sound: this component
   * still owns no playback state, it only forwards what the hook reports.
   */
  onCurrentNoteChange?: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Speeds the −/+ buttons step through. 1 must be one of them, and the ends must
 * stay inside the hook's [MIN_RATE, MAX_RATE] or a step would silently clamp
 * back to where it already was.
 */
const RATE_STEPS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Bars of count-in the button cycles through. */
const MAX_COUNT_IN_BARS = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Formats a duration given in seconds as "m:ss". */
function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** "The Fusion" in the active palette — its blues lighten a step in dark mode. */
function fusionGradient(c: Palette): readonly [string, string] {
  return [c.purple, c.gold];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NotePlayer({
  audioPreviewBase64,
  notes,
  tempoBpm,
  timeSignature = "4/4",
  title,
  onPlaybackComplete,
  onCurrentNoteChange,
  style,
}: NotePlayerProps) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const FUSION_GRADIENT = useMemo(() => fusionGradient(colors), [colors]);

  // Speed and loop belong to the player, so the hook owns them. The metronome
  // and the count-in change the clip itself, so they live here.
  const [metronome, setMetronome] = useState(false);
  const [countInBars, setCountInBars] = useState(0);

  const synthOptions = useMemo<SynthOptions>(
    () => ({ metronome, countInBars, beatsPerBar: beatsPerBar(timeSignature) }),
    [metronome, countInBars, timeSignature],
  );
  const wantsClicks = metronome || countInBars > 0;
  const lead = useMemo(
    () => (wantsClicks ? leadInSec(tempoBpm, synthOptions) : 0),
    [wantsClicks, tempoBpm, synthOptions],
  );

  const [clickTrack, setClickTrack] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!wantsClicks || notes.length === 0) {
      setClickTrack(null);
      setPreparing(false);
      return;
    }
    setPreparing(true);
    // A 30 s melody measures ~250 ms to synthesise on a desktop, so several
    // times that on a phone — long enough that doing it during the press would
    // read as the button not having registered. Running after the interaction
    // lets the toggle paint first, then the JS thread goes away to make audio.
    const task = InteractionManager.runAfterInteractions(() => {
      setClickTrack(synthesizeMelodyWavBase64(notes, tempoBpm, synthOptions));
      setPreparing(false);
    });
    return () => task.cancel();
  }, [wantsClicks, notes, tempoBpm, synthOptions]);

  // Single source of truth for everything playback-related — loading state,
  // transport state, position/duration, the currently-sounding note index,
  // and any load/playback error message.
  const {
    ready,
    isLoading,
    isPlaying,
    position,
    duration,
    currentNoteIndex,
    rate,
    loop,
    error,
    play,
    pause,
    seekTo,
    setRate,
    setLoop,
    skipToStart,
  } = useNotePlayer(wantsClicks ? clickTrack : audioPreviewBase64, notes, tempoBpm, lead);

  const busy = isLoading || preparing;

  const stepRate = useCallback(
    (delta: number) => {
      const at = RATE_STEPS.indexOf(rate);
      setRate(RATE_STEPS[clamp(at + delta, 0, RATE_STEPS.length - 1)]);
    },
    [rate, setRate],
  );

  // Refs mirroring hook state so the PanResponder (created exactly once via
  // useRef below) always reads fresh values without needing to be recreated
  // mid-gesture.
  const readyRef = useRef(ready);
  const isPlayingRef = useRef(isPlaying);
  const durationRef = useRef(duration);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // ── Seek-drag bookkeeping ──────────────────────────────────────────────
  // Purely presentational: the drag fraction is used only to render the
  // thumb/fill while dragging. Actual seeking is delegated to the hook's
  // `seekTo`; this component never touches an Audio.Sound instance.
  const trackWidthRef = useRef(0);
  const lastSeekTsRef = useRef(0);
  const wasPlayingBeforeSeekRef = useRef(false);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  // ── Solfa-strip auto-scroll bookkeeping ────────────────────────────────
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollContainerWidthRef = useRef(0);
  const chipOffsetsRef = useRef<number[]>([]);
  const chipWidthsRef = useRef<number[]>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Best-effort "playback complete" signal: fires when the hook transitions
  // from playing to stopped with position reset to the start — the state
  // shape the hook produces on a natural finish (see useNotePlayer.ts).
  const prevIsPlayingRef = useRef(isPlaying);
  useEffect(() => {
    if (prevIsPlayingRef.current && !isPlaying && position === 0 && ready) {
      onPlaybackComplete?.();
    }
    prevIsPlayingRef.current = isPlaying;
  }, [isPlaying, position, ready, onPlaybackComplete]);

  /** Toggles play/pause, restarting from the beginning if the clip already finished. */
  const handleTogglePlay = useCallback(async () => {
    if (isPlaying) {
      await pause();
      return;
    }
    if (duration > 0 && position >= duration - 0.05) {
      await seekTo(0);
    }
    await play();
  }, [isPlaying, position, duration, pause, seekTo, play]);

  // ── Seekable progress bar (tap-to-seek + drag-to-scrub) ─────────────────

  const computeFraction = useCallback((locationX: number) => {
    const width = trackWidthRef.current;
    if (width <= 0) return 0;
    return clamp(locationX / width, 0, 1);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => readyRef.current,
      onMoveShouldSetPanResponder: () => readyRef.current,
      onPanResponderGrant: (evt) => {
        wasPlayingBeforeSeekRef.current = isPlayingRef.current;
        if (isPlayingRef.current) {
          void pause();
        }
        setDragFraction(computeFraction(evt.nativeEvent.locationX));
      },
      onPanResponderMove: (evt) => {
        const fraction = computeFraction(evt.nativeEvent.locationX);
        setDragFraction(fraction);

        // Throttle live seeking while dragging so we don't flood the audio
        // engine with setPositionAsync calls on every touch-move event.
        const now = Date.now();
        if (now - lastSeekTsRef.current > 120 && durationRef.current > 0) {
          lastSeekTsRef.current = now;
          void seekTo(fraction * durationRef.current);
        }
      },
      onPanResponderRelease: (evt) => {
        const fraction = computeFraction(evt.nativeEvent.locationX);
        setDragFraction(null);

        if (durationRef.current > 0) {
          void seekTo(fraction * durationRef.current).then(() => {
            if (wasPlayingBeforeSeekRef.current) {
              return play();
            }
            return undefined;
          });
        }
      },
    }),
  ).current;

  const playedFraction =
    dragFraction !== null
      ? dragFraction
      : duration > 0
        ? clamp(position / duration, 0, 1)
        : 0;

  // ── Highlight "pop" + auto-scroll, driven entirely by the hook's index ──

  useEffect(() => {
    onCurrentNoteChange?.(currentNoteIndex);
  }, [currentNoteIndex, onCurrentNoteChange]);

  useEffect(() => {
    if (currentNoteIndex < 0) return;
    pulseAnim.setValue(0.85);
    Animated.spring(pulseAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
      tension: 140,
    }).start();
  }, [currentNoteIndex, pulseAnim]);

  useEffect(() => {
    if (currentNoteIndex < 0) return;
    const offset = chipOffsetsRef.current[currentNoteIndex];
    const width = chipWidthsRef.current[currentNoteIndex];
    const containerWidth = scrollContainerWidthRef.current;
    if (offset == null || width == null || containerWidth === 0) return;

    const target = Math.max(0, offset + width / 2 - containerWidth / 2);
    scrollRef.current?.scrollTo({ x: target, animated: true });
  }, [currentNoteIndex]);

  const handleChipLayout = useCallback(
    (index: number, e: LayoutChangeEvent) => {
      chipOffsetsRef.current[index] = e.nativeEvent.layout.x;
      chipWidthsRef.current[index] = e.nativeEvent.layout.width;
    },
    [],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}

      <View style={styles.transportRow}>
        <Pressable
          onPress={handleTogglePlay}
          disabled={!ready || busy}
          style={({ pressed }) => [
            styles.playButtonWrapper,
            pressed && styles.playButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause playback" : "Play melody"}
        >
          <LinearGradient
            colors={
              ready ? FUSION_GRADIENT : [colors.surfaceAlt, colors.surfaceAlt]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.playButton}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={22}
                color={ready ? "#FFFFFF" : colors.textFaint}
              />
            )}
          </LinearGradient>
        </Pressable>

        <View style={styles.progressColumn}>
          <View
            style={styles.track}
            onLayout={(e) => {
              trackWidthRef.current = e.nativeEvent.layout.width;
            }}
            accessibilityRole="adjustable"
            accessibilityValue={{
              min: 0,
              max: Math.round(duration),
              now: Math.round(position),
            }}
            {...panResponder.panHandlers}
          >
            <View style={styles.trackVisual}>
              <LinearGradient
                colors={FUSION_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.trackFill,
                  { width: `${playedFraction * 100}%` },
                ]}
              />
            </View>
            <View
              style={[styles.thumb, { left: `${playedFraction * 100}%` }]}
              pointerEvents="none"
            />
          </View>

          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(position)}</Text>
            <Text style={styles.timeText}>{formatTime(duration)}</Text>
          </View>
        </View>
      </View>

      {notes.length > 0 ? (
        <View style={styles.practiceRow}>
          <Pressable
            onPress={skipToStart}
            disabled={!ready}
            style={({ pressed }) => [
              styles.chip,
              pressed && styles.chipPressed,
              !ready && styles.chipDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Back to the start"
          >
            <Ionicons
              name="play-skip-back"
              size={16}
              color={ready ? colors.text : colors.textFaint}
            />
          </Pressable>

          <View style={styles.speedGroup}>
            <Pressable
              onPress={() => stepRate(-1)}
              disabled={rate <= RATE_STEPS[0]}
              style={styles.speedStep}
              accessibilityRole="button"
              accessibilityLabel="Slower"
            >
              <Ionicons
                name="remove"
                size={16}
                color={rate <= RATE_STEPS[0] ? colors.textFaint : colors.text}
              />
            </Pressable>
            <Text style={styles.speedText}>{rate}x</Text>
            <Pressable
              onPress={() => stepRate(1)}
              disabled={rate >= RATE_STEPS[RATE_STEPS.length - 1]}
              style={styles.speedStep}
              accessibilityRole="button"
              accessibilityLabel="Faster"
            >
              <Ionicons
                name="add"
                size={16}
                color={
                  rate >= RATE_STEPS[RATE_STEPS.length - 1]
                    ? colors.textFaint
                    : colors.text
                }
              />
            </Pressable>
          </View>

          <ToggleChip
            icon="repeat"
            on={loop}
            onPress={() => setLoop(!loop)}
            label="Repeat the clip"
          />
          <ToggleChip
            icon="pulse"
            on={metronome}
            onPress={() => setMetronome(!metronome)}
            label="Metronome"
          />
          <ToggleChip
            icon="timer-outline"
            on={countInBars > 0}
            // Cycles off → 1 bar → 2 bars → off, rather than opening a picker for
            // a setting with three values.
            onPress={() =>
              setCountInBars((bars) => (bars >= MAX_COUNT_IN_BARS ? 0 : bars + 1))
            }
            label={
              countInBars === 0
                ? "Count in"
                : `Count in ${countInBars} bar${countInBars === 1 ? "" : "s"}`
            }
            text={countInBars > 0 ? String(countInBars) : undefined}
          />
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {notes.length > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(e) => {
            scrollContainerWidthRef.current = e.nativeEvent.layout.width;
          }}
          style={styles.solfaStrip}
          contentContainerStyle={styles.solfaStripContent}
        >
          {notes.map((note, index) => {
            const isActive = index === currentNoteIndex;
            return (
              <View
                key={`${note.pitchMidi}-${note.startBeat}-${index}`}
                onLayout={(e) => handleChipLayout(index, e)}
                style={styles.chipWrapper}
              >
                {isActive ? (
                  <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                    <LinearGradient
                      colors={FUSION_GRADIENT}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.chipActive}
                    >
                      <Text style={styles.chipTextActive}>
                        {note.solfa}
                        {note.octaveMark}
                      </Text>
                    </LinearGradient>
                  </Animated.View>
                ) : (
                  <View style={styles.chipInactive}>
                    <Text style={styles.chipTextInactive}>
                      {note.solfa}
                      {note.octaveMark}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <Text style={styles.emptyText}>No notes to preview yet.</Text>
      )}
    </View>
  );
}

export default NotePlayer;

/**
 * One practice toggle. The label is the accessible name only — these are
 * icon-sized because all five practice controls have to fit one row on a phone,
 * and the on state is carried by the accent fill rather than by text.
 */
function ToggleChip({
  icon,
  on,
  onPress,
  label,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  on: boolean;
  onPress: () => void;
  label: string;
  /** Shown beside the icon when the setting has a value, e.g. a bar count. */
  text?: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const ink = on ? "#FFFFFF" : colors.text;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        on && styles.chipOn,
        pressed && styles.chipPressed,
      ]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={ink} />
      {text ? <Text style={[styles.chipText, { color: ink }]}>{text}</Text> : null}
    </Pressable>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
    },

    title: {
      fontSize: 12,
      fontFamily: fonts.bold,
      color: c.textMuted,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 12,
    },

    // ── Transport row ─────────────────────────────────────────────────────────

    transportRow: {
      flexDirection: "row",
      alignItems: "center",
    },

    playButtonWrapper: {
      width: 52,
      height: 52,
      borderRadius: 26,
      overflow: "hidden",
      marginRight: 14,
      shadowColor: c.purple,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 6,
    },

    playButtonPressed: {
      opacity: 0.85,
    },

    playButton: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },

    progressColumn: {
      flex: 1,
      justifyContent: "center",
    },

    // ── Progress / scrub bar ───────────────────────────────────────────────────

    track: {
      height: 28,
      justifyContent: "center",
    },

    trackVisual: {
      height: 6,
      width: "100%",
      borderRadius: 3,
      backgroundColor: c.surfaceAlt,
      overflow: "hidden",
    },

    trackFill: {
      height: "100%",
      borderRadius: 3,
    },

    thumb: {
      position: "absolute",
      top: "50%",
      width: 14,
      height: 14,
      borderRadius: 7,
      marginTop: -7,
      marginLeft: -7,
      // Reads as the knob against the filled track in either mode.
      backgroundColor: c.surface,
      borderWidth: 2,
      borderColor: c.purple,
      shadowColor: c.purple,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.6,
      shadowRadius: 4,
      elevation: 4,
    },

    timeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 6,
    },

    timeText: {
      fontSize: 11,
      color: c.textMuted,
      fontVariant: ["tabular-nums"],
    },

    errorText: {
      fontSize: 12,
      color: c.danger,
      marginTop: 10,
    },

    // ── Practice controls ──────────────────────────────────────────────────────

    practiceRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 14,
      // The five controls are sized to fit a 375 pt screen without wrapping;
      // if a future one doesn't, wrapping is a better failure than clipping.
      flexWrap: "wrap",
      gap: 6,
    },

    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minWidth: 36,
      height: 32,
      paddingHorizontal: 9,
      borderRadius: 10,
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.borderLight,
    },

    chipOn: {
      backgroundColor: c.purple,
      borderColor: c.purple,
    },

    chipPressed: {
      opacity: 0.7,
    },

    chipDisabled: {
      opacity: 0.5,
    },

    chipText: {
      fontSize: 12,
      fontFamily: fonts.semibold,
    },

    speedGroup: {
      flexDirection: "row",
      alignItems: "center",
      height: 32,
      borderRadius: 10,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.borderLight,
    },

    speedStep: {
      width: 28,
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
    },

    speedText: {
      fontSize: 12,
      fontFamily: fonts.semibold,
      color: c.text,
      minWidth: 34,
      textAlign: "center",
      fontVariant: ["tabular-nums"],
    },

    // ── Solfa strip ────────────────────────────────────────────────────────────

    solfaStrip: {
      marginTop: 18,
    },

    solfaStripContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 2,
    },

    chipWrapper: {
      marginRight: 8,
    },

    chipInactive: {
      minWidth: 40,
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.borderLight,
    },

    chipTextInactive: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: c.textMuted,
    },

    chipActive: {
      minWidth: 44,
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 14,
      shadowColor: c.purple,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.5,
      shadowRadius: 8,
      elevation: 6,
    },

    chipTextActive: {
      fontSize: 15,
      fontFamily: fonts.bold,
      color: "#FFFFFF",
      letterSpacing: 0.3,
    },

    emptyText: {
      fontSize: 13,
      color: c.textMuted,
      fontStyle: "italic",
      textAlign: "center",
      marginTop: 16,
    },
  });
