import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { TextField } from "../components/TextField";
import { Touchable } from "../components/Touchable";
import { choirApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { showDialog } from "../lib/dialog";
import { siteUrls } from "../lib/env";
import { normaliseChoirCode, choirCodeFromText } from "../lib/choirCode";
import { deriveSolfa } from "../lib/solfa";
import { solfaOpening } from "../lib/solfaOpening";
import { synthesizeMelodyWavBase64 } from "../lib/synth";
import { useSubscription } from "../lib/subscription";
import { useColors, useThemedStyles } from "../lib/theme";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import type { Choir, ChoirMember, ChoirSheet, TranscriptionResult } from "../api/types";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Choir">;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * ChoirScreen — the choir plan's home. The director sees the invite (shared through the OS share
 * sheet), the singers (with remove) and the seats used; a singer sees whose choir they are in and
 * can leave; everyone in a running choir sees its shared library. Someone in no choir gets the
 * "Enter choir code" field — filled in when a notefusion://join/CODE link opened this screen —
 * and the way to the choir plan.
 */
export function ChoirScreen({ navigation, route }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { refresh: refreshSubscription } = useSubscription();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choir, setChoir] = useState<Choir | null>(null);
  const [members, setMembers] = useState<ChoirMember[]>([]);
  const [sheets, setSheets] = useState<ChoirSheet[]>([]);

  const [code, setCode] = useState(route.params?.code ?? "");
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);

  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  // A second invite link opened while the screen is up fills the field again.
  useEffect(() => {
    if (route.params?.code) setCode(route.params.code);
  }, [route.params?.code]);

  const load = useCallback(async () => {
    try {
      const mine = await choirApi.mine();
      if (!mounted.current) return;
      setChoir(mine);
      setLoadError(null);
      if (mine) setName(mine.name);
      const [people, library] = await Promise.all([
        mine?.role === "director" ? choirApi.members().catch(() => []) : Promise.resolve([]),
        mine?.isActive ? choirApi.sheets().catch(() => []) : Promise.resolve([]),
      ]);
      if (!mounted.current) return;
      setMembers(people);
      setSheets(library);
    } catch (e) {
      if (mounted.current) setLoadError(toApiError(e).message);
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function join() {
    const clean = choirCodeFromText(code) ?? normaliseChoirCode(code);
    if (!clean) {
      showDialog({ title: "Check the code", message: "A choir code has eight letters and numbers. Ask your director for it.", icon: "people-outline" });
      return;
    }
    setJoining(true);
    try {
      const joined = await choirApi.join(clean);
      if (!mounted.current) return;
      setChoir(joined);
      setCode("");
      // Pro unlocks across the app from here.
      refreshSubscription(true).catch(() => undefined);
      await load();
      showDialog({
        kind: "celebrate",
        title: `Welcome to ${joined.name}`,
        message: "You have Pro while the choir's plan runs, and your choir's shared sheets are below.",
        icon: "people",
        tone: "choir",
        actions: [{ label: "Start singing", style: "cancel" }],
      });
    } catch (e) {
      showDialog({ title: "Could not join", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    } finally {
      if (mounted.current) setJoining(false);
    }
  }

  async function rename() {
    const next = name.trim();
    if (!choir || !next || next === choir.name) return;
    setRenaming(true);
    try {
      const updated = await choirApi.rename(next);
      if (mounted.current) setChoir(updated);
    } catch (e) {
      showDialog({ title: "Could not rename", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    } finally {
      if (mounted.current) setRenaming(false);
    }
  }

  async function shareInvite() {
    if (!choir?.inviteCode) return;
    const link = siteUrls.choirJoin(choir.inviteCode);
    await Share.share({
      message: `Join ${choir.name} on NoteFusion — Pro for every singer and our shared sheets.\n${link}\nChoir code: ${choir.inviteCode}`,
      url: link,
    }).catch(() => undefined);
  }

  function confirmNewCode() {
    showDialog({
      title: "Make a new invite code?",
      message: "The old code and link stop working at once. Singers already in the choir stay in.",
      icon: "refresh-outline",
      actions: [
        {
          label: "New code",
          onPress: async () => {
            try {
              const updated = await choirApi.regenerateInvite();
              if (mounted.current) setChoir(updated);
            } catch (e) {
              showDialog({ title: "Could not make a new code", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
            }
          },
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  function confirmRemove(member: ChoirMember) {
    showDialog({
      title: `Remove ${member.name}?`,
      message: "They lose Pro through the choir, and the sheets they shared leave the choir library.",
      icon: "person-remove-outline",
      tone: "danger",
      actions: [
        {
          label: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await choirApi.removeMember(member.userId);
              await load();
            } catch (e) {
              showDialog({ title: "Could not remove", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
            }
          },
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  function confirmLeave() {
    showDialog({
      title: "Leave the choir?",
      message: "You lose Pro through the choir, and the sheets you shared leave its library. They stay in yours.",
      icon: "exit-outline",
      tone: "danger",
      actions: [
        {
          label: "Leave",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await choirApi.leave();
              refreshSubscription(true).catch(() => undefined);
              await load();
            } catch (e) {
              showDialog({ title: "Could not leave", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
            } finally {
              if (mounted.current) setBusy(false);
            }
          },
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  /** Opens a shared sheet read-only: it shows like a fresh transcription, so saving makes the singer's own copy. */
  async function openSheet(sheet: ChoirSheet) {
    try {
      const full = await choirApi.sheet(sheet.id);
      const derived = deriveSolfa(full.notes ?? [], full.key, full.timeSignature);
      const result: TranscriptionResult = {
        key: full.key,
        keyConfidence: 1,
        tempo: full.tempoBpm,
        timeSignature: full.timeSignature,
        musicXml: full.musicXml ?? "",
        midiBase64: "",
        notes: derived.notes,
        solfaLines: derived.solfaLines,
        overallConfidence: 1,
        audioPreviewBase64: synthesizeMelodyWavBase64(derived.notes, full.tempoBpm),
        lyrics: full.lyrics ?? "",
        parts: (full.parts as TranscriptionResult["parts"]) ?? null,
        partsMusicXml: full.partsMusicXml ?? "",
        shareToken: null,
        chords: full.chords ?? null,
        hymn: full.hymn ?? null,
      };
      navigation.navigate("Result", { result, title: full.title });
    } catch (e) {
      showDialog({ title: "Could not open", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
    }
  }

  function confirmUnshare(sheet: ChoirSheet) {
    showDialog({
      title: "Take it out of the choir library?",
      message: sheet.mine ? "It stays in your own library." : `It stays in ${sheet.sharedBy}'s own library.`,
      icon: "people-outline",
      actions: [
        {
          label: "Take out",
          onPress: async () => {
            try {
              await choirApi.unshare(sheet.id);
              setSheets((prev) => prev.filter((s) => s.id !== sheet.id));
            } catch (e) {
              showDialog({ title: "Could not take it out", message: toApiError(e).message, icon: "alert-circle-outline", tone: "danger" });
            }
          },
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  const director = choir?.role === "director";

  return (
    <Screen
      scroll
      contentStyle={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      <View style={styles.headerRow}>
        <Touchable
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Tabs", { screen: "Profile" }))}
          accessibilityLabel="Go back"
          hitSlop={8}
          ripple="borderless"
        >
          <View style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </Touchable>
        <View style={styles.titleBlock}>
          <Text style={styles.titleLabel}>Choir plan</Text>
          <Text style={styles.titleMain} numberOfLines={1}>
            {choir ? choir.name : "My choir"}
          </Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : loadError ? (
        <Card style={styles.card}>
          <Text style={styles.body}>{loadError}</Text>
          <Button label="Try again" variant="secondary" onPress={() => { setLoading(true); void load(); }} />
        </Card>
      ) : !choir ? (
        <>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Join your choir</Text>
            <Text style={styles.body}>
              Your director's choir code gives you Pro and the choir's shared sheets while the choir's plan runs.
            </Text>
            <TextField
              label="Choir code"
              value={code}
              onChangeText={setCode}
              placeholder="e.g. AB3K7MQZ"
              autoCapitalize="characters"
              autoCorrect={false}
              icon="people-outline"
            />
            <Button label="Join choir" icon="enter-outline" onPress={() => void join()} loading={joining} disabled={!code.trim()} />
          </Card>
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Lead a choir?</Text>
            <Text style={styles.body}>
              The choir plan is for directors: Pro for you and up to 25 singers, 60 songs a month shared, and one library for the whole choir.
            </Text>
            <Button label="See the choir plan" variant="secondary" icon="pricetags-outline" onPress={() => navigation.navigate("Upgrade")} />
          </Card>
        </>
      ) : (
        <>
          {/* ── The choir ─────────────────────────────────────────────── */}
          <Card style={styles.card}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: choir.isActive ? colors.success : colors.warning }]} />
              <Text style={styles.statusText}>
                {choir.isActive
                  ? `Active until ${formatDate(choir.currentPeriodEndUtc)}`
                  : `The choir's plan ended on ${formatDate(choir.currentPeriodEndUtc)}`}
              </Text>
            </View>
            <Text style={styles.body}>
              {director ? "You direct this choir." : `Directed by ${choir.directorName}.`}{" "}
              {choir.seatsUsed} of {choir.seatsTotal} singers
              {choir.isActive ? ` · ${choir.songCreditsRemaining} of ${choir.songCreditsTotal} songs left this month` : ""}
            </Text>
            {director ? (
              <>
                <TextField label="Choir name" value={name} onChangeText={setName} maxLength={80} />
                {name.trim() && name.trim() !== choir.name ? (
                  <Button label="Save name" variant="secondary" onPress={() => void rename()} loading={renaming} />
                ) : null}
              </>
            ) : null}
            {director && !choir.isActive ? (
              <Button label="Renew the choir plan" icon="refresh-outline" onPress={() => navigation.navigate("Upgrade")} />
            ) : null}
          </Card>

          {/* ── Invite (director) ─────────────────────────────────────── */}
          {director && choir.inviteCode ? (
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>Invite your singers</Text>
              <Text style={styles.code} selectable accessibilityLabel={`Choir code ${choir.inviteCode.split("").join(" ")}`}>
                {choir.inviteCode}
              </Text>
              <Text style={styles.link} selectable numberOfLines={1}>
                {siteUrls.choirJoin(choir.inviteCode)}
              </Text>
              <Button label="Share invite link" icon="share-outline" onPress={() => void shareInvite()} />
              <Button label="Make a new code" variant="text" icon="refresh-outline" onPress={confirmNewCode} />
            </Card>
          ) : null}

          {/* ── Singers (director) ────────────────────────────────────── */}
          {director ? (
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>
                Singers · {choir.seatsUsed}/{choir.seatsTotal}
              </Text>
              {members.length === 0 ? (
                <Text style={styles.body}>No one has joined yet. Share the invite link with your choir.</Text>
              ) : (
                members.map((m) => (
                  <View key={m.userId} style={styles.memberRow}>
                    <Ionicons name="person-circle-outline" size={22} color={colors.textMuted} />
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Touchable onPress={() => confirmRemove(m)} hitSlop={12} ripple="borderless" accessibilityLabel={`Remove ${m.name}`}>
                      <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                    </Touchable>
                  </View>
                ))
              )}
            </Card>
          ) : null}

          {/* ── The shared library ────────────────────────────────────── */}
          {choir.isActive ? (
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>Choir library</Text>
              {sheets.length === 0 ? (
                <Text style={styles.body}>
                  Nothing shared yet. In your Library, long-press a sheet, tap share and choose “Share with my choir”.
                </Text>
              ) : (
                sheets.map((s) => {
                  const opening = solfaOpening(s.preview, "4/4");
                  return (
                    <Touchable
                      key={s.id}
                      onPress={() => void openSheet(s)}
                      onLongPress={s.canUnshare ? () => confirmUnshare(s) : undefined}
                      style={styles.sheetRow}
                      accessibilityLabel={`${s.title}, shared by ${s.mine ? "you" : s.sharedBy}`}
                    >
                      <View style={styles.sheetText}>
                        <Text style={styles.sheetTitle} numberOfLines={1}>
                          {s.title}
                        </Text>
                        <Text style={styles.sheetSub} numberOfLines={1}>
                          {s.mine ? "Shared by you" : `Shared by ${s.sharedBy}`} · {s.key}
                          {opening ? ` · ${opening.first}` : ""}
                        </Text>
                      </View>
                      {s.canUnshare ? (
                        <Touchable onPress={() => confirmUnshare(s)} hitSlop={8} ripple="borderless" accessibilityLabel={`Take ${s.title} out of the choir library`}>
                          <Ionicons name="remove-circle-outline" size={20} color={colors.textMuted} />
                        </Touchable>
                      ) : (
                        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                      )}
                    </Touchable>
                  );
                })
              )}
            </Card>
          ) : null}

          {!director ? (
            <Button label="Leave the choir" variant="destructive" icon="exit-outline" onPress={confirmLeave} loading={busy} style={styles.leave} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { paddingBottom: spacing.xxxl },
    headerRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm, marginBottom: spacing.xl },
    backCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    titleBlock: { flex: 1, marginHorizontal: spacing.md },
    titleLabel: { ...typography.caption, color: c.textFaint, textTransform: "uppercase", letterSpacing: 1, fontSize: 10 },
    titleMain: { ...typography.title, color: c.text, fontSize: 22, letterSpacing: -0.4, marginTop: 1 },
    loading: { marginTop: spacing.xxl },
    card: { marginBottom: spacing.md, gap: spacing.sm },
    cardTitle: { ...typography.label, color: c.text, fontSize: 15, fontFamily: fonts.bold },
    body: { ...typography.body, color: c.textMuted, fontSize: 13, lineHeight: 20 },
    statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { ...typography.label, color: c.text, fontSize: 14 },
    code: { fontFamily: fonts.bold, fontSize: 28, letterSpacing: 4, color: c.text, textAlign: "center", marginVertical: spacing.xs },
    link: { ...typography.caption, color: c.textMuted, textAlign: "center" },
    memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
    memberName: { ...typography.body, color: c.text, flex: 1, fontSize: 14 },
    sheetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
    },
    sheetText: { flex: 1 },
    sheetTitle: { ...typography.label, color: c.text, fontSize: 14, fontFamily: fonts.bold },
    sheetSub: { ...typography.caption, color: c.textMuted, marginTop: 2 },
    leave: { marginTop: spacing.md },
  });
