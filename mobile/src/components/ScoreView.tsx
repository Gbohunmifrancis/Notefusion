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

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import type { NoteEvent } from "../api/types";
import { type Palette, radii, spacing, typography } from "../design/theme";
import { doubtfulBeats, isDoubtfulNote } from "../lib/confidence";
import { beatKey, buildMusicXml, onsetIndexMap, resolveKeySignature } from "../lib/musicxml";
import { useColors, useThemedStyles } from "../lib/theme";
import { expectedStaveHeight, MIN_STAVE_HEIGHT, skeletonStaffTops, STAFF_LINE_GAP } from "../lib/staveLayout";
import { ProblemNote } from "./ProblemNote";

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
  | { type: "svg"; token: number; svg: string }
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
  /** Called each time the engraver has drawn the stave: `getSvg` answers from then on. */
  onRendered?: () => void;
  /** Print each note's solfa syllable under its head. On by default. */
  showSolfa?: boolean;
  /** How many bars the tune spans: the card opens at the height they will need (board n-ux-low Q1f). */
  bars?: number;
  /**
   * Mark the doubtful notes (board m-ux-medium P1g): their heads amber in a dotted amber ring, every other head ink,
   * so a doubtful note is found by its shape as well as its colour. On by default per the PRD honesty rule.
   */
  colorByConfidence?: boolean;
}

/** What a parent can ask the engraved stave for. */
export interface ScoreViewHandle {
  /** The sheet as it is drawn, as standalone SVG markup — the PDF export's input. */
  getSvg: () => Promise<string>;
}

