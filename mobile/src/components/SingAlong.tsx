/**
 * SingAlong — record a take of one voice and have it marked note by note.
 *
 * The chorister picks the voice, hears the starting note for a bar and a bar of
 * clicks, sings while the solfa scrolls past, and the server grades the take: every
 * note green (in tune), amber (close), red (wrong) or grey (not sung), with the
 * cents off, plus an overall score and a one-line verdict. Nothing is stored.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
} from "expo-audio";

import { Button } from "./Button";
import { Touchable } from "./Touchable";
import { transcriptionsApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { GradeResult, NoteEvent, TranscriptionPart } from "../api/types";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { leadInFor, noteDueAt, partSeconds, targetFor } from "../lib/take";
import { VOICES, type VoiceName } from "../lib/choir";
import * as haptics from "../lib/haptics";

interface Props {
  melody: readonly NoteEvent[];
  parts: Partial<Record<VoiceName, TranscriptionPart>> | null;
  tempoBpm: number;
  timeSignature: string;
  isPro: boolean;
  /** Called when a free account taps in; the caller shows its upgrade dialog. */
  onRequirePro: () => void;
}

type Phase = "idle" | "leadin" | "singing" | "grading" | "done";

const RECORDING = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 22050, numberOfChannels: 1 };
/** Recording continues this long after the last note, so a held ending is not cut. */
const TAIL_SEC = 1.0;

