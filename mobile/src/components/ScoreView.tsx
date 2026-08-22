/**
 * The stave, engraved by OpenSheetMusicDisplay inside a WebView.
 *
 * `StaffNotation` draws SVG by hand and is honest about what it cannot do: no
 * beams, no proportional spacing, no rests, no ties, no system breaks. Those are
 * not polish — a dotted crotchet printed as a plain one is a third short, and a
 * bar of silence with no rest in it is a bar that has vanished. Engraving them
 * properly is a large, well-solved problem, so this component hands the score to
 * a real engraver and keeps only the parts that are ours: what the rhythm is
 * (`lib/musicxml`), where the cursor sits, and which note a tap means.
 *
 * The document is `assets/engraver/index.html`, built by
 * `scripts/build-engraver.mjs` — one offline file, no network. It is passed as
 * `source={{ html }}` rather than a `file://` uri: that costs one 1.3 MB string
 * over the bridge per mount, but it behaves identically on both platforms and
 * needs none of Android's file-access permissions. The read itself happens once
 * per app session.
 *
 * Everything crossing into the page is a **quarter-note beat**, matching the
 * wire's `startBeat`. See `scripts/engraver/page.js` for the other half.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type { NoteEvent } from "../api/types";
import { type Palette, confidenceColor, radii, spacing, typography } from "../design/theme";
import { beatKey, buildMusicXml, onsetIndexMap, resolveKeySignature } from "../lib/musicxml";
import { useColors, useThemedStyles } from "../lib/theme";

const ENGRAVER_HTML = require("../../assets/engraver/index.html") as number;

/** The asset is 1.3 MB and never changes; read it once for the whole session. */
let htmlCache: string | null = null;

async function loadEngraverHtml(): Promise<string> {
  if (htmlCache !== null) return htmlCache;
  const asset = Asset.fromModule(ENGRAVER_HTML);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  htmlCache = await new File(uri).text();
  return htmlCache;
}

type PageMessage =
  | { type: "ready" }
  | { type: "rendered"; height: number; heads: number }
  | { type: "tap"; beat: number }
  | { type: "error"; where: string; message: string };

interface Props {
  notes: readonly NoteEvent[];
  /** Quarter-note beats per bar are derived from this (e.g. "6/8" → 3). */
  timeSignature: string;
  /**
   * The key the notes are read in, e.g. "D minor". Drives the key signature and
   * the spelling of every accidental. Pass the *current* key so a re-key
   * re-labels the stave; unparseable or absent falls back to C major.
   */
  musicalKey?: string | null;
  /**
   * Where playback has reached, in quarter notes. null hides the cursor — which
   * is the resting state, since a cursor parked on beat 0 reads as "playing".
   */
  cursorBeat?: number | null;
  /** Called with the index into `notes` of the notehead that was tapped. */
  onSelectNote?: (index: number) => void;
  /** Print each note's solfa syllable under its head. On by default. */
  showSolfa?: boolean;
  /** Tint each head by its confidence. On by default per the PRD honesty rule. */
  colorByConfidence?: boolean;
}

export default function ScoreView({
  notes,
  timeSignature,
  musicalKey,
  cursorBeat = null,
  onSelectNote,
  showSolfa = true,
  colorByConfidence = true,
}: Props) {
  const palette = useColors();
  const styles = useThemedStyles(makeStyles);

  const webRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadEngraverHtml().then(
      (text) => {
        if (live) setHtml(text);
      },
      (err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const xml = useMemo(
    () =>
      buildMusicXml(notes, resolveKeySignature(musicalKey), timeSignature, {
        lyrics: showSolfa,
        colorFor: colorByConfidence ? (conf) => confidenceColor(conf, palette) : undefined,
      }),
    [notes, musicalKey, timeSignature, showSolfa, colorByConfidence, palette],
  );

  const options = useMemo(
    () => ({
      ink: palette.text,
      pageBackground: palette.surface,
      cursorColor: palette.accent,
      lyrics: showSolfa,
      showCursor: false,
      measureNumberInterval: 1,
    }),
    [palette, showSolfa],
  );

  const send = useCallback((js: string) => {
    // `true;` keeps iOS from complaining about a non-serialisable return value.
    webRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  useEffect(() => {
    if (!ready || xml === null) return;
    setRendered(false);
    send(`window.NF.render(${JSON.stringify({ xml, options })})`);
  }, [ready, xml, options, send]);

  // Runs on every cursor move, and again after each render — a fresh render
  // resets the cursor, so the position has to be re-applied once it lands.
  useEffect(() => {
    if (!rendered) return;
    send(`window.NF.cursorTo(${cursorBeat ?? -1})`);
  }, [rendered, cursorBeat, send]);

  /**
   * The page reports the beat a head starts on rather than an index, because an
   * index would have to survive rests, tie splits and the engraver's own
   * ordering. `onsetIndexMap` resolves it back with the same overlap rules the
   * engraving used, so a tap can never name a note that is not on the page.
   */
  const indexByOnset = useMemo(() => onsetIndexMap(notes, timeSignature), [notes, timeSignature]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: PageMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as PageMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case "ready":
          setReady(true);
          return;
        case "rendered":
          setHeight(Math.max(MIN_HEIGHT, message.height));
          setRendered(true);
          setError(null);
          return;
        case "tap": {
          const index = indexByOnset.get(beatKey(message.beat));
          if (index !== undefined) onSelectNote?.(index);
          return;
        }
        case "error":
          setError(`${message.where}: ${message.message}`);
          return;
      }
    },
    [indexByOnset, onSelectNote],
  );

  if (notes.length === 0 || xml === null) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.empty}>No notes to engrave yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {html === null ? (
        <View style={[styles.placeholder, { height: MIN_HEIGHT }]}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={{ html }}
          onMessage={onMessage}
          onError={({ nativeEvent }) => setError(nativeEvent.description)}
          style={[styles.web, { height }]}
          // The parent screen scrolls; a WebView that also scrolls would trap
          // the gesture and leave the stave stuck mid-page.
          scrollEnabled={false}
          nestedScrollEnabled={false}
          originWhitelist={["*"]}
          javaScriptEnabled
          // Nothing here loads, plays or stores anything.
          allowsInlineMediaPlayback={false}
          mediaPlaybackRequiresUserAction
          cacheEnabled={false}
          setSupportMultipleWindows={false}
          androidLayerType="hardware"
        />
      )}
      {error !== null && <Text style={styles.error}>Could not draw the stave: {error}</Text>}
    </View>
  );
}

/** Enough for one system, so the WebView is never laid out at zero height. */
const MIN_HEIGHT = 160;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: c.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: spacing.md,
      overflow: "hidden",
    },
    web: {
      backgroundColor: "transparent",
      width: "100%",
    },
    placeholder: {
      alignItems: "center",
      justifyContent: "center",
    },
    empty: {
      ...typography.body,
      color: c.textFaint,
      fontStyle: "italic",
      paddingHorizontal: spacing.lg,
    },
    error: {
      ...typography.caption,
      color: c.danger,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
  });
