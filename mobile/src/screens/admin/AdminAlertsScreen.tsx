import React, { useEffect, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Application from "expo-application";
import { AdminBackBar, AdminPage, PageTitle } from "../../components/admin/AdminChrome";
import { ActionGroup, ActionRow, GroupLabel, LinkText, WarnNote } from "../../components/admin/AdminUI";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import type { PaymentAlertSettings } from "../../api/types";
import { showDialog } from "../../lib/dialog";
import { withBusy } from "../../lib/busy";
import { showToast } from "../../lib/toast";
import { getPushPermission } from "../../lib/push";
import {
  DEFAULT_PAYMENT_ALERTS,
  PAYMENT_CHANNEL_VERSION,
  QUIET_HOURS_LABEL,
  channelFor,
  mutedLine,
  type PaymentAlertPrefs,
  type PaymentAlertSound,
} from "../../lib/paymentAlerts";
import { loadPaymentAlertPrefs, mutePaymentAlerts, pushToken, savePaymentAlerts } from "../../lib/paymentAlertsRuntime";
import { fonts, motion, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";

const CHIME = require("../../../assets/sounds/payment.wav");
const CHIME_MS = 1800;

const SOUNDS: { value: PaymentAlertSound; label: string; hint?: string }[] = [
  { value: "chime", label: "NoteFusion cash chime", hint: "Loud, about a second. Ours alone." },
  { value: "phone", label: "The phone's notification sound" },
  { value: "none", label: "No sound", hint: "The banner and the vibration only" },
];

/**
 * More › Payment alerts, on this phone only (board f-admin/09): the switch, the sound (tap a row to choose it; the
 * chime plays as you tap), the vibration, quiet hours by this phone's clock, names left out for a phone others see,
 * the payment-problem alerts the console already sends, a test alert, and Android's own page for the channel. Each
 * choice is an Android channel of its own, which the server picks for this phone.
 */
export function AdminAlertsScreen() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const nav = useNavigation();
  const [prefs, setPrefs] = useState<PaymentAlertPrefs>(DEFAULT_PAYMENT_ALERTS);
  const [server, setServer] = useState<PaymentAlertSettings | null>(null);
  const [push, setPush] = useState<"on" | "off" | "checking">("checking");
  const [playing, setPlaying] = useState(false);
  const [testing, setTesting] = useState(false);
  const player = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [stored, permission, token] = await Promise.all([loadPaymentAlertPrefs(), getPushPermission(), pushToken()]);
      if (!live) return;
      setPrefs(stored);
      setPush(permission === "granted" && token ? "on" : "off");
      if (token) {
        const settings = await adminApi.alertSettings(token).catch(() => null);
        if (live && settings) setServer(settings);
      }
    })();
    return () => {
      live = false;
      player.current?.remove();
    };
  }, []);

  async function change(next: Partial<PaymentAlertPrefs>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    const result = await savePaymentAlerts(merged);
    if (result.kind === "saved") setServer(result.settings);
    else if (result.kind === "failed")
      showDialog({ title: "That didn't save on the server", message: result.message, icon: "problem", tone: "danger" });
  }

  function play() {
    if (playing) {
      player.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      player.current?.remove();
      const p = createAudioPlayer(CHIME);
      player.current = p;
      p.play();
      setPlaying(true);
      // The chime is 1.65 s: the bars move while it plays.
      setTimeout(() => {
        if (player.current === p) setPlaying(false);
      }, CHIME_MS);
    } catch {
      setPlaying(false);
    }
  }

  async function test() {
    setTesting(true);
    const token = await pushToken();
    if (!token) {
      // Used to return here without a word, which read as a button that does nothing.
      const permission = await getPushPermission();
      setTesting(false);
      setPush("off");
      showDialog({
        title: "This phone can't get notifications yet",
        message:
          permission === "denied"
            ? "Notifications are blocked for NoteFusion. Allow them in the phone's settings, then try again."
            : permission === "granted"
              ? "Notifications are allowed, but Expo gave this phone no push address. Check the connection and try again."
              : "Turn notifications on in Profile, Notifications, then try again.",
        icon: "problem",
        tone: "danger",
        ...(permission === "denied"
          ? {
              actions: [
                { label: "Not now", style: "cancel" as const },
                { label: "Open settings", onPress: () => void Linking.openSettings() },
              ],
            }
          : {}),
      });
      return;
    }
    try {
      const result = await adminApi.testAlert(token);
      // Confirmed: Google (or Apple) took it, not only Expo.
      showToast(result.confirmed ? "Google has it. It should ring now." : "Test alert sent. It should ring in a moment.", {
        icon: "send",
      });
    } catch (e) {
      showDialog({ title: "Couldn't send a test alert", message: toApiError(e).message, icon: "problem", tone: "danger" });
    } finally {
      setTesting(false);
    }
  }

  function androidSettings() {
    const pkg = Application.applicationId ?? "com.notefusion.com";
    void Linking.sendIntent("android.settings.CHANNEL_NOTIFICATION_SETTINGS", [
      { key: "android.provider.extra.APP_PACKAGE", value: pkg },
      { key: "android.provider.extra.CHANNEL_ID", value: channelFor(prefs.sound, prefs.vibrate, PAYMENT_CHANNEL_VERSION) },
    ]).catch(() => Linking.openSettings());
  }

  const off = push !== "on";
  const muted = mutedLine(server?.mutedUntilUtc, new Date());

  return (
    <AdminPage header={<AdminBackBar label="More" onBack={() => nav.goBack()} />}>
      <PageTitle title="Payment alerts" sub="On this phone only. Other admins choose for theirs." />

      {push === "off" ? (
        <WarnNote style={s.gap14}>Notifications are off on this phone. Turn them on in Profile, Notifications, and payment alerts start here.</WarnNote>
      ) : null}

      <ActionGroup style={s.gap14}>
        <ActionRow
          icon="bell"
          label="Alert me when someone pays"
          toggle={{ value: prefs.on, onChange: (on) => void change({ on }), disabled: off }}
        />
      </ActionGroup>

      {muted ? (
        <View style={s.muted}>
          <Icon name="mute" size={16} color={a.muted} />
          <Text style={s.mutedText}>{muted}</Text>
          <LinkText
            label="Unmute"
            onPress={() => void withBusy("Unmuting…", () => mutePaymentAlerts(0)).then((st) => st && setServer(st))}
          />
        </View>
      ) : null}

      <GroupLabel>Sound</GroupLabel>
      <View style={[s.group, (!prefs.on || off) && s.dim]}>
        {SOUNDS.map((o, i) => {
          const chosen = prefs.sound === o.value;
          return (
            <View key={o.value}>
              {i > 0 ? <View style={s.rule} /> : null}
              <Touchable
                onPress={() => void change({ sound: o.value })}
                disabled={!prefs.on || off}
                scaleTo={motion.scale.row}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={o.label}
              >
                <View style={[s.sound, chosen && { backgroundColor: a.selected }]}>
                  <View style={s.tick}>{chosen ? <Icon name="check" size={18} color={a.brand} /> : null}</View>
                  <View style={s.flex}>
                    <Text style={s.soundLabel}>{o.label}</Text>
                    {o.hint ? <Text style={s.soundHint}>{o.hint}</Text> : null}
                  </View>
                  {o.value === "chime" ? (
                    <>
                      {playing ? <Icon name="playing" size={20} color={a.brand} /> : null}
                      <Touchable onPress={play} accessibilityLabel={playing ? "Stop the chime" : "Play the chime"} ripple={false}>
                        <View style={s.play}>
                          <Icon name={playing ? "pause" : "play"} size={16} color={a.text} />
                        </View>
                      </Touchable>
                    </>
                  ) : null}
                </View>
              </Touchable>
            </View>
          );
        })}
      </View>

      <ActionGroup style={[s.gap14, (!prefs.on || off) && s.dim]}>
        <ActionRow
          icon="haptics"
          label="Vibrate"
          hint="Two short pulses, unlike any other app"
          toggle={{ value: prefs.vibrate, onChange: (vibrate) => void change({ vibrate }), disabled: !prefs.on || off }}
        />
        <ActionRow
          icon="clock"
          label="Quiet at night"
          hint={QUIET_HOURS_LABEL}
          toggle={{ value: prefs.quietAtNight, onChange: (quietAtNight) => void change({ quietAtNight }), disabled: !prefs.on || off }}
        />
        <ActionRow
          icon="eye-off"
          label="Leave names out"
          hint="Amount and plan only; who paid is in Admin"
          toggle={{ value: prefs.hideNames, onChange: (hideNames) => void change({ hideNames }), disabled: !prefs.on || off }}
        />
        <ActionRow
          icon="problem"
          label="Payment problems too"
          hint="Paid with no Pro, stuck checkouts"
          toggle={{ value: prefs.problems, onChange: (problems) => void change({ problems }), disabled: off }}
        />
      </ActionGroup>

      <View style={s.actions}>
        <Button label="Send a test alert" icon="send" variant="secondary" onPress={() => void test()} loading={testing} disabled={off || !prefs.on} />
        {Platform.OS === "android" ? (
          <Touchable onPress={androidSettings} accessibilityLabel="Android settings for payment alerts" ripple={false}>
            <View style={s.android}>
              <Text style={s.androidText}>Android settings</Text>
              <Icon name="external" size={15} color={a.brand} />
            </View>
          </Touchable>
        ) : null}
      </View>
      <Text style={s.foot}>
        Only you can let these ring through Do Not Disturb: Android settings, Payments, Override Do Not Disturb.
      </Text>
    </AdminPage>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    dim: { opacity: 0.45 },
    gap14: { marginTop: 14 },
    group: { backgroundColor: a.card, borderWidth: 1, borderColor: a.line, borderRadius: 12, overflow: "hidden" },
    rule: { height: 1, backgroundColor: a.line, marginLeft: 46 },
    sound: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 60, paddingHorizontal: 12, paddingVertical: 10 },
    tick: { width: 24, alignItems: "center" },
    soundLabel: { fontFamily: fonts.medium, fontSize: 15, color: a.text },
    soundHint: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 2 },
    play: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: a.line, alignItems: "center", justifyContent: "center" },
    muted: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, paddingHorizontal: 4 },
    mutedText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: a.muted },
    actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, gap: 12 },
    android: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44 },
    androidText: { fontFamily: fonts.medium, fontSize: 14, color: a.brand },
    foot: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: a.faint, marginTop: 14, paddingHorizontal: 2 },
  });
