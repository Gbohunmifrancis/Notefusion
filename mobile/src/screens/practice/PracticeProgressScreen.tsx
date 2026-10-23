/**
 * "Your progress" (board s-practice-fun/s1), pushed from the Practice tab's top line (the streak, the level, the
 * week): the stat cards, this week and the badges, read fresh from the server on every visit.
 */

import React, { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { practiceApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import type { PracticeProgress } from "../../api/types";
import { Screen } from "../../components/Screen";
import { ModeHeader } from "../../components/practice/ModeHeader";
import { ProgressCards } from "../../components/practice/ProgressCards";
import { spacing, typography, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { ModeState } from "./shared";

export function PracticeProgressScreen() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [progress, setProgress] = useState<PracticeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setProgress(await practiceApi.progress());
      setError(null);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={styles.flex}>
      <Screen
        scroll
        contentStyle={styles.screen}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={c.accent}
            colors={[c.accent]}
          />
        }
      >
        <ModeHeader eyebrow="Practice" title="Your progress" />
        <ModeState loading={loading && !progress} error={progress ? null : error} onRetry={() => { setLoading(true); void load(); }} />
        {progress ? (
          <>
            <ProgressCards progress={progress} />
            <Text style={styles.foot}>
              Every marked take and every quick game that counts adds XP, up to {progress.dailyXpCap} a day.
            </Text>
          </>
        ) : null}
      </Screen>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    screen: { paddingBottom: spacing.xxl },
    foot: { ...typography.caption, color: c.textFaint, fontSize: 13, lineHeight: 18, marginTop: spacing.md },
  });
