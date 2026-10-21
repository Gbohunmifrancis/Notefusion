import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Linking, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import { useFocusEffect } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { BackButton, Group, GroupNote, PageTitle, Row } from "../components/settings/Rows";
import { ReminderTimeSheet } from "../components/settings/ReminderTimeSheet";
import {
  disablePush,
  enablePush,
  getPushPermission,
  loadNotificationPrefs,
  pushEnabled,
  setSoundEnabled,
  soundEnabled,
  type PushPermission,
} from "../lib/push";
import {
  loadReminderPrefs,
  refreshReminderPrefs,
  reminderEnabled,
  reminderHour,
  setReminderEnabled,
  setReminderHour,
  syncReminderSound,
} from "../lib/practiceReminder";
import { describeReminder, hourLabel, reminderMovedLine } from "../lib/reminderPrefs";
import { pushStatus, readyValue } from "../lib/pushStatus";
import { meApi } from "../api/endpoints";
import { showDialog } from "../lib/dialog";
import { showToast } from "../lib/toast";
import * as haptics from "../lib/haptics";
import { fonts, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";

/** How long the Reminder time row stays washed blue after a new hour is saved. */
const FLASH_MS = 600;

/**
 * Notifications (board b-system/12b, 12c): push on or off, then what it brings, then email. Every switch here is
 * something the phone or the server already keeps: push and sound on this phone (`lib/push`), the practice reminder
 * and its hour on the account (`PUT /api/practice/reminders`), and the founder's notes on the account
 * (`PUT /api/me/email-preferences`). "Transcription ready" has no switch of its own: it is what push is for.
 *
 * The phone's permission is said once, under the switches, with "Open settings" when the phone is what blocks it;
 * coming back from the phone's settings re-reads it (focus).
 */
export function NotificationsScreen() {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [pushOn, setPushOn] = useState(pushEnabled());
  const [soundOn, setSoundOn] = useState(soundEnabled());
  const [pushBusy, setPushBusy] = useState(false);
  const [reminderOn, setReminderOn] = useState(reminderEnabled());
  const [hour, setHour] = useState(reminderHour());
  const [picking, setPicking] = useState(false);
  const [founderNotes, setFounderNotes] = useState<boolean | null>(null);
  const flash = useRef(new Animated.Value(0)).current;

  const sync = useCallback(async () => {
    const [, perm] = await Promise.all([loadNotificationPrefs(), getPushPermission(), loadReminderPrefs()]);
    setPermission(perm);
    setPushOn(pushEnabled());
    setSoundOn(soundEnabled());
    setReminderOn(reminderEnabled());
    setHour(reminderHour());
    // The reminders are the server's: the cached answer paints at once, the fresh one replaces it.
    if (await refreshReminderPrefs()) {
      setReminderOn(reminderEnabled());
      setHour(reminderHour());
    }
  }, []);

  // The permission can change in the phone's settings while we are away: re-read it on every return.
  useFocusEffect(
    useCallback(() => {
      void sync();
    }, [sync]),
  );

  useEffect(() => {
    meApi
      .emailPreferences()
      .then((p) => setFounderNotes(p.founderNotes))
      .catch(() => undefined);
  }, []);

  const status = pushStatus(permission, pushOn);

  /** The server keeps the reminders, so a choice it did not take is put back and said plainly. */
  function notSaved() {
    showDialog({
      title: "Couldn't save that",
      message: "Check your connection and try again.",
      icon: "offline",
    });
  }

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      if (on) {
        const result = await enablePush();
        setPermission(result);
        // Only the granted path turns anything on; otherwise the line under the switch says why.
        setPushOn(result === "granted" && pushEnabled());
      } else {
        await disablePush();
        setPushOn(false);
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function toggleSound(on: boolean) {
    setSoundOn(on);
    await setSoundEnabled(on);
    // Practice reminders are pushed by the server, so it is told too: off sends them silently.
    void syncReminderSound(on);
  }

  async function toggleReminder(on: boolean) {
    setReminderOn(on);
    if (!(await setReminderEnabled(on))) {
      setReminderOn(!on);
      notSaved();
    }
  }

  async function pickHour(next: number) {
    setPicking(false);
    if (next === hour) return;
    const before = hour;
    setHour(next);
    haptics.play("light");
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: FLASH_MS, delay: 200, useNativeDriver: true }).start();
    if (await setReminderHour(next)) {
      showToast(reminderMovedLine(next));
    } else {
      setHour(before);
      notSaved();
    }
  }

  async function toggleFounderNotes(on: boolean) {
    const before = founderNotes;
    setFounderNotes(on);
    try {
      const saved = await meApi.setEmailPreferences({ founderNotes: on });
      setFounderNotes(saved.founderNotes);
    } catch {
      setFounderNotes(before);
      notSaved();
    }
  }

  const live = status.live;

  return (
    <Screen scroll contentStyle={styles.screen}>
      <BackButton />
      <PageTitle>Notifications</PageTitle>

      <Group style={styles.first}>
        <Row
          icon={status.on ? "bell" : "bell-off"}
          label="Push notifications"
          trailing={pushBusy ? <ActivityIndicator color={c.link} /> : undefined}
          toggle={
            pushBusy
              ? undefined
              : { value: status.on, onChange: (on) => void togglePush(on), disabled: !status.switchable }
          }
        />
        <Row
          icon={soundOn ? "sound" : "mute"}
          label="Sound"
          dim={!live}
          toggle={{ value: soundOn, onChange: (on) => void toggleSound(on), disabled: !live }}
        />
      </Group>

      {/* The phone's answer, said once, with the way out when the phone is what is in the way. */}
      <View style={styles.state} accessibilityLiveRegion="polite">
        {status.tone === "ok" ? (
          <Icon name="done" size={16} color={c.success} />
        ) : status.tone === "warn" ? (
          <Icon name="problem" size={16} color={c.warning} />
        ) : null}
        <Text style={styles.stateText}>{status.line}</Text>
        {status.openSettings ? (
          <Button label="Open settings" variant="text" size="sm" onPress={() => void Linking.openSettings()} />
        ) : null}
      </View>

      <Group title="What you get">
        <Row
          icon="transcribe"
          label="Transcription ready"
          hint="Even if you have left the app"
          value={readyValue(status)}
          dim={!live}
        />
        <Row
          icon="alarm"
          label="Practice reminder"
          hint={describeReminder(reminderOn, live)}
          dim={!live}
          toggle={{ value: live && reminderOn, onChange: (on) => void toggleReminder(on), disabled: !live }}
        />
        <Row
          icon="clock"
          label="Reminder time"
          value={hourLabel(hour)}
          chevron
          flash={flash}
          dim={!live || !reminderOn}
          onPress={live && reminderOn ? () => setPicking(true) : undefined}
          accessibilityLabel={`Reminder time, ${hourLabel(hour)}. Change it`}
        />
      </Group>
      {/* The server's own rules (C# PracticeReminderRules), so nobody is surprised by a second nudge. */}
      <GroupNote>
        At most two a day, never 10pm–8am. A streak of 3+ days about to end gets one last nudge at 9:30pm.
      </GroupNote>

      <Group title="Email">
        <Row
          icon="mail"
          label="Notes and offers from NoteFusion"
          hint="Now and then: how it's going, and the odd seasonal offer"
          toggle={
            founderNotes === null
              ? undefined
              : { value: founderNotes, onChange: (on) => void toggleFounderNotes(on) }
          }
          trailing={founderNotes === null ? <ActivityIndicator color={c.textFaint} /> : undefined}
        />
      </Group>
      <GroupNote>Receipts and sign-in codes always come.</GroupNote>

      <ReminderTimeSheet
        visible={picking}
        hour={hour}
        onPick={(h) => void pickHour(h)}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {
      paddingTop: spacing.xs,
      paddingBottom: spacing.xxxl,
    },
    first: {
      marginTop: 20,
    },
    state: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 32,
      marginTop: 10,
      marginLeft: 8,
      // The text button's own padding: its word lines up with the cards' right edge.
      marginRight: -8,
    },
    stateText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      lineHeight: 18,
      color: c.textMuted,
    },
  });