export function SingAlong({ melody, parts, tempoBpm, timeSignature, isPro, onRequirePro }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const recorder = useAudioRecorder(RECORDING);

  const voices = useMemo(
    () => VOICES.filter((v) => v === "soprano" || parts?.[v]?.notes.length),
    [parts],
  );
  const [voice, setVoice] = useState<VoiceName>("soprano");
  const notes = useMemo<readonly NoteEvent[]>(
    () => (voice === "soprano" ? melody : parts?.[voice]?.notes ?? melody),
    [voice, melody, parts],
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const leadIn = useRef(0);
  const player = useRef<AudioPlayer | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (tick.current) clearInterval(tick.current);
    if (stopAt.current) clearTimeout(stopAt.current);
    tick.current = null;
    stopAt.current = null;
    try { player.current?.remove(); } catch { /* already released */ }
    player.current = null;
  }

  async function start() {
    if (!isPro) { onRequirePro(); return; }
    if (notes.length === 0) return;
    setError(null);
    setGrade(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { setError("Microphone permission is needed to record a take."); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: false });
      const lead = leadInFor(notes, tempoBpm, timeSignature);
      leadIn.current = lead.seconds;
      const file = new File(Paths.cache, `notefusion-leadin-${Date.now()}.wav`);
      file.write(lead.wavBase64, { encoding: "base64" });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      player.current = createAudioPlayer({ uri: file.uri });
      player.current.play();
      setPhase("leadin");
      setElapsed(0);
      tick.current = setInterval(() => {
        const t = (Date.now() - startedAt.current) / 1000;
        setElapsed(t);
        if (t >= leadIn.current) setPhase((p) => (p === "leadin" ? "singing" : p));
      }, 100);
      const total = lead.seconds + partSeconds(notes, tempoBpm) + TAIL_SEC;
      stopAt.current = setTimeout(() => void finish(), total * 1000);
    } catch (e) {
      cleanup();
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Could not start recording.");
    }
  }

  async function finish() {
    cleanup();
    setPhase("grading");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error("The recording was lost.");
      const result = await transcriptionsApi.grade(uri, "take.m4a", targetFor(notes, tempoBpm, leadIn.current));
      setGrade(result);
      setPhase("done");
      haptics.play(result.score >= 80 ? "success" : "medium");
    } catch (e) {
      setPhase("idle");
      setError(toApiError(e).message);
    }
  }

  function cancel() {
    cleanup();
    void recorder.stop().catch(() => undefined);
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setPhase("idle");
  }

  const due = phase === "singing" ? noteDueAt(notes, tempoBpm, leadIn.current, elapsed) : -1;
  const countdown = Math.max(0, Math.ceil(leadIn.current - elapsed));

  const statusColor = (s: string) =>
    s === "hit" ? colors.success : s === "near" ? colors.warning : s === "wrong" ? colors.danger : colors.textFaint;

  return (
    <View style={styles.block}>
      <View style={styles.headerRow}>
        <Ionicons name="mic-outline" size={16} color={colors.textMuted} />
        <Text style={styles.title}>Sing it</Text>
        {!isPro ? (
          <View style={styles.proTag}><Text style={styles.proTagText}>PRO</Text></View>
        ) : null}
      </View>
      <Text style={styles.hint}>
        Pick your voice, hear the starting note and a count-in, then sing. Every note comes back marked: in tune, close, or off.
      </Text>

      {voices.length > 1 ? (
        <View style={styles.voiceRow}>
          {voices.map((v) => (
            <Touchable
              key={v}
              onPress={() => phase === "idle" || phase === "done" ? setVoice(v) : undefined}
              style={[styles.voiceChip, voice === v && styles.voiceChipOn]}
              radius={radii.pill}
              accessibilityState={{ selected: voice === v }}
              accessibilityLabel={`Sing the ${v === "soprano" ? "tune" : v}`}
            >
              <Text style={[styles.voiceChipText, voice === v && styles.voiceChipTextOn]}>{v === "soprano" ? "Tune" : v[0]!.toUpperCase() + v.slice(1)}</Text>
            </Touchable>
          ))}
        </View>
      ) : null}

      {phase === "idle" || phase === "done" ? (
        <Button
          label={phase === "done" ? "Sing it again" : "Record my take"}
          icon={isPro ? "mic" : "lock-closed-outline"}
          onPress={() => void start()}
          disabled={notes.length === 0}
        />
      ) : phase === "grading" ? (
        <Button label="Marking your take…" icon="hourglass-outline" loading />
      ) : (
        <View style={styles.live}>
          <Text style={styles.liveLabel}>{phase === "leadin" ? `Starting note… sing in ${countdown}` : "Sing!"}</Text>
          <Text style={styles.liveNote}>
            {due >= 0 ? `${notes[due]!.solfa}${notes[due]!.octaveMark}` : phase === "leadin" ? `${notes[0]?.solfa ?? ""}${notes[0]?.octaveMark ?? ""}` : "·"}
          </Text>
          <Button label="Stop" variant="secondary" icon="stop" onPress={cancel} />
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {grade ? (
        <View style={styles.result}>
          <View style={styles.scoreRow}>
            <Text style={[styles.score, { color: grade.score >= 80 ? colors.success : grade.score >= 50 ? colors.warning : colors.danger }]}>{grade.score}</Text>
            <View style={styles.scoreText}>
              <Text style={styles.summary}>{grade.summary}</Text>
              {grade.octaveShift !== 0 ? (
                <Text style={styles.meta}>Sung {grade.octaveShift > 0 ? "an octave up" : "an octave down"} — that's fine.</Text>
              ) : null}
            </View>
          </View>
          <View style={styles.marks}>
            {grade.notes.map((g) => {
              const n = notes[g.index];
              if (!n) return null;
              return (
                <View key={g.index} style={[styles.mark, { borderColor: statusColor(g.status) }]}>
                  <Text style={[styles.markSolfa, { color: statusColor(g.status) }]}>{n.solfa}{n.octaveMark}</Text>
                  <Text style={styles.markCents}>
                    {g.status === "missed" ? "—" : g.cents == null ? "" : `${g.cents > 0 ? "+" : ""}${Math.round(g.cents)}`}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.legend}>Green in tune · amber close · red wrong note · grey not sung. Numbers are cents off.</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: { marginTop: spacing.lg, gap: spacing.sm },
    headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    title: { ...typography.heading, color: c.text, fontSize: 16, fontFamily: fonts.bold },
    hint: { ...typography.body, color: c.textMuted, fontSize: 13, lineHeight: 20 },
    proTag: { marginLeft: "auto", backgroundColor: c.premiumSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 },
    proTagText: { ...typography.caption, color: c.premiumDeep, fontFamily: fonts.semibold, fontSize: 10 },
    voiceRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
    voiceChip: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    voiceChipOn: { backgroundColor: c.accent, borderColor: c.accent },
    voiceChipText: { ...typography.caption, color: c.text, fontFamily: fonts.semibold },
    voiceChipTextOn: { color: c.onAccent },
    live: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
    liveLabel: { ...typography.label, color: c.textMuted },
    liveNote: { ...typography.hero, color: c.accent },
    error: { ...typography.caption, color: c.danger },
    result: { marginTop: spacing.xs, backgroundColor: c.surfaceAlt, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
    scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    score: { ...typography.display, minWidth: 64, textAlign: "center" },
    scoreText: { flex: 1 },
    summary: { ...typography.body, color: c.text, lineHeight: 20 },
    meta: { ...typography.caption, color: c.textMuted, marginTop: 2 },
    marks: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    mark: { minWidth: 40, alignItems: "center", paddingVertical: 4, paddingHorizontal: 6, borderRadius: radii.sm, borderWidth: 1.5, backgroundColor: c.surface },
    markSolfa: { ...typography.mono, fontSize: 15, fontWeight: "700" },
    markCents: { ...typography.caption, color: c.textFaint, fontSize: 10 },
    legend: { ...typography.caption, color: c.textFaint, lineHeight: 16 },
  });
