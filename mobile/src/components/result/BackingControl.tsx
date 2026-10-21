import React, { useRef } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { Icon } from "../Icon";
import { Button } from "../Button";
import { FoldAway } from "../FoldAway";
import { fonts, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { BACKING_WORDS, backToLabel, type BackingRows } from "../../lib/backingSync";
import { BalanceSlider } from "./BalanceSlider";

export interface BackingControlProps {
  /** What there is to say about the song's backing (lib/backingSync `backingRows`). */
  rows: BackingRows;
  /** The switch, remembered on the phone. */
  on: boolean;
  onToggle: (on: boolean) => void;
  /** The balance, 0 (the solfa alone) to 1 (the backing alone). */
  balance: number;
  /** `persist` false while the thumb is dragged; the drag's end keeps it. */
  onBalance: (balance: number, persist: boolean) => void;
  /** A transposed sheet's way back to the song's own key. */
  onBack: () => void;
  /** The way back is being taken (the transposition is on its way to the server). */
  backBusy?: boolean;
}

/**
 * The song's backing control, shared by the dock (board O1a) and Rehearse's card (O2a), one setting for both:
 * "Song backing" and the app's switch, the Solfa · Backing balance under it (folded away with the switch off), and
 * the states where it sits out (O3): a transposed sheet greys the switch, says why and offers the way back; a link's
 * sheet opened again says only that links keep no backing (on the dock; Rehearse shows nothing then).
 */
export function BackingControl({
  place,
  rows,
  on,
  onToggle,
  balance,
  onBalance,
  onBack,
  backBusy = false,
}: BackingControlProps & { place: "dock" | "rehearse" }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const rehearse = place === "rehearse";

  if (rows.kind === "none") return null;
  if (rows.kind === "linkLater") {
    // "No backing: a sheet without it shows no card; Rehearse is as today" (O2 rules).
    if (rehearse) return null;
    return (
      <View style={styles.mute} accessible accessibilityLabel={BACKING_WORDS.linkLater}>
        <Icon name="song" size={16} color={c.textFaint} />
        <Text style={styles.muteText}>{BACKING_WORDS.linkLater}</Text>
      </View>
    );
  }

  const box = rehearse ? styles.card : styles.hairline;
  if (rows.kind === "transposed") {
    return (
      <View key="transposed" style={box}>
        <SwitchRow on={false} dim onToggle={onToggle} />
        <Text style={styles.note}>{BACKING_WORDS.transposed}</Text>
        <View style={styles.back}>
          <Button
            label={backToLabel(rows.backTo)}
            variant="text"
            size="sm"
            icon="transpose"
            loading={backBusy}
            onPress={onBack}
          />
        </View>
      </View>
    );
  }

  return (
    <View key="playable" style={box}>
      <SwitchRow on={on} onToggle={onToggle} />
      <Fold on={on}>
        <BalanceSlider value={balance} onChange={(v) => onBalance(v, false)} onCommit={(v) => onBalance(v, true)} />
        {rehearse ? (
          <Text style={styles.hint}>{BACKING_WORDS.rehearse}</Text>
        ) : rows.freshLink ? (
          <Text style={[styles.note, styles.noteLast]}>{BACKING_WORDS.freshLink}</Text>
        ) : null}
      </Fold>
    </View>
  );
}

/** The balance folds away with the switch off (200 ms, the dock rising with it) and unfolds with it on. */
function Fold({ on, children }: { on: boolean; children: React.ReactNode }) {
  // Opened with the switch already off: it starts folded rather than folding on arrival.
  const startsOff = useRef(!on).current;
  return (
    <FoldAway gone={!on} appear={startsOff} onGone={noop}>
      {children}
    </FoldAway>
  );
}

function noop() {}

/** "Song backing": the song icon (the credit's own), the label, the app's switch; greyed and off while it sits out. */
function SwitchRow({ on, dim = false, onToggle }: { on: boolean; dim?: boolean; onToggle: (on: boolean) => void }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.switchRow}>
      <Icon name="song" size={18} color={dim ? c.textFaint : c.icon} />
      <Text style={[styles.label, dim && styles.labelDim]} numberOfLines={1}>
        {BACKING_WORDS.label}
      </Text>
      <Switch
        value={on}
        onValueChange={onToggle}
        disabled={dim}
        trackColor={{ false: c.grabber, true: c.primary }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={c.grabber}
        accessibilityLabel={BACKING_WORDS.label}
        accessibilityHint={dim ? BACKING_WORDS.transposed : undefined}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    /** On the dock: a hairline 12 under the play row, the rows 8 under it. */
    hairline: { marginTop: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border },
    /** In Rehearse: its own card under the transport. */
    card: {
      marginTop: 26,
      paddingTop: 6,
      paddingBottom: 10,
      paddingHorizontal: 16,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
    label: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    labelDim: { color: c.textFaint },
    note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 2 },
    noteLast: { marginTop: 0, marginBottom: 2 },
    hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted, marginTop: 2 },
    /** The text button's own inset sits outside the column, so its icon lines up with the words above. */
    back: { flexDirection: "row", marginTop: 2, marginBottom: -6, marginLeft: -12 },
    mute: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    muteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: c.textMuted },
  });
