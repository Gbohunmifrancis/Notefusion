import React, { useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NightButton } from "../components/night/NightButton";
import { Touchable } from "../components/Touchable";
import { NightField } from "../components/night/NightField";
import { BackButton, Mark, NightScreen, nightText } from "../components/night/NightUI";
import { authApi } from "../api/endpoints";
import { night, nightFonts } from "../design/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "ForgotPassword">;

/**
 * A full screen rather than the old cramped modal, with the "sent" state on the
 * same page. The sent message is the same whether or not the address has an
 * account, so the screen cannot be used to find out who is registered.
 */
export function ForgotPasswordScreen({ navigation, route }: Props) {
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const canSend = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function send() {
    if (!canSend) return;
    setBusy(true);
    try {
      await authApi.forgotPassword(email.trim());
    } catch {
      // Same answer either way — see the comment on the component.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <NightScreen
      header={
        <>
          <BackButton onPress={() => navigation.goBack()} />
          <Mark height={26} />
          <View style={styles.side} />
        </>
      }
    >
      <Text style={[nightText.h1, styles.title]}>Reset your{"\n"}password</Text>
      <Text style={[nightText.lead, styles.lead]}>
        Enter the email you signed up with and we&apos;ll send a reset link.
      </Text>

      <View style={styles.form}>
        <NightField
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setSent(false);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={send}
        />
      </View>

      <NightButton
        label={sent ? "Send it again" : "Send reset link"}
        variant={sent ? "ghost" : "blue"}
        onPress={send}
        loading={busy}
        disabled={!canSend}
        style={styles.submit}
      />

      {sent && (
        <View style={styles.sent} accessibilityLiveRegion="polite">
          <View style={styles.sentHead}>
            <View style={styles.tick}>
              <Ionicons name="checkmark" size={15} color={night.bgDeep} />
            </View>
            <Text style={styles.sentTitle}>Check your inbox</Text>
          </View>
          <Text style={styles.sentBody}>If that address has an account, the link is on its way.</Text>
          <View style={styles.pills}>
            {/* iOS can open the Mail app's inbox directly; Android has no portable way to
                open "the inbox" without a native module, and mailto: would start a new
                message, which is not what anyone wants here. */}
            {Platform.OS === "ios" && (
              <Pill label="Open mail app" onPress={() => Linking.openURL("message://").catch(() => undefined)} />
            )}
            <Pill label="Back to sign in" onPress={() => navigation.navigate("Login")} />
          </View>
        </View>
      )}
    </NightScreen>
  );
}

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Touchable onPress={onPress} style={styles.pill} radius={999}>
      <Text style={styles.pillText}>{label}</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  side: { width: 40 },
  title: { marginTop: 26 },
  lead: { marginTop: 8 },
  form: { marginTop: 28 },
  submit: { marginTop: 22 },
  sent: {
    marginTop: 30,
    padding: 18,
    borderRadius: 22,
    backgroundColor: night.mintSoft,
    borderWidth: 1,
    borderColor: night.mintBorder,
  },
  sentHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  tick: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: night.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  sentTitle: { fontSize: 15, fontFamily: nightFonts.semibold, color: night.text },
  sentBody: { marginTop: 8, fontSize: 13.5, lineHeight: 20, fontFamily: nightFonts.regular, color: night.muted },
  pills: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
  pill: {
    height: 38,
    paddingHorizontal: 15,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: night.surface2,
    borderWidth: 1,
    borderColor: night.line,
  },
  pillText: { fontSize: 13.5, fontFamily: nightFonts.medium, color: night.text },
});
