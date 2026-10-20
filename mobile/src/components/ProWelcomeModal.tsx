import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { Sheet, SheetActions, SheetMessage, SheetTitle } from "./Sheet";
import { fonts, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { PRO_FEATURES } from "../lib/proFeatures";
import { dayLabel } from "../lib/price";
import type { WelcomeKind } from "../lib/proWelcome";
import type { Subscription } from "../api/types";

export interface ProWelcome {
  subscription: Subscription;
  /** The account was already Pro (for a choir: the choir already ran) and this payment added time to it. */
  extended: boolean;
  /**
   * `song` for a one-song purchase: one more transcription, nothing about Pro. `choir` for a choir plan, which is the
   * choir's period whatever the director's own Pro does. Default `pro`.
   */
  kind?: WelcomeKind;
}

/** "Pro until 3 Nov 2026" (as the paywall says dates), or "Pro for life": a lifetime end date is a far-future sentinel. */
function untilLine(sub: Subscription): string | null {
  if (sub.isLifetime) return "Pro for life";
  if (!sub.currentPeriodEndUtc) return null;
  const date = dayLabel(new Date(sub.currentPeriodEndUtc));
  // Google Play renews it by itself (board h-play 02): the date is the next charge, not an end.
  return sub.autoRenews ? `renews ${date}` : `Pro until ${date}`;
}

/** "Sunday choir · Pro until 3 Nov 2026": the choir's own period, not the director's. */
function choirLine(sub: Subscription): string {
  const name = sub.choirName || "Your choir";
  return sub.choirPeriodEndUtc ? `${name} · Pro until ${dayLabel(new Date(sub.choirPeriodEndUtc))}` : name;
}

/**
 * The one moment a payment is acknowledged. Mounted by SubscriptionProvider, so it shows over
 * whatever screen the user is on when the payment lands — the checkout browser may have closed
 * minutes earlier and they have moved on.
 *
 * The celebration sheet: a small gold tile beside the title (gold is Pro's), the plan line, the
 * perks as plain rows, and one blue pill that hugs its word.
 */
export function ProWelcomeModal({
  welcome,
  onClose,
  onAction,
}: {
  welcome: ProWelcome | null;
  onClose: () => void;
  /** The button's way on (`lib/proWelcome`), run once the sheet has gone; a swipe or the backdrop only closes it. */
  onAction?: (welcome: ProWelcome) => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  // Retained through the exit, so the sheet leaves looking like itself.
  const [shown, setShown] = useState<ProWelcome | null>(welcome);
  useEffect(() => {
    if (welcome) setShown(welcome);
  }, [welcome]);
  /** The button's way on, waiting for the sheet to leave: one modal at a time on iOS. */
  const after = useRef<(() => void) | null>(null);

  const sub = shown?.subscription;
  const song = shown?.kind === "song";
  const choir = shown?.kind === "choir";
  const until = sub && !song ? untilLine(sub) : null;
  const plan = sub?.planName || "NoteFusion Pro";

  return (
    <Sheet
      visible={welcome !== null && shown !== null}
      onClose={onClose}
      onClosed={() => {
        const run = after.current;
        after.current = null;
        run?.();
      }}
    >
      <SheetTitle
        leading={
          // Gold is Pro's crown alone: a bought song is the plain song mark on a neutral tile.
          <View style={[styles.tile, song && { backgroundColor: c.sheetTile }]}>
            <Icon name={song ? "song" : "pro"} size={20} color={song ? c.icon : c.premium} />
          </View>
        }
      >
        {song
          ? "Your song is paid for"
          : choir
            ? shown?.extended
              ? "More choir time added"
              : "Your choir is Pro"
            : shown?.extended
              ? "More Pro time added"
              : "Welcome to NoteFusion Pro"}
      </SheetTitle>

      <SheetMessage>
        {song
          ? "One more transcription. Record, upload, or paste a song link: it never expires."
          : choir && sub
            ? `${choirLine(sub)}. Everyone who joins with your invite code is Pro too.`
            : until
              ? `${plan} · ${until}`
              : plan}
      </SheetMessage>

      {!song ? (
        <View style={styles.perks}>
          {PRO_FEATURES.map((f) => (
            <View key={f.text} style={styles.perk}>
              <Icon name={f.icon} size={16} color={c.textMuted} />
              <Text style={styles.perkText}>{f.text}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <SheetActions>
        <Button
          label={song ? "Transcribe it" : choir ? "Invite your singers" : "Start using Pro"}
          onPress={() => {
            const w = shown;
            after.current = w && onAction ? () => onAction(w) : null;
            onClose();
          }}
        />
      </SheetActions>
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    tile: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.premiumSoft,
    },
    perks: {
      gap: 10,
      marginTop: -6,
      marginBottom: 22,
    },
    perk: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    perkText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 20,
      color: c.text,
    },
  });