const ScoreView = forwardRef<ScoreViewHandle, Props>(function ScoreView({
  notes,
  timeSignature,
  musicalKey,
  cursorBeat = null,
  onSelectNote,
  onRendered,
  showSolfa = true,
  colorByConfidence = true,
  bars = 0,
}: Props, ref) {
  const palette = useColors();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();

  const webRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  /**
   * Until the engraver first reports, the card holds the height the bars will need with a skeleton in it (board n-ux-low
   * Q1f); the drawn stave then fades in over it in 150 ms, and the card eases to the reported height in 200 ms.
   */
  const [height, setHeight] = useState(() => expectedStaveHeight(bars));
  const box = useRef(new Animated.Value(height)).current;
  const shown = useRef(new Animated.Value(0)).current;
  const firstDraw = useRef(true);
  const [drawn, setDrawn] = useState(false);
  /** The engraver's own words — logged in development, never shown. */
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (__DEV__ && error !== null) console.warn("[score]", error);
  }, [error]);

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
        colorFor: colorByConfidence ? (conf) => (isDoubtfulNote(conf) ? palette.warning : null) : undefined,
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
      // The page rings these heads once it has laid the bars out (scripts/engraver/page.js `ringDoubts`).
      doubtBeats: colorByConfidence ? doubtfulBeats(notes) : [],
      ringColor: palette.warning,
    }),
    [palette, showSolfa, colorByConfidence, notes],
  );

  const send = useCallback((js: string) => {
    // `true;` keeps iOS from complaining about a non-serialisable return value.
    webRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  /** Pending `getSvg` calls, by the token the page echoes back. */
  const svgWaiters = useRef(new Map<number, (svg: string) => void>());
  const svgToken = useRef(0);
  useImperativeHandle(
    ref,
    () => ({
      getSvg: () =>
        new Promise<string>((resolve, reject) => {
          if (!rendered) {
            reject(new Error("The stave has not been drawn yet."));
            return;
          }
          const token = ++svgToken.current;
          svgWaiters.current.set(token, resolve);
          send(`window.NF.svg(${token})`);
          setTimeout(() => {
            if (svgWaiters.current.delete(token)) reject(new Error("The engraver did not answer."));
          }, 8000);
        }),
    }),
    [rendered, send],
  );

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
        case "rendered": {
          const next = Math.max(MIN_STAVE_HEIGHT, message.height);
          setHeight(next);
          if (reduceMotion) box.setValue(next);
          else Animated.timing(box, { toValue: next, duration: EASE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
          if (firstDraw.current) {
            firstDraw.current = false;
            Animated.timing(shown, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(
              () => setDrawn(true),
            );
          }
          setRendered(true);
          setError(null);
          onRendered?.();
          return;
        }
        case "svg": {
          const waiter = svgWaiters.current.get(message.token);
          svgWaiters.current.delete(message.token);
          waiter?.(message.svg);
          return;
        }
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
    [indexByOnset, onSelectNote, onRendered, reduceMotion, box, shown],
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
      <Animated.View style={[styles.box, { height: box }]}>
        {html === null ? null : (
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
        {/* The skeleton covers the page while it loads and draws, then fades to show the stave where its lines were:
            the WebView itself is never faded, which Android draws badly. */}
        {drawn ? null : (
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.skeleton, { opacity: shown.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
            pointerEvents="none"
          >
            <StaveSkeleton bars={bars} sweeping={!reduceMotion && error === null} />
          </Animated.View>
        )}
      </Animated.View>
      {error !== null && <ProblemNote style={styles.error}>Could not draw the stave. Please try again.</ProblemNote>}
    </View>
  );
});

/** The sweep's width and one pass across the card. */
const SWEEP_W = 120;
const SWEEP_MS = 1400;

/**
 * The stave before it is drawn: each system's five lines in faint grey, a block where the clef will be, and a soft sweep
 * across them (still under Reduce Motion, and once the engraver has failed).
 */
function StaveSkeleton({ bars, sweeping }: { bars: number; sweeping: boolean }) {
  const palette = useColors();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!sweeping || width === 0) return;
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweeping, width, sweep]);

  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {skeletonStaffTops(bars).map((top) => (
        <React.Fragment key={top}>
          <View style={[styles.skeletonClef, { top: top - 10 }]} />
          {[0, 1, 2, 3, 4].map((line) => (
            <View key={line} style={[styles.skeletonLine, { top: top + line * STAFF_LINE_GAP }]} />
          ))}
        </React.Fragment>
      ))}
      {sweeping && width > 0 ? (
        <Animated.View
          style={[
            styles.sweep,
            { transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-SWEEP_W, width] }) }] },
          ]}
        >
          <Svg width={SWEEP_W} height="100%">
            <Defs>
              <LinearGradient id="nf-stave-sweep" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={palette.text} stopOpacity={0} />
                <Stop offset="0.5" stopColor={palette.text} stopOpacity={0.06} />
                <Stop offset="1" stopColor={palette.text} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={SWEEP_W} height="100%" fill="url(#nf-stave-sweep)" />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

export default ScoreView;

/** The drawn stave fading in over its skeleton, and the card easing to the height the engraver reports. */
const FADE_MS = 150;
const EASE_MS = 200;

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
    /** Holds the stave's height, easing between the expected one and each reported. */
    box: {
      overflow: "hidden",
    },
    web: {
      backgroundColor: "transparent",
      width: "100%",
    },
    /** The card's own surface, so the page under it is hidden until it has drawn. */
    skeleton: {
      backgroundColor: c.surface,
    },
    skeletonLine: {
      position: "absolute",
      left: 10,
      right: 10,
      height: 1,
      backgroundColor: c.textMuted,
      opacity: 0.28,
    },
    skeletonClef: {
      position: "absolute",
      left: 12,
      width: 24,
      height: 52,
      borderRadius: 6,
      backgroundColor: c.surfaceAlt,
    },
    sweep: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      width: SWEEP_W,
    },
    empty: {
      ...typography.body,
      color: c.textFaint,
      fontStyle: "italic",
      paddingHorizontal: spacing.lg,
    },
    error: {
      paddingHorizontal: spacing.md,
    },
  });
