/**
 * The small round chat button at the bottom right of Home, and only Home: the record button owns the middle of the tab
 * bar and Hymns' right edge is its letter rail, so one quiet way in is enough (Profile and Help also say "Chat with
 * us"). A dot shows when support has answered and this phone has not shown it yet (`lib/supportSeen`); the thread is
 * read at most every two minutes for that.
 */
import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { supportApi } from "../api/endpoints";
import { spacing, type Palette } from "../design/theme";
import { hasUnreadAnswer, supportSeenAt } from "../lib/supportSeen";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";
import { Icon } from "./Icon";
import { Touchable } from "./Touchable";

const SIZE = 48;
const RECHECK_MS = 2 * 60_000;
let lastCheck = { at: 0, unread: false };

export function SupportBubble() {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [unread, setUnread] = useState(lastCheck.unread);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      if (Date.now() - lastCheck.at < RECHECK_MS) {
        setUnread(lastCheck.unread);
        return;
      }
      void (async () => {
        try {
          const [thread, seenAt] = await Promise.all([supportApi.thread(), supportSeenAt()]);
          lastCheck = { at: Date.now(), unread: hasUnreadAnswer(thread.messages, seenAt) };
          if (live) setUnread(lastCheck.unread);
        } catch {
          // No dot this time.
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  return (
    <View style={styles.anchor} pointerEvents="box-none">
      <Touchable
        onPress={() => {
          lastCheck = { at: Date.now(), unread: false };
          setUnread(false);
          navigation.navigate("SupportChat");
        }}
        radius={SIZE / 2}
        accessibilityLabel={unread ? "Chat with us: support has answered" : "Chat with us"}
        style={styles.button}
      >
        <Icon name="chat" size={22} color="#fff" />
        {unread ? <View style={styles.dot} /> : null}
      </Touchable>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    anchor: { position: "absolute", right: spacing.lg, bottom: spacing.lg },
    button: {
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    dot: {
      position: "absolute",
      top: 4,
      right: 4,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: c.warning,
      borderWidth: 2,
      borderColor: c.bg,
    },
  });
