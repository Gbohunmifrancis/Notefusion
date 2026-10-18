import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, LayoutAnimation, StyleSheet, Text, TextInput, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Button } from "./Button";
import { Sheet, SheetActions, SheetTitle } from "./Sheet";
import { ChoiceRow, OptionRow } from "./SheetRows";
import type { CheckoutExitReason } from "../api/types";
import { fonts, type Palette } from "../design/theme";
import { cleanNote, exitReply, exitRows, NOTE_MAX, NOTE_THANKS, type ExitReply, type ReplyContext } from "../lib/checkoutExit";
import { showToast } from "../lib/toast";
import { useColors, useThemedStyles } from "../lib/theme";

/** The checkout being asked about: its id (so a new one starts at the rows) and what the answers need. */
export interface CheckoutExitAsk extends ReplyContext {
  reference: string;
}

interface Props {
  /** The checkout to ask about, or null while the sheet is down. */
  ask: CheckoutExitAsk | null;
  /** Sends the tapped answer, with the note for "Something else". Fire and forget: the reply does not wait on it. */
  onAnswer: (reason: CheckoutExitReason, note?: string) => void;
  /** Reopens the same checkout (the server hands it back for `keptMinutes`). */
  onTryAgain: () => void;
  /** Opens checkout for the one-song purchase. */
  onSong: () => void;
  /** "Not now", "Close", a swipe, the scrim, Android back. */
  onClose: () => void;
}

type Stage = { kind: "ask" } | { kind: "note" } | Extract<ExitReply, { kind: "answer" }>;

/** The rows fade out and the answer fades in while the sheet eases to its new height: 200 ms, no bounce. */
const SWAP_MS = 200;

/**
 * "What stopped you?" (board g-checkout): the one bottom sheet, over the plans, after a checkout came back unpaid.
 * Six one-tap rows (the currency one on dollar checkouts only) and "Not now"; a tap is answered in the same sheet
 * (`lib/checkoutExit`), "Something else" opens a short text box, "I'm just looking" closes with a toast. Neutral
 * tiles and ink icons; nothing here is a problem, so nothing is red or amber.
 */
