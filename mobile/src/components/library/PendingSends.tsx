import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import { showDialog } from "../../lib/dialog";
import { useColors, useThemedStyles } from "../../lib/theme";
import { fonts, radii, spacing, type Palette } from "../../design/theme";
import { recordedAt, statusLine, takeName, type QueuedSend } from "../../lib/sendQueue";

/**
 * "On its way" (board 13): every take still travelling, above the Library's sheets — sending (with its
 * progress), sent and being written, or waiting for a connection with its next try. Each moves on by itself and,
 * once its job is done, lands in the list below as a saved sheet. A waiting one taps for Send now or Delete;
 * nothing here needs the person unless the server refuses it, which keeps the audio with the server's plain
 * sentence and Try again / Delete.
 */
export function PendingSends({
  items,
  progress,
  onRetry,
  onDelete,
  onOpen,
}: {
  items: readonly QueuedSend[];
  /** The upload of each take being sent, 0..1 (`useSendProgress`). */
  progress: ReadonlyMap<string, number>;
  onRetry: (item: QueuedSend) => void;
  onDelete: (item: QueuedSend) => void;
  onOpen: (item: QueuedSend) => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  // "next try in 30 s" counts down while a take waits for a connection.
  const [now, setNow] = useState(Date.now());
  const counting = items.some((i) => i.status === "waiting" && i.attempts > 0 && !i.message);
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  if (items.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.heading}>On its way</Text>
        <Text style={styles.count}>{items.length}</Text>
      </View>
      {items.map((item, index) => {
        const name = `${takeName(item)} · ${recordedAt(item.createdAt)}`;
        const fraction = progress.get(item.id);
        const line = statusLine(item, now, fraction);
        const problem = item.status === "refused" || item.status === "failed";
        const waiting = item.status === "waiting" || item.status === "held";
        const icon: IconName = problem
          ? "problem"
          : item.status === "done"
            ? "done"
            : item.status === "sent"
              ? "waiting"
              : waiting && item.message
                ? "retry"
                : waiting && item.attempts > 0
                  ? "offline"
                  : "sending";
        const ask = () =>
          showDialog({
            title: name,
            message: line,
            actions: [
              { label: "Send now", onPress: () => onRetry(item) },
              { label: "Delete", style: "destructive", onPress: () => onDelete(item) },
              { label: "Cancel", style: "cancel" },
            ],
          });
        const a11y = `${name}. ${line}${waiting ? ". Send now or delete" : ""}`;
        const body = (
          <>
            <View style={styles.tile}>
              <Icon name={icon} size={20} color={problem ? colors.warning : colors.text} />
            </View>
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {name}
              </Text>
              <Text style={[styles.status, item.status === "sending" && styles.statusLive, problem && styles.statusProblem]}>
                {line}
              </Text>
              {item.status === "sending" ? (
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, (fraction ?? 0) * 100))}%` }]} />
                </View>
              ) : null}
            </View>
          </>
        );
        return (
          <View key={item.id} style={[styles.row, index > 0 && styles.rowDivided]}>
            {/* Only a waiting take taps (Send now or Delete); the others are drawn plain, never dimmed as disabled. */}
            {waiting ? (
              <Touchable onPress={ask} style={styles.top} radius={radii.md} accessibilityLabel={a11y}>
                {body}
              </Touchable>
            ) : (
              <View style={styles.top} accessible accessibilityLabel={a11y}>
                {body}
              </View>
            )}
            {problem || item.status === "done" ? (
              <View style={styles.actions}>
                {item.status === "done" ? <Action label="Open" onPress={() => onOpen(item)} styles={styles} strong /> : null}
                {problem ? <Action label="Try again" onPress={() => onRetry(item)} styles={styles} strong /> : null}
                <Action label={item.status === "done" ? "Dismiss" : "Delete"} onPress={() => onDelete(item)} styles={styles} />
              </View>
            ) : null}
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
    card: {
      marginTop: spacing.lg,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
    heading: { fontFamily: fonts.semibold, fontSize: 15, color: c.text },
    count: { fontFamily: fonts.medium, fontSize: 13, color: c.textFaint },
    row: { paddingVertical: spacing.sm, gap: spacing.sm },
    rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    top: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    tile: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    text: { flex: 1, minWidth: 0 },
    title: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    status: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 3 },
    statusLive: { color: c.link },
    statusProblem: { color: c.warningText },
    bar: { height: 3, borderRadius: radii.pill, backgroundColor: c.border, marginTop: 8, overflow: "hidden" },
    barFill: { height: "100%", borderRadius: radii.pill, backgroundColor: c.link },
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
