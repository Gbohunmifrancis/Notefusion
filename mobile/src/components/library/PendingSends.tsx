import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import { showDialog } from "../../lib/dialog";
import { useDataSaver } from "../../lib/dataSaver";
import type { LinkJobRow } from "../../lib/linkJob";
import { useColors, useThemedStyles } from "../../lib/theme";
import { fonts, radii, spacing, type Palette } from "../../design/theme";
import { recordedAt, statusLine, takeName, type QueuedSend } from "../../lib/sendQueue";

/**
 * "On its way" (board 13): every take still travelling, above the Library's sheets — sending (with its
 * progress), sent and being written, or waiting for a connection with its next try. Each moves on by itself and,
 * once its job is done, lands in the list below as a saved sheet. A waiting one taps for Send now or Delete;
 * nothing here needs the person unless the server refuses it, which keeps the audio with the server's plain
 * sentence and Try again / Delete.
 *
 * A song sent from Song link is listed first while it is written (board m-ux-medium P2e): its title and artist, the
 * stage in the job's own words with the bar, then "Ready — tap to open" and Open. It is not a take, so there is
 * nothing to resend or delete; Dismiss lets it go.
 */
export function PendingSends({
  items,
  progress,
  onRetry,
  onDelete,
  onOpen,
  song = null,
  onOpenSong,
  onDismissSong,
}: {
  items: readonly QueuedSend[];
  /** The upload of each take being sent, 0..1 (`useSendProgress`). */
  progress: ReadonlyMap<string, number>;
  onRetry: (item: QueuedSend) => void;
  onDelete: (item: QueuedSend) => void;
  onOpen: (item: QueuedSend) => void;
  /** The song sent from Song link, while it is written (`useSongOnItsWay`). */
  song?: LinkJobRow | null;
  onOpenSong?: () => void;
  onDismissSong?: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  // Data saver hides artwork: the tile is a link sign then.
  const dataSaver = useDataSaver();

  // "next try in 30 s" counts down while a take waits for a connection.
  const [now, setNow] = useState(Date.now());
  const counting = items.some((i) => i.status === "waiting" && i.attempts > 0 && !i.message);
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  if (items.length === 0 && !song) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.heading} accessibilityRole="header">
          On its way
        </Text>
        <Text style={styles.count}>{items.length + (song ? 1 : 0)}</Text>
      </View>
      {song ? (
        <View style={styles.row}>
          <View style={styles.top} accessible accessibilityLabel={`${song.title}. ${song.line}`}>
            <View style={styles.tile}>
              {song.thumbnailUrl && !dataSaver && song.state === "running" ? (
                <Image source={{ uri: song.thumbnailUrl }} style={styles.thumb} />
              ) : (
                <Icon
                  name={song.state === "done" ? "done" : song.state === "failed" ? "problem" : "link"}
                  size={20}
                  color={song.state === "failed" ? colors.warning : colors.text}
                />
              )}
            </View>
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {song.title}
              </Text>
              <Text
                style={[styles.status, song.state === "running" && styles.statusLive, song.state === "failed" && styles.statusProblem]}
              >
                {song.line}
              </Text>
              {song.state === "running" ? (
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.max(2, song.progress * 100)}%` }]} />
                </View>
              ) : null}
            </View>
          </View>
          {song.state !== "running" ? (
            <View style={styles.actions}>
              {song.state === "done" && onOpenSong ? <Action label="Open" onPress={onOpenSong} styles={styles} strong /> : null}
              {onDismissSong ? <Action label="Dismiss" onPress={onDismissSong} styles={styles} /> : null}
            </View>
          ) : null}
        </View>
      ) : null}
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
          <View key={item.id} style={[styles.row, (index > 0 || song) && styles.rowDivided]}>
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
    // 44 px pills 8 apart, a thumb's size without leaning on slop (board m-ux-medium P2d's rule).
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
      overflow: "hidden",
    },
    /** The song's artwork fills its tile (with Data saver off). */
    thumb: { width: "100%", height: "100%" },
    text: { flex: 1, minWidth: 0 },
    title: { fontFamily: fonts.medium, fontSize: 15, color: c.text },
    status: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 3 },
    statusLive: { color: c.link },
    statusProblem: { color: c.warningText },
    bar: { height: 3, borderRadius: radii.pill, backgroundColor: c.border, marginTop: 8, overflow: "hidden" },
    barFill: { height: "100%", borderRadius: radii.pill, backgroundColor: c.link },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
    action: {
      height: 44,
      paddingHorizontal: 14,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    actionStrong: { backgroundColor: c.accentSoft, borderColor: c.accentGlow },
    actionLabel: { fontFamily: fonts.medium, fontSize: 13, color: c.textMuted },
    // Words on the blue tint take the notice blue: `accent` there was 4.07:1 in Day.
    actionLabelStrong: { color: c.noticeText },
  });
