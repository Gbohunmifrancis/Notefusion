import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { Sheet, SheetActions, SheetTitle } from "../components/Sheet";
import { Card } from "../components/Card";
import { Touchable } from "../components/Touchable";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { formatBytes, needsDownload, searchHymns, type HymnPack, type PackHymn, type PackMeta } from "../lib/hymnPack";
import { downloadPack, installedPack, remotePackMeta, usePackState } from "../lib/hymnPackStore";
import { resultFromHymn } from "../lib/openSheet";
import { useDataSaver } from "../lib/dataSaver";
import { showDialog } from "../lib/dialog";
import { showToast } from "../lib/toast";
import { logAnalyticsEvent } from "../lib/analytics";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Hymns">;

/**
 * Hymns — the website's public-domain hymns and tunes, from the offline pack: download once, then
 * browse, search and open any of them as a sheet (play, solfa, staff, practise) with no connection.
 * Until the pack is on the phone the screen offers the download and its size; once it is, a newer
 * version is looked for weekly (off data saver) or when "Check for updates" is tapped.
 */
export function HymnsScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const packState = usePackState();
  const dataSaver = useDataSaver();

  const [pack, setPack] = useState<HymnPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PackMeta | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<PackHymn | null>(null);

  useEffect(() => {
    let live = true;
    void installedPack().then((p) => {
      if (!live) return;
      setPack(p);
      setLoading(false);
      // Before a download, the size on the button comes from the website (130 bytes).
      if (!p) void remotePackMeta().then((m) => live && setMeta(m));
    });
    return () => {
      live = false;
    };
  }, []);

  const results = useMemo(() => (pack ? searchHymns(pack.hymns, query) : []), [pack, query]);

  async function download(expected?: PackMeta | null) {
    setProgress(0);
    try {
      const next = await downloadPack(setProgress, expected?.bytes ?? meta?.bytes);
      setPack(next);
    } catch (e) {
      showDialog({
        title: "Couldn't download the hymns",
        message: e instanceof Error && /room|read/.test(e.message) ? e.message : "Check your connection and try again.",
        icon: "cloud-offline-outline",
        tone: "danger",
      });
    } finally {
      setProgress(null);
    }
  }

  async function checkForUpdate() {
    setChecking(true);
    const remote = await remotePackMeta();
    setChecking(false);
    if (!remote) {
      showDialog({ title: "You're offline", message: "The hymns on your phone still work. Check again when you're online.", icon: "cloud-offline-outline" });
      return;
    }
    if (!needsDownload(packState.version, remote)) {
      showToast(`Up to date: every hymn we publish (${remote.count})`);
      return;
    }
    showDialog({
      title: "Newer hymns available",
      message: `Download the updated hymns (${formatBytes(remote.bytes)})?`,
      icon: "cloud-download-outline",
      actions: [
        { label: "Download", icon: "cloud-download-outline", onPress: () => void download(remote) },
        { label: "Not now", style: "cancel" },
      ],
    });
  }

  function openSheet(h: PackHymn) {
    setOpen(null);
    void logAnalyticsEvent("hymn_opened", { slug: h.slug, kind: h.kind });
    navigation.navigate("Result", { result: resultFromHymn(h), title: h.title });
  }

  const header = (
    <View style={styles.headerRow}>
      <Touchable
        onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Tabs", { screen: "Home" }))}
        accessibilityLabel="Go back"
        hitSlop={8}
        ripple="borderless"
      >
        <View style={styles.backCircle}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </View>
      </Touchable>
      <View style={styles.titleBlock}>
        <Text style={styles.titleLabel}>{pack ? `${pack.count} hymns and tunes · offline` : "Hymnbook"}</Text>
        <Text style={styles.titleMain}>Hymns</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <Screen>
        {header}
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      </Screen>
    );
  }

  if (!pack) {
    const size = meta ? formatBytes(meta.bytes) : null;
    return (
      <Screen scroll>
        {header}
        <Card style={styles.card}>
          <View style={styles.offerIcon}>
            <Ionicons name="book-outline" size={22} color={colors.accent} />
          </View>
          <Text style={styles.offerTitle}>Hymns you can use anywhere</Text>
          <Text style={styles.offerBody}>
            {meta ? `${meta.count} public-domain hymns and tunes` : "Our public-domain hymns and tunes"} in Tonic Solfa and staff, with
            the words and a piano. Download them once and they work with no data at all.
          </Text>
          {progress !== null ? (
            <View style={styles.progressBlock} accessibilityLabel={`Downloading, ${Math.round(progress * 100)} percent`}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} />
              </View>
              <Text style={styles.progressText}>Downloading… {Math.round(progress * 100)}%</Text>
            </View>
          ) : (
            <Button
              label={size ? `Download hymns for offline — ${size}` : "Download hymns for offline"}
              icon="cloud-download-outline"
              onPress={() => void download()}
            />
          )}
          {dataSaver ? <Text style={styles.note}>Data saver is on: the hymns only update when you ask.</Text> : null}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={results}
        keyExtractor={(h) => h.slug}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        windowSize={7}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        ListHeaderComponent={
          <View>
            {header}
            <View style={styles.searchPill}>
              <Ionicons name="search-outline" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Title, first line or tune"
                placeholderTextColor={colors.textFaint}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                autoCorrect={false}
              />
              {query ? (
                <Touchable onPress={() => setQuery("")} hitSlop={8} ripple="borderless" accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={18} color={colors.textFaint} />
                </Touchable>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Touchable onPress={() => setOpen(item)} style={styles.row} radius={radii.md} accessibilityLabel={`${item.title}, ${item.key}`}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.kind === "tune" ? `Tune · ${item.tune}` : item.firstLine}
              </Text>
            </View>
            <Text style={styles.rowKey}>{`${item.key.replace(" major", "").replace(" minor", "m")} · ${item.time}`}</Text>
          </Touchable>
        )}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing matches “{query.trim()}”.</Text>}
        ListFooterComponent={
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {formatBytes(packState.bytes)} on this phone{dataSaver ? " · updates when you ask (data saver)" : " · checked weekly"}
            </Text>
            <Touchable onPress={() => void checkForUpdate()} disabled={checking || progress !== null} ripple={false} hitSlop={8} accessibilityLabel="Check for newer hymns">
              <Text style={styles.footerLink}>
                {progress !== null ? `Downloading… ${Math.round(progress * 100)}%` : checking ? "Checking…" : "Check for updates"}
              </Text>
            </Touchable>
          </View>
        }
      />

      <Sheet visible={open !== null} onClose={() => setOpen(null)}>
        {open ? (
          <>
            <SheetTitle>{open.title}</SheetTitle>
            <Text style={styles.sheetMeta}>{[open.tune && `Tune ${open.tune}`, open.key, open.time].filter(Boolean).join(" · ")}</Text>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={{ gap: spacing.md }}>
              {open.verses.map((v, i) => (
                <View key={i}>
                  {v.label ? <Text style={styles.verseLabel}>{v.label}</Text> : <Text style={styles.verseLabel}>{`Verse ${i + 1}`}</Text>}
                  <Text style={styles.verse}>{v.lines.join("\n")}</Text>
                </View>
              ))}
              {open.verses.length === 0 ? <Text style={styles.verse}>A hymn tune, without words.</Text> : null}
              <Text style={styles.credit}>{open.credit}</Text>
            </ScrollView>
            <SheetActions>
              <Button label="Open the sheet" onPress={() => openSheet(open)} />
            </SheetActions>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    headerRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm, marginBottom: spacing.lg },
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

    card: { gap: spacing.md },
    offerIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    offerTitle: { ...typography.heading, color: c.text },
    offerBody: { ...typography.body, color: c.textMuted, lineHeight: 21 },
    note: { ...typography.caption, color: c.textFaint },
    progressBlock: { gap: spacing.sm },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.surfaceAlt, overflow: "hidden" },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: c.accent },
    progressText: { ...typography.caption, color: c.textMuted },

    searchPill: {
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: 14,
      marginBottom: spacing.md,
    },
    searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: c.text, height: "100%", paddingVertical: 0 },

    row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: spacing.md },
    rowText: { flex: 1 },
    rowTitle: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    rowSub: { fontFamily: fonts.regular, fontSize: 12.5, color: c.textMuted, marginTop: 2 },
    rowKey: { fontFamily: typography.mono.fontFamily, fontSize: 12, color: c.textFaint },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
    empty: { ...typography.body, color: c.textMuted, textAlign: "center", marginTop: spacing.xl },

    footer: { alignItems: "center", gap: spacing.xs, marginTop: spacing.xl },
    footerText: { ...typography.caption, color: c.textFaint, textAlign: "center" },
    footerLink: { fontFamily: fonts.medium, fontSize: 13, color: c.accent },

    sheetMeta: { ...typography.caption, color: c.textMuted },
    sheetScroll: { flexGrow: 0, marginTop: spacing.md, marginBottom: spacing.lg },
    verseLabel: { ...typography.caption, color: c.textFaint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
    verse: { ...typography.body, color: c.text, lineHeight: 22 },
    credit: { ...typography.caption, color: c.textFaint, lineHeight: 18 },
  });
