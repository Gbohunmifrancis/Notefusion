import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Sheet, SheetActions, SheetMessage, SheetTitle } from "../Sheet";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import { toApiError } from "../../api/client";
import { CONFIRM_LINE } from "../../lib/adminLock";
import { confirmAgain, useAdminLock } from "../../lib/adminLockRuntime";

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** The red word, for a loss (Suspend, End access, Remove admin): the pill stays neutral. */
  destructive?: boolean;
  /** "Why (optional, for the audit log)" and its placeholder. */
  note?: { placeholder?: string };
  /**
   * Asks the phone's lock again after the sheet (Suspend, End subscription, Revoke Pro, Change role, a feature flag):
   * the fingerprint or face, or on a phone with no lock the account password, typed here.
   */
  secondAsk?: boolean;
  /** A line or block between the message and the note ("Right now: Normal · Christmas for admins"). */
  extra?: React.ReactNode;
  /** Runs the action; a throw keeps the sheet open with a plain sentence. */
  onConfirm: (note?: string) => Promise<void>;
}

/**
 * The one sheet pattern for an admin action (boards f-admin/04, 05, 07): the web console's own wording, its optional
 * "why" for the audit log, then, for the destructive ones, the phone's lock once more. Only then does the request
 * go, so a phone left unlocked on a desk cannot suspend anyone.
 */
export function ConfirmSheet({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const { method } = useAdminLock();
  const { height } = useWindowDimensions();
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<ConfirmRequest | null>(request);

  useEffect(() => {
    if (request) {
      setShown(request);
      setNote("");
      setPassword("");
      setError(null);
      setBusy(false);
    }
  }, [request]);

  const r = request ?? shown;
  const askPassword = Boolean(r?.secondAsk) && method === "password";

  async function go() {
    if (!r || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (r.secondAsk) {
        const refused = await confirmAgain(r.title.replace(/\?$/, ""), method ?? "biometric", password);
        if (refused !== null) {
          // Cancelled at the phone's prompt: the sheet stays, nothing was sent.
          if (refused) setError(refused);
          return;
        }
      }
      await r.onConfirm(note.trim() || undefined);
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    // The cap in points: inside the keyboard wrapper a "90%" can resolve against the wrapper (the sheet's own height),
    // which squeezed the scroll area and hid the buttons on the web build.
    <Sheet visible={request !== null} onClose={busy ? undefined : onClose} avoidKeyboard style={{ maxHeight: Math.round(height * 0.9) }}>
      {r ? (
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
          <SheetTitle>{r.title}</SheetTitle>
          <SheetMessage>{r.message}</SheetMessage>
          {r.extra}
          {r.note ? (
            <View style={s.field}>
              <Text style={s.label}>Why (optional, for the audit log)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={r.note.placeholder ?? "A few words"}
                placeholderTextColor={a.dim}
                style={s.input}
                maxLength={300}
                editable={!busy}
                accessibilityLabel="Why, optional"
              />
            </View>
          ) : null}
          {askPassword ? (
            <View style={s.field}>
              <Text style={s.label}>This phone has no screen lock. Your NoteFusion password confirms it.</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={a.dim}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={s.input}
                editable={!busy}
                accessibilityLabel="Password"
              />
            </View>
          ) : r.secondAsk ? (
            <View style={s.second}>
              <Icon name="fingerprint" size={22} color={a.brand} />
              <Text style={s.secondText}>{CONFIRM_LINE}</Text>
            </View>
          ) : null}
          {error ? (
            <View style={s.error}>
              <Icon name="problem" size={16} color={a.warn} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}
          <SheetActions style={s.actions}>
            <Button label="Cancel" variant="text" onPress={onClose} disabled={busy} />
            <Button
              label={r.confirmLabel}
              variant={r.destructive ? "destructive" : "primary"}
              onPress={() => void go()}
              loading={busy}
              disabled={askPassword && !password}
            />
          </SheetActions>
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    field: { marginBottom: 16 },
    label: { fontFamily: fonts.medium, fontSize: 13.5, color: a.muted, marginBottom: 8, lineHeight: 19 },
    input: {
      minHeight: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: a.line,
      backgroundColor: a.bg,
      paddingHorizontal: 14,
      fontFamily: fonts.regular,
      fontSize: 16,
      color: a.text,
    },
    second: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginBottom: 18 },
    secondText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.muted },
    error: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginBottom: 14 },
    errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.text },
    actions: { marginTop: 4 },
  });
