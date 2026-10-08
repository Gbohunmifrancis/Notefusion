import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Touchable } from "../Touchable";
import { Glow } from "../night/NightUI";
import { fonts, motion, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import type { VoiceName } from "../../lib/choir";
import type { NoteEvent } from "../../api/types";
import { barOf } from "./SheetGrid";
import { clamp, RATE_STEPS, useSeekDrag, type Practice } from "./usePractice";

const VOICE_SHORT: Record<VoiceName, string> = { soprano: "S", alto: "A", tenor: "T", bass: "B" };

/** How close to a loop handle (px) a touch must land to move it rather than scrub. */
const HANDLE_REACH = 22;

/**
 * The words around the note being sung: this bar and the next, with the current
 * note's syllable marked. Hyphenated syllables join back into their word.
 */
function phrase(
  notes: readonly NoteEvent[],
  under: readonly (string | null)[],
  current: number,
  timeSignature: string,
): { text: string; now: boolean }[] {
  const at = notes[current];
  if (!at) return [];
  const bar = barOf(at, timeSignature);
  const out: { text: string; now: boolean }[] = [];
  notes.forEach((n, i) => {
    const b = barOf(n, timeSignature);
    const syl = under[i];
    if (b < bar || b > bar + 1 || !syl || syl === "_") return;
    out.push({ text: syl.endsWith("-") ? syl.slice(0, -1) : `${syl} `, now: i === current });
  });
  return out;
}

/**
 * Rehearse: the sheet's player at full size. The syllable sounding is set huge with
 * its neighbours fading either side, the words run beneath it, and the practice
 * controls the player already had — the passage loop in bars, the speed, and the
 * parts to mute — sit below. It drives the same player as the dock, so closing it
 * leaves the music where it was.
 */
export function RehearseView({
  visible,
  onClose,
  practice,
  notes,
  lyricsUnder,
  timeSignature,
  barCount,
  title,
  subtitle,
  thumbnailUrl,
  doh,
  voices,
  onToggleVoice,
}: {
  visible: boolean;
  onClose: () => void;
  practice: Practice;
  notes: readonly NoteEvent[];
  lyricsUnder: readonly (string | null)[] | null;
  timeSignature: string;
  barCount: number;
  title: string;
  subtitle: string;
  thumbnailUrl?: string | null;
  doh: string;
  /** The rehearsal mix; undefined when the sheet has no parts. */
  voices?: readonly { name: VoiceName; on: boolean }[];
  onToggleVoice: (name: VoiceName) => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const p = practice;

  // The big syllable stays on the last note heard while paused, rather than blanking.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (p.currentNoteIndex >= 0) setShown(p.currentNoteIndex);
  }, [p.currentNoteIndex]);
  const current = Math.min(shown, Math.max(0, notes.length - 1));

  const words = useMemo(
    () => (lyricsUnder ? phrase(notes, lyricsUnder, current, timeSignature) : []),
    [notes, lyricsUnder, current, timeSignature],
  );

  // ── The loop track: a scrubber over the piece with the passage drawn on it ──
  const total = p.duration > 0 ? p.duration : barCount * p.barSec;
  const toX = (sec: number, width: number) => (total > 0 ? clamp(sec / total, 0, 1) * width : 0);
  const grabbed = useRef<"from" | "to" | null>(null);
  const { panResponder, dragFraction, onTrackWidth } = useSeekDrag(p, {
    onGrant: (x, width) => {
      grabbed.current = null;
      if (!p.loopOn || barCount <= 0) return true;
      const fromX = toX((p.loopFrom - 1) * p.barSec, width);
      const toEdge = toX(p.loopTo * p.barSec, width);
      if (Math.abs(x - toEdge) <= HANDLE_REACH) grabbed.current = "to";
      else if (Math.abs(x - fromX) <= HANDLE_REACH) grabbed.current = "from";
      return grabbed.current === null;
    },
    onOther: (x, width) => {
      if (width <= 0 || p.barSec <= 0) return;
      const bars = (clamp(x / width, 0, 1) * total) / p.barSec;
      if (grabbed.current === "from") p.setLoopFrom(clamp(Math.round(bars) + 1, 1, p.loopTo));
      else if (grabbed.current === "to") p.setLoopTo(clamp(Math.round(bars), p.loopFrom, barCount));
    },
  });
  const played = dragFraction ?? (total > 0 ? clamp(p.position / total, 0, 1) : 0);
  const loopLeft = total > 0 ? clamp(((p.loopFrom - 1) * p.barSec) / total, 0, 1) : 0;
  const loopRight = total > 0 ? clamp((p.loopTo * p.barSec) / total, 0, 1) : 0;
  const barNow = p.barSec > 0 ? clamp(Math.floor((played * total) / p.barSec) + 1, 1, Math.max(1, barCount)) : 1;

  const near = (offset: number) => notes[current + offset];
  const label = (n: NoteEvent | undefined) => (n ? `${n.solfa}${n.octaveMark}` : "");

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Glow x={0.3} y={0.12} radius={360} color={colors.ink} opacity={0.22} />
        <ScrollView
          contentContainerStyle={[styles.body, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Touchable onPress={onClose} style={styles.iconBtn} radius={20} accessibilityRole="button" accessibilityLabel="Close rehearsal">
              <Ionicons name="chevron-down" size={20} color={colors.text} />
            </Touchable>
            <Text style={styles.headerText} numberOfLines={1}>
              Rehearsing · {title}
            </Text>
            <View style={styles.iconSpacer} />
          </View>

          <View style={styles.song}>
            {thumbnailUrl ? (
              <Image source={{ uri: thumbnailUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.dohTile]}>
                <Text style={styles.dohLetter} numberOfLines={1} adjustsFontSizeToFit>{doh}</Text>
                <Text style={styles.dohCaption}>DOH</Text>
              </View>
            )}
            <View style={styles.songText}>
              <Text style={styles.songTitle} numberOfLines={2}>{title}</Text>
              {subtitle ? <Text style={styles.songSub} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
          </View>

          {notes.length > 0 ? (
            <View style={styles.now} accessibilityLiveRegion="polite" accessibilityLabel={`Now ${label(near(0))}`}>
              <Text style={[styles.far, styles.syl]}>{label(near(-2))}</Text>
              <Text style={[styles.near, styles.syl]}>{label(near(-1))}</Text>
              <Text style={styles.big}>{label(near(0))}</Text>
              <Text style={[styles.near, styles.syl]}>{label(near(1))}</Text>
              <Text style={[styles.far, styles.syl]}>{label(near(2))}</Text>
            </View>
          ) : (
            <Text style={styles.empty}>No notes to rehearse yet.</Text>
          )}

          {words.length > 0 ? (
            <Text style={styles.words} numberOfLines={2}>
              {words.map((w, i) => (
                <Text key={i} style={w.now ? styles.wordNow : undefined}>{w.text}</Text>
              ))}
            </Text>
          ) : null}

          {/* ── Scrubber with the passage loop drawn over it ───────────────── */}
          <View
            style={styles.track}
            onLayout={(e) => onTrackWidth(e.nativeEvent.layout.width)}
            accessibilityRole="adjustable"
            accessibilityLabel="Playback position"
            accessibilityValue={{ min: 0, max: Math.round(p.duration), now: Math.round(p.position) }}
            {...panResponder.panHandlers}
          >
            <View style={styles.rail} />
            {p.loopOn && barCount > 0 ? (
              <>
                <View
                  style={[styles.loopBox, { left: `${loopLeft * 100}%`, width: `${(loopRight - loopLeft) * 100}%` }]}
                  pointerEvents="none"
                />
                {(["from", "to"] as const).map((which) => (
                  <View
                    key={which}
                    style={[styles.handle, { left: `${(which === "from" ? loopLeft : loopRight) * 100}%` }]}
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={which === "from" ? "Loop starts at bar" : "Loop ends at bar"}
                    accessibilityValue={{ min: 1, max: barCount, now: which === "from" ? p.loopFrom : p.loopTo }}
                    accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                    onAccessibilityAction={(e) => p.stepLoop(which, e.nativeEvent.actionName === "increment" ? 1 : -1)}
                  />
                ))}
              </>
            ) : null}
            <View style={[styles.fill, { width: `${played * 100}%` }]} pointerEvents="none" />
            <View style={[styles.thumb, { left: `${played * 100}%` }]} pointerEvents="none" />
          </View>
          <View style={styles.trackLabels}>
            <Text style={styles.trackLabel}>Bar {barNow}</Text>
            <Text style={[styles.trackLabel, p.loopOn && styles.trackLabelOn]}>
              {p.loopOn ? `Loop ${p.loopFrom}–${p.loopTo}` : "Loop off"}
            </Text>
            <Text style={styles.trackLabel}>Bar {Math.max(1, barCount)}</Text>
          </View>

          {/* ── Transport ─────────────────────────────────────────────────── */}
          <View style={styles.transport}>
            <View style={styles.speed}>
              <Pressable
                onPress={() => p.stepRate(-1)}
                disabled={p.rate <= RATE_STEPS[0]!}
                hitSlop={6}
                style={styles.speedStep}
                accessibilityRole="button"
                accessibilityLabel="Slower"
              >
                <Ionicons name="remove" size={15} color={p.rate <= RATE_STEPS[0]! ? colors.textFaint : colors.text} />
              </Pressable>
              <Text style={styles.speedText}>{p.rate}×</Text>
              <Pressable
                onPress={() => p.stepRate(1)}
                disabled={p.rate >= RATE_STEPS[RATE_STEPS.length - 1]!}
                hitSlop={6}
                style={styles.speedStep}
                accessibilityRole="button"
                accessibilityLabel="Faster"
              >
                <Ionicons
                  name="add"
                  size={15}
                  color={p.rate >= RATE_STEPS[RATE_STEPS.length - 1]! ? colors.textFaint : colors.text}
                />
              </Pressable>
            </View>

            <Touchable
              onPress={p.skipToStart}
              disabled={!p.ready}
              style={styles.transportBtn}
              ripple="borderless"
              accessibilityRole="button"
              accessibilityLabel="Back to the start"
            >
              <Ionicons name="play-skip-back" size={24} color={p.ready ? colors.text : colors.textFaint} />
            </Touchable>

            <Touchable
              onPress={() => void p.togglePlay()}
              disabled={!p.ready || p.isLoading}
              style={[styles.play, !p.ready && styles.playIdle]}
              radius={34}
              scaleTo={motion.scale.large}
              accessibilityRole="button"
              accessibilityLabel={p.isPlaying ? "Pause playback" : "Play melody"}
            >
              <Ionicons
                name={p.isPlaying ? "pause" : "play"}
                size={26}
                color={p.ready ? colors.bg : colors.textFaint}
                style={p.isPlaying ? undefined : styles.playGlyph}
              />
            </Touchable>

            {barCount > 0 ? (
              <Touchable
                onPress={() => p.setLoopOn((v) => !v)}
                disabled={!p.ready}
                style={[styles.loopBtn, p.loopOn && styles.loopBtnOn]}
                radius={22}
                accessibilityRole="button"
                accessibilityState={{ selected: p.loopOn }}
                accessibilityLabel="Loop a passage"
              >
                <Ionicons name="repeat" size={20} color={p.loopOn ? colors.accent : p.ready ? colors.text : colors.textFaint} />
              </Touchable>
            ) : (
              <View style={styles.loopBtnSpacer} />
            )}
          </View>

          {/* ── The parts: tap one to mute it and sing it yourself ───────────── */}
          {voices && voices.length > 0 ? (
            <>
              <View style={styles.voices}>
                {voices.map((v) => {
                  const tune = v.name === "soprano";
                  return (
                    <Touchable
                      key={v.name}
                      onPress={() => onToggleVoice(v.name)}
                      style={[styles.voice, v.on ? (tune ? styles.voiceTune : styles.voiceOn) : styles.voiceOff]}
                      radius={28}
                      accessibilityRole="button"
                      accessibilityState={{ selected: v.on }}
                      accessibilityLabel={`${v.on ? "Mute" : "Unmute"} ${v.name}`}
                    >
                      <Text
                        style={[
                          styles.voiceLetter,
                          v.on && tune && styles.voiceLetterTune,
                          !v.on && styles.voiceLetterOff,
                        ]}
                      >
                        {VOICE_SHORT[v.name]}
                      </Text>
                      {tune && v.on ? <Text style={styles.voiceCaption}>TUNE</Text> : null}
                    </Touchable>
                  );
                })}
              </View>
              <Text style={styles.voicesHint}>Tap a part to mute it and sing it yourself.</Text>
            </>
          ) : null}

          {/* The hook's error can be a platform message; this says it plainly instead. */}
          {p.error ? <Text style={styles.error}>This sheet could not be played. Close it and open it again.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    body: { flexGrow: 1, paddingHorizontal: 22 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    iconSpacer: { width: 40 },
    headerText: { flex: 1, textAlign: "center", fontFamily: fonts.regular, fontSize: 13, color: c.textMuted },
    song: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 26 },
    cover: { width: 64, height: 64, borderRadius: 16, backgroundColor: c.surfaceAlt },
    dohTile: { borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
    dohLetter: { fontFamily: typography.mono.fontFamily, fontSize: 22, color: c.text },
    dohCaption: { fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1, color: c.textMuted, marginTop: 2 },
    songText: { flex: 1, minWidth: 0 },
    songTitle: { fontFamily: fonts.semibold, fontSize: 20, letterSpacing: -0.4, color: c.text },
    songSub: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 3 },
    now: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "center",
      gap: 20,
      marginTop: 48,
      minHeight: 120,
    },
    syl: { fontFamily: typography.mono.fontFamily },
    far: { fontSize: 22, color: c.textFaint },
    near: { fontSize: 30, color: c.textMuted },
    big: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 104,
      lineHeight: 118,
      color: c.text,
      textShadowColor: c.accentGlow,
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 30,
    },
    empty: { fontFamily: fonts.regular, fontSize: 15, color: c.textMuted, textAlign: "center", marginTop: 64 },
    words: { fontFamily: fonts.regular, fontSize: 18, color: c.textMuted, textAlign: "center", marginTop: 10 },
    wordNow: { fontFamily: fonts.semibold, color: c.text },
    track: { marginTop: 40, height: 28, justifyContent: "center" },
    rail: { position: "absolute", left: 0, right: 0, top: 12, height: 4, borderRadius: 2, backgroundColor: c.border },
    fill: { position: "absolute", left: 0, top: 12, height: 4, borderRadius: 2, backgroundColor: c.text },
    loopBox: {
      position: "absolute",
      top: 5,
      height: 18,
      borderRadius: 6,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.ink,
    },
    /** A grip at each end of the passage, wide enough to land a thumb on. */
    handle: {
      position: "absolute",
      top: 3,
      width: 6,
      height: 22,
      marginLeft: -3,
      borderRadius: 3,
      backgroundColor: c.ink,
    },
    thumb: {
      position: "absolute",
      top: 7,
      width: 14,
      height: 14,
      borderRadius: 7,
      marginLeft: -7,
      backgroundColor: c.text,
    },
    trackLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
    trackLabel: { fontFamily: typography.mono.fontFamily, fontSize: 11, color: c.textMuted },
    trackLabelOn: { color: c.accentAlt },
    transport: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 26 },
    speed: {
      flexDirection: "row",
      alignItems: "center",
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    speedStep: { width: 28, height: "100%", alignItems: "center", justifyContent: "center" },
    speedText: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 13,
      color: c.accentAlt,
      minWidth: 40,
      textAlign: "center",
    },
    transportBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    play: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: c.text,
      alignItems: "center",
      justifyContent: "center",
    },
    playIdle: { backgroundColor: c.surfaceAlt },
    playGlyph: { marginLeft: 3 },
    loopBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "transparent",
    },
    loopBtnOn: { backgroundColor: c.accentSoft, borderColor: c.accentGlow },
    loopBtnSpacer: { width: 44 },
    voices: { flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 30 },
    voice: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    voiceTune: { backgroundColor: c.ink, borderColor: c.ink },
    voiceOn: { borderColor: c.textFaint },
    voiceOff: { borderColor: c.border, borderStyle: "dashed" },
    voiceLetter: { fontFamily: fonts.semibold, fontSize: 18, color: c.text },
    voiceLetterTune: { color: c.onInk },
    voiceLetterOff: { color: c.textFaint, textDecorationLine: "line-through" },
    voiceCaption: { fontFamily: fonts.medium, fontSize: 8.5, letterSpacing: 0.7, color: c.onInk, opacity: 0.8 },
    voicesHint: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint, textAlign: "center", marginTop: 10 },
    error: { fontFamily: fonts.medium, fontSize: 12.5, color: c.danger, textAlign: "center", marginTop: 16 },
  });
