import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Touchable } from "../Touchable";
import { useColors, useThemedStyles } from "../../lib/theme";
import { fonts, radii, spacing, type Palette } from "../../design/theme";
import { statusLine, type QueuedSend } from "../../lib/sendQueue";
import { formatBytes } from "../../lib/hymnPack";

/**
 * Recordings waiting in the send queue (lib/outbox), above the Library's sheets: what each is
 * doing in a plain line, and what can be done — send now, try again, delete, or open once ready.
 */
export function PendingSends({
  items,
  onRetry,
  onDelete,
  onOpen,
}: {
  items: readonly QueuedSend[];
  onRetry: (item: QueuedSend) => void;
  onDelete: (item: QueuedSend) => void;
  onOpen: (item: QueuedSend) => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>{items.length === 1 ? "Waiting to send" : `Waiting to send · ${items.length}`}</Text>
      {items.map((item) => {
        const when = new Date(item.createdAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
        const name = item.fileName.startsWith("clip-") ? "Recording" : item.fileName;
        const problem = item.status === "refused" || item.status === "failed";
        const icon: keyof typeof Ionicons.glyphMap =
          item.status === "done" ? "checkmark-circle" : problem ? "alert-circle-outline" : item.status === "sent" ? "hourglass-outline" : "cloud-upload-outline";
        return (
          <View key={item.id} style={styles.card} accessible={false}>
            <View style={styles.top} accessible accessibilityLabel={`${name}, ${when}. ${statusLine(item)}`}>
              {item.status === "sending" ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name={icon} size={20} color={problem ? colors.warning : colors.accent} />
              )}
              <View style={styles.text}>
                <Text style={styles.title} numberOfLines={1}>{`${name} · ${when}`}</Text>
                <Text style={[styles.status, problem && styles.statusProblem]}>{statusLine(item)}</Text>
                <Text style={styles.meta}>{`${item.opts.mode === "melody" ? "Hummed or sung" : item.opts.mode} · ${formatBytes(item.bytes)}`}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              {item.status === "done" ? (
                <Action label="Open" onPress={() => onOpen(item)} styles={styles} strong />
              ) : null}
              {item.status === "waiting" ? <Action label="Send now" onPress={() => onRetry(item)} styles={styles} strong /> : null}
              {problem ? <Action label="Try again" onPress={() => onRetry(item)} styles={styles} strong /> : null}
              {item.status !== "sending" && item.status !== "sent" ? (
                <Action label={item.status === "done" ? "Dismiss" : "Delete"} onPress={() => onDelete(item)} styles={styles} />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Action({ label, onPress, styles, strong }: { label: string; onPress: () => void; styles: ReturnType<typeof makeStyles>; strong?: boolean }) {
  return (
    <Touchable onPress={onPress} style={[styles.action, strong && styles.actionStrong]} radius={radii.pill} accessibilityLabel={label}>
      <Text style={[styles.actionLabel, strong && styles.actionLabelStrong]}>{label}</Text>
    </Touchable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { marginTop: spacing.lg, gap: spacing.sm },
    eyebrow: { fontFamily: fonts.medium, fontSize: 12, color: c.textFaint, textTransform: "uppercase", letterSpacing: 0.8 },
    card: {
      padding: spacing.md,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      gap: spacing.sm,
    },
    top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
    text: { flex: 1 },
    title: { fontFamily: fonts.medium, fontSize: 14, color: c.text },
    status: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    statusProblem: { color: c.warning },
    meta: { fontFamily: fonts.regular, fontSize: 11.5, color: c.textFaint, marginTop: 2 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
    action: {
      height: 34,
      paddingHorizontal: 14,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    actionStrong: { backgroundColor: c.accentSoft, borderColor: c.accentGlow },
    actionLabel: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    actionLabelStrong: { color: c.accent },
  });
