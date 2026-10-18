/**
 * One saved sheet's actions, from Home's recent rows (board a-core/11): the sheet by its doh, name and "72 BPM · 4/4 ·
 * saved Sunday", then grouped rows — Share a link · Share with the choir (only in one) | Rename · Move to folder ·
 * Keep offline | Delete, last and apart, a red word. Edit notes, Transpose and Export need the sheet open, so they stay
 * on the Result screen. Presentational: `useSheetActions` owns what each row does.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { Sheet } from "../Sheet";
import { Group, Row } from "../settings/Rows";
import { dohLetter } from "../../lib/solfa";
import { sheetMetaLine } from "../../lib/sheetMeta";
import { fonts, radii, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import type { SavedTranscription } from "../../api/types";

export interface SheetActionHandlers {
  onShareLink: () => void;
  onChoir: () => void;
  onRename: () => void;
  onMove: () => void;
  onKeepOffline: (keep: boolean) => void;
  onDelete: () => void;
}

export function SheetActionsSheet({
  sheet,
  onClose,
  onClosed,
  choirName,
  kept,
  keepAll,
  handlers,
}: {
  /** The sheet acted on; null closes the sheet. */
  sheet: SavedTranscription | null;
  onClose: () => void;
  /** The sheet has left the screen: what a row asked for runs then (a second sheet, the share sheet). */
  onClosed: () => void;
  /** The choir this account is in while its plan runs. */
  choirName: string | null;
  /** This sheet is kept on the phone. */
  kept: boolean;
  /** Every sheet is kept (Settings): the switch is on and fixed. */
  keepAll: boolean;
  handlers: SheetActionHandlers;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  // Kept through the exit, so the sheet leaves looking like itself.
  const last = React.useRef(sheet);
  if (sheet) last.current = sheet;
  const s = sheet ?? last.current;

  return (
    <Sheet visible={sheet !== null} onClose={onClose} onClosed={onClosed}>
      {s ? (
        <>
          <View style={styles.head}>
            <View style={styles.dohTile}>
              <Text style={styles.dohLetter} numberOfLines={1}>
                {dohLetter(s.key)}
              </Text>
              <Text style={styles.dohCaption}>DOH</Text>
            </View>
            <View style={styles.headText}>
              <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
                {s.title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {sheetMetaLine(s, new Date())}
              </Text>
            </View>
          </View>

          <Group cardStyle={styles.group}>
            <Row icon="link" label="Share a link" onPress={handlers.onShareLink} />
            {choirName ? (
              <Row
                icon="choir"
                choir
                label={s.sharedWithChoir ? "Take out of choir library" : `Share with ${choirName}`}
                onPress={handlers.onChoir}
              />
            ) : null}
          </Group>

          <Group cardStyle={styles.group} style={styles.gap}>
            <Row icon="rename" label="Rename" onPress={handlers.onRename} />
            <Row icon="folder" label="Move to folder" value={s.folder ?? undefined} chevron onPress={handlers.onMove} />
            <Row
              icon="keep-offline"
              label="Keep offline"
              hint={keepAll ? "Every sheet is kept (Settings)" : undefined}
              toggle={{ value: keepAll || kept, onChange: handlers.onKeepOffline, disabled: keepAll }}
            />
          </Group>

          <Group cardStyle={styles.group} style={styles.gap}>
            <Row
              iconNode={<Icon name="delete" size={18} color={c.textMuted} />}
              label="Delete"
              destructive
              onPress={handlers.onDelete}
            />
          </Group>
        </>
      ) : null}
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginBottom: 16,
    },
    dohTile: {
      width: 44,
      height: 48,
      borderRadius: radii.md,
      backgroundColor: c.sheetTile,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    dohLetter: {
      fontFamily: typography.mono.fontFamily,
      fontSize: 16,
      color: c.text,
    },
    dohCaption: {
      fontSize: 8.5,
      fontFamily: fonts.medium,
      letterSpacing: 1,
      color: c.textMuted,
      marginTop: 2,
    },
    headText: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 19,
      lineHeight: 25,
      letterSpacing: -0.2,
      color: c.text,
    },
    meta: {
      fontFamily: fonts.regular,
      fontSize: 14,
      color: c.textMuted,
      marginTop: 2,
    },
    group: {
      backgroundColor: c.sheetRow,
    },
    gap: {
      marginTop: 12,
    },
  });
