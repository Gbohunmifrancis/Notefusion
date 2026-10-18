import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "./Button";
import { Sheet, SheetActions, SheetMessage, SheetTitle } from "./Sheet";
import { fonts, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { PRO_FEATURES } from "../lib/proFeatures";
import type { Subscription } from "../api/types";

export interface ProWelcome {
  subscription: Subscription;
  /** The account was already Pro and this payment added time to it. */
  extended: boolean;
  /** `song` for a one-song purchase: one more transcription, nothing about Pro. Default `pro`. */
  kind?: "pro" | "song";
}

/** "Pro until Nov 3, 2026", or "Pro for life": a lifetime end date is a far-future sentinel. */
function untilLine(sub: Subscription): string | null {
  if (sub.isLifetime) return "Pro for life";
  if (!sub.currentPeriodEndUtc) return null;
  const date = new Date(sub.currentPeriodEndUtc).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Pro until ${date}`;
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
}: {
  welcome: ProWelcome | null;
  onClose: () => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  // Retained through the exit, so the sheet leaves looking like itself.
  const [shown, setShown] = useState<ProWelcome | null>(welcome);
  useEffect(() => {
    if (welcome) setShown(welcome);
  }, [welcome]);

  const sub = shown?.subscription;
  const song = shown?.kind === "song";
  const until = sub && !song ? untilLine(sub) : null;
  const plan = sub?.planName || "NoteFusion Pro";

  return (
    <Sheet visible={welcome !== null && shown !== null} onClose={onClose}>
      <SheetTitle
        leading={
          <View style={styles.tile}>
            <Ionicons name={song ? "musical-note" : "star"} size={20} color={c.premium} />
          </View>
        }
      >
        {song ? "Your song is paid for" : shown?.extended ? "More Pro time added" : "Welcome to NoteFusion Pro"}
      </SheetTitle>

      <SheetMessage>
        {song
          ? "One more transcription. Record, upload, or paste a song link: it never expires."
          : until
            ? `${plan} · ${until}`
            : plan}
      </SheetMessage>

      {!song ? (
        <View style={styles.perks}>
          {PRO_FEATURES.map((f) => (
            <View key={f.text} style={styles.perk}>
              <Ionicons name={f.icon} size={16} color={c.textMuted} />
              <Text style={styles.perkText}>{f.text}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <SheetActions>
        <Button label={song ? "Transcribe it" : "Start using Pro"} onPress={onClose} />
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
