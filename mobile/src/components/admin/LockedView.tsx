import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { AdminTopBar } from "./AdminChrome";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import { LOCKED_FOOTNOTE, lockedLine, type LockMethod } from "../../lib/adminLock";
import { unlockWithPassword, unlockWithPhone } from "../../lib/adminLockRuntime";

/**
 * Admin, locked (board f-admin/10): no figures, no bottom bar, no names. The phone's own prompt comes up by itself
 * once; cancelled, this plain page stays with Unlock (which brings the prompt back) and the way out. On a phone with
 * no screen lock it asks for the account password instead. Nothing admin is fetched until it opens.
 */
export function LockedView({ method, onBack }: { method: LockMethod | null; onBack: () => void }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);

  // The prompt rises by itself the first time, as the board's "back after 6 minutes" shows.
  useEffect(() => {
    if (!method || method === "password" || asked.current) return;
    asked.current = true;
    void unlockWithPhone();
  }, [method]);

  async function submit() {
    setBusy(true);
    setError(await unlockWithPassword(password));
    setBusy(false);
  }

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right", "bottom"]}>
      <AdminTopBar online={false} />
      <View style={s.body}>
        <View style={s.tile}>
          <Icon name="lock" size={26} color={a.text} />
        </View>
        <Text style={s.title} accessibilityRole="header">
          Admin is locked
        </Text>
        <Text style={s.line}>{lockedLine(method ?? "biometric")}</Text>

        {method === "password" ? (
          <View style={s.form}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Your NoteFusion password"
              placeholderTextColor={a.dim}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={s.input}
              onSubmitEditing={() => void submit()}
              accessibilityLabel="Password"
            />
            {error ? (
              <View style={s.error}>
                <Icon name="problem" size={16} color={a.warn} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}
            <Button label="Unlock" icon="lock" onPress={() => void submit()} loading={busy} disabled={!password} />
          </View>
        ) : (
          <Button label="Unlock" icon="fingerprint" onPress={() => void unlockWithPhone()} disabled={!method} style={s.unlock} />
        )}
        <Button label="Back to the app" variant="text" onPress={onBack} />
      </View>
      <Text style={s.foot}>{LOCKED_FOOTNOTE}</Text>
    </SafeAreaView>
  );
}

/** The blank cover while the app is not in front: what Recents shows of Admin. */
export function AwayCover() {
  const a = useAdminColors();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: a.bg }]} pointerEvents="none" />;
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: a.bg },
    body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 6 },
    tile: {
      width: 72,
      height: 72,
      borderRadius: 18,
      backgroundColor: a.sub,
      borderWidth: 1,
      borderColor: a.line,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 18,
    },
    title: { fontFamily: fonts.semibold, fontSize: 24, letterSpacing: -0.4, color: a.text },
    line: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: a.muted, textAlign: "center", marginTop: 6, marginBottom: 18 },
    unlock: { marginBottom: 6 },
    form: { alignSelf: "stretch", gap: 10, marginBottom: 6 },
    input: {
      minHeight: 50,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: a.line,
      backgroundColor: a.card,
      paddingHorizontal: 14,
      fontFamily: fonts.regular,
      fontSize: 16,
      color: a.text,
    },
    error: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.text },
    foot: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: a.faint, textAlign: "center", paddingHorizontal: 28, paddingBottom: 18 },
  });
