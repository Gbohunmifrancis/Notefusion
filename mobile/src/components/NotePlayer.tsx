/**
 * NotePlayer
 * ──────────────────────────────────────────────────────────────────────────
 * Playback control for a transcribed melody: a gradient play/pause button,
 * a seekable progress bar, and a horizontally-scrolling strip of tonic-solfa
 * syllable chips. The chip matching the audio's current playback position is
 * highlighted with "The Fusion" gradient (Electric Purple → Warm Gold) and a
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
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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

import { colors } from "../design/theme";
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
  /** Optional small caption rendered above the transport controls. */
  title?: string;
  /**
   * Best-effort notification that playback has reached the end of the clip.
   * Derived from the hook's state transition (isPlaying: true → false with
   * position reset to 0) rather than a raw `didJustFinish` flag, since the
   * hook does not expose the underlying `AVPlaybackStatus` directly.
   */
  onPlaybackComplete?: () => void;
  style?: StyleProp<ViewStyle>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

const FUSION_GRADIENT = [colors.purple, colors.gold] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function NotePlayer({
  audioPreviewBase64,
  notes,
  tempoBpm,
  title,
  onPlaybackComplete,
  style,
}: NotePlayerProps) {
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
    error,
    play,
    pause,
    seekTo,
  } = useNotePlayer(audioPreviewBase64, notes, tempoBpm);

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
          disabled={!ready || isLoading}
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
            {isLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={22}
                color={ready ? "#FFFFFF" : "rgba(255,255,255,0.4)"}
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

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },

  title: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
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
    shadowColor: colors.purple,
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
    backgroundColor: "rgba(255,255,255,0.12)",
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
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: colors.purple,
    shadowColor: colors.purple,
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
    color: "rgba(255,255,255,0.45)",
    fontVariant: ["tabular-nums"],
  },

  errorText: {
    fontSize: 12,
    color: "#F87171",
    marginTop: 10,
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
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },

  chipTextInactive: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.5)",
  },

  chipActive: {
    minWidth: 44,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 14,
    shadowColor: colors.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },

  chipTextActive: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  emptyText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.4)",
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 16,
  },
});