export function CheckoutExitSheet({ ask, onAnswer, onTryAgain, onSong, onClose }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const [stage, setStage] = useState<Stage>({ kind: "ask" });
  const [note, setNote] = useState("");
  const [focused, setFocused] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  /** What to open once the sheet has left the screen: a browser cannot be presented over a closing sheet. */
  const after = useRef<(() => void) | null>(null);
  const closeThen = (next: () => void) => {
    after.current = next;
    onClose();
  };
  // Kept through the exit, so the sheet leaves looking like itself.
  const last = useRef<CheckoutExitAsk | null>(ask);
  if (ask) last.current = ask;
  const shown = last.current;

  // A new checkout starts at the rows.
  const reference = ask?.reference ?? null;
  useEffect(() => {
    if (!reference) return;
    setStage({ kind: "ask" });
    setNote("");
    fade.setValue(1);
  }, [reference, fade]);

  const swap = (next: Stage) => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(SWAP_MS, "easeInEaseOut", "opacity"));
    fade.setValue(0);
    setStage(next);
    Animated.timing(fade, {
      toValue: 1,
      duration: SWAP_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const tap = (reason: CheckoutExitReason) => {
    if (!shown) return;
    const reply = exitReply(reason, shown);
    if (reply.kind === "note") {
      swap({ kind: "note" });
      return;
    }
    onAnswer(reason);
    if (reply.kind === "toast") {
      onClose();
      showToast(reply.message);
      return;
    }
    swap(reply);
  };

  const send = () => {
    const words = cleanNote(note);
    if (!words) return;
    onAnswer("somethingElse", words);
    onClose();
    showToast(NOTE_THANKS);
  };

  let body: React.ReactNode = null;
  if (shown && stage.kind === "ask") {
    const rows = exitRows(shown.currency);
    body = (
      <>
        <SheetTitle>No payment was made</SheetTitle>
        <Text style={styles.message}>What stopped you? One tap helps us fix it.</Text>
        <View style={styles.rows}>
          {rows.map((row, i) => (
            <OptionRow key={row.reason} label={row.label} icon={row.icon} first={i === 0} onPress={() => tap(row.reason)} />
          ))}
        </View>
        <SheetActions style={styles.after}>
          <Button label="Not now" variant="text" onPress={onClose} />
        </SheetActions>
      </>
    );
  } else if (shown && stage.kind === "note") {
    const words = cleanNote(note);
    body = (
      <>
        <SheetTitle>What stopped you?</SheetTitle>
        <Text style={[styles.message, styles.tight]}>A line is plenty. We read every one.</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="What got in the way?"
          placeholderTextColor={c.textFaint}
          multiline
          maxLength={NOTE_MAX}
          autoFocus
          style={[styles.field, focused && styles.fieldFocused]}
          accessibilityLabel="What stopped you?"
        />
        <Text style={styles.count} accessibilityLabel={`${note.length} of ${NOTE_MAX} characters`}>
          {note.length} / {NOTE_MAX}
        </Text>
        <SheetActions>
          <Button label="Back" variant="text" onPress={() => swap({ kind: "ask" })} />
          <Button label="Send" onPress={send} disabled={!words} />
        </SheetActions>
      </>
    );
  } else if (shown && stage.kind === "answer") {
    body = (
      <>
        <SheetTitle>{stage.title}</SheetTitle>
        <Text style={[styles.message, stage.offerSong && styles.tight]}>
          {stage.parts.map((p, i) =>
            p.strong ? (
              <Text key={i} style={styles.strong}>
                {p.text}
              </Text>
            ) : (
              p.text
            ),
          )}
        </Text>
        {stage.offerSong && shown.songPrice ? (
          <ChoiceRow
            icon="song"
            title="Just this song"
            detail="A smaller payment, no subscription."
            price={shown.songPrice}
            onPress={() => closeThen(onSong)}
          />
        ) : null}
        <SheetActions style={stage.offerSong ? styles.after : undefined}>
          <Button label="Close" variant="text" onPress={onClose} />
          {stage.tryAgain ? (
            <Button
              label="Try again"
              onPress={() => closeThen(onTryAgain)}
            />
          ) : null}
        </SheetActions>
      </>
    );
  }

  return (
    <Sheet
      visible={ask !== null}
      onClose={onClose}
      onClosed={() => {
        setStage({ kind: "ask" });
        setNote("");
        const next = after.current;
        after.current = null;
        next?.();
      }}
      // Always, not only on the text box: switching it remounts the sheet's body mid-fade. Inside the keyboard
      // wrapper, the surface's own 90% cap would be read against the wrapper (its own height) and cut the sheet short;
      // six rows fit any phone, so the cap is the wrapper itself.
      avoidKeyboard
      style={styles.surface}
    >
      <Animated.View style={{ opacity: fade }}>{body}</Animated.View>
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    surface: {
      maxHeight: "100%",
    },
    // SheetMessage's own measure, with the tighter gap above a field or a row the board asks for.
    message: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: c.textMuted,
      marginBottom: 20,
    },
    tight: {
      marginBottom: 12,
    },
    strong: {
      fontFamily: fonts.semibold,
      color: c.text,
    },
    rows: {
      marginBottom: 2,
    },
    after: {
      marginTop: 8,
    },
    field: {
      minHeight: 104,
      maxHeight: 160,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: 14,
      paddingTop: 13,
      paddingBottom: 13,
      fontFamily: fonts.regular,
      fontSize: 16,
      lineHeight: 22,
      color: c.text,
      textAlignVertical: "top",
      marginBottom: 6,
    },
    fieldFocused: {
      borderColor: c.primary,
    },
    count: {
      fontFamily: fonts.regular,
      fontSize: 12.5,
      color: c.textFaint,
      textAlign: "right",
      marginBottom: 14,
    },
  });
