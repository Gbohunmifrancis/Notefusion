import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Application from "expo-application";
import * as WebBrowser from "expo-web-browser";
import { Button } from "../Button";
import { Sheet, SheetActions, SheetMessage, SheetTitle } from "../Sheet";
import { OptionRow } from "../SheetRows";
import { TextField } from "../TextField";
import { ProblemNote } from "../ProblemNote";
import { GoogleG } from "../night/GoogleG";
import { authApi, meApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import { tokenStore } from "../../lib/tokenStore";
import { useAuth } from "../../lib/auth";
import { useSubscription } from "../../lib/subscription";
import { deleteAccountPlayNote, playMemberState } from "../../lib/playBilling";
import { showToast } from "../../lib/toast";
import { siteUrls } from "../../lib/env";
import { fonts, spacing, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";

/**
 * The small sheets behind Settings' rows (board b-system/12a, 7b): Name and Password (one job each, in place of
 * Profile's old "Account Settings" modal), About, and Delete account, where the password (or Google) is the
 * confirmation, so there is no second dialog. Good news is a toast; a problem stays in the sheet, under the
 * field, in plain words.
 */

/** "Your name": one field, Save once it changed. */
export function NameSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, setUser } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [name, setName] = useState(user?.fullName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(user?.fullName ?? "");
      setError(null);
    }
  }, [visible, user?.fullName]);

  const trimmed = name.trim();

  async function save() {
    if (!user || !trimmed || trimmed === user.fullName) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await meApi.update(trimmed);
      setUser({ ...user, fullName: updated.fullName });
      onClose();
      showToast("Saved");
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} avoidKeyboard>
      <SheetTitle>Your name</SheetTitle>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        autoFocus
        maxLength={100}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        error={error ?? undefined}
      />
      <SheetActions style={styles.actions}>
        <Button label="Cancel" variant="text" onPress={onClose} />
        <Button
          label="Save"
          loading={busy}
          disabled={!trimmed || trimmed === user?.fullName}
          onPress={() => void save()}
        />
      </SheetActions>
    </Sheet>
  );
}

/** "Change your password": the current one (the server re-checks it) and the new one. */
export function PasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  /** The new password was left or submitted: only then is "too short" said, not from the first keystroke. */
  const [nextDone, setNextDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCurrent("");
      setNext("");
      setNextDone(false);
      setError(null);
    }
  }, [visible]);

  async function save() {
    setNextDone(true);
    if (!current || next.length < 8) return;
    setBusy(true);
    setError(null);
    try {
      // The server revoked every other session, ours included; the pair it returns is the live one.
      const pair = await authApi.changePassword(current, next);
      await tokenStore.save(pair.accessToken, pair.refreshToken);
      onClose();
      showToast("Password updated");
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} avoidKeyboard>
      <SheetTitle>Change your password</SheetTitle>
      <SheetMessage>You stay signed in here; other phones will ask for the new one.</SheetMessage>
      <TextField
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secure
        autoFocus
        autoComplete="current-password"
        textContentType="password"
      />
      <TextField
        label="New password"
        value={next}
        onChangeText={setNext}
        onBlur={() => setNextDone(true)}
        onSubmitEditing={() => void save()}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="At least 8 characters"
        error={error ?? (nextDone && next.length > 0 && next.length < 8 ? "At least 8 characters" : undefined)}
      />
      <SheetActions style={styles.actions}>
        <Button label="Cancel" variant="text" onPress={onClose} />
        <Button label="Update" loading={busy} disabled={!current || next.length < 8} onPress={() => void save()} />
      </SheetActions>
    </Sheet>
  );
}

/** The app's version, the legal pages and the piano's credit. */
export function AboutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle>About Notefusion</SheetTitle>
      <SheetMessage>
        Turns what you hum, sing or play into Tonic Solfa and staff notation, on your phone.
      </SheetMessage>
      <View style={styles.versionRow}>
        <Text style={styles.versionLabel}>Version</Text>
        {/* Read from the native manifest, not typed in: a stale number next to an update prompt misleads. */}
        <Text style={styles.versionValue}>
          {`${Application.nativeApplicationVersion ?? "—"} (build ${Application.nativeBuildVersion ?? "—"})`}
        </Text>
      </View>
      <OptionRow label="Privacy policy" icon="privacy" onPress={() => void WebBrowser.openBrowserAsync(siteUrls.privacy)} />
      <OptionRow label="Terms of service" icon="terms" onPress={() => void WebBrowser.openBrowserAsync(siteUrls.terms)} />
      {/* CC BY 3.0 asks for this credit wherever the recording is used. */}
      <Text style={styles.credit}>
        Piano sound: Salamander Grand Piano V3 by Alexander Holm, licensed under{" "}
        <Text
          style={styles.creditLink}
          onPress={() => void WebBrowser.openBrowserAsync("https://creativecommons.org/licenses/by/3.0/")}
          accessibilityRole="link"
        >
          CC BY 3.0
        </Text>
        . Converted to mono, resampled, trimmed and level-matched for NoteFusion.
      </Text>
      <SheetActions style={styles.actions}>
        <Button label="Done" variant="text" onPress={onClose} />
      </SheetActions>
    </Sheet>
  );
}

/**
 * Delete account (board 7b): one row, one sheet. The password is the confirmation (Google re-asks for a Google
 * account), so there is no second dialog; "Delete account" waits for something to be typed. A wrong password
 * shows under the field in plain words and the sheet stays open.
 */
export function DeleteAccountSheet({
  visible,
  onClose,
  hasPassword,
}: {
  visible: boolean;
  onClose: () => void;
  /** False for a Google-only account, which proves itself through Google instead. */
  hasPassword: boolean;
}) {
  const { signOut, reauthWithGoogle } = useAuth();
  const { subscription } = useSubscription();
  // A membership Google Play still bills keeps billing after the account is gone: said before, not found later.
  const playNote = subscription ? deleteAccountPlayNote(playMemberState(subscription)) : null;
  const styles = useThemedStyles(makeStyles);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPassword("");
      setError(null);
    }
  }, [visible]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      if (hasPassword) {
        await meApi.remove({ password });
      } else {
        // A cancelled Google prompt returns null: nothing happens, the account stands.
        const googleIdToken = await reauthWithGoogle();
        if (!googleIdToken) {
          setBusy(false);
          return;
        }
        await meApi.remove({ googleIdToken });
      }
      // The session is dead server-side; signing out swaps the navigator back to the welcome screens.
      await signOut();
    } catch (e) {
      const err = toApiError(e);
      setError(
        err.code === "AUTH_REAUTHENTICATION_REQUIRED"
          ? hasPassword
            ? "That password isn't right. Try again."
            : "Google couldn't confirm it's you. Try again."
          : err.message,
      );
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={busy ? undefined : onClose} avoidKeyboard>
      <SheetTitle>Delete your account?</SheetTitle>
      <SheetMessage>
        This removes your account and every transcription in your library. It can't be undone.
        {playNote ? ` ${playNote}` : ""}
      </SheetMessage>
      {hasPassword ? (
        <TextField
          label="Enter your password to confirm"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (error) setError(null);
          }}
          secure
          autoFocus
          autoComplete="current-password"
          textContentType="password"
          error={error ?? undefined}
        />
      ) : (
        <>
          <View style={styles.googleNote}>
            <GoogleG size={20} />
            <Text style={styles.googleText}>Google will ask you to confirm it's you.</Text>
          </View>
          {error ? <ProblemNote>{error}</ProblemNote> : null}
        </>
      )}
      <SheetActions style={styles.actions}>
        <Button label="Cancel" variant="text" onPress={onClose} disabled={busy} />
        <Button
          label="Delete account"
          variant="destructive"
          loading={busy}
          disabled={hasPassword && password.length === 0}
          onPress={() => void remove()}
        />
      </SheetActions>
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    actions: {
      marginTop: spacing.lg,
    },
    versionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 44,
    },
    versionLabel: {
      fontFamily: fonts.medium,
      fontSize: 16,
      color: c.text,
    },
    versionValue: {
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.textMuted,
    },
    credit: {
      fontFamily: fonts.regular,
      fontSize: 12.5,
      lineHeight: 18,
      color: c.textMuted,
      marginTop: spacing.md,
    },
    creditLink: {
      color: c.link,
    },
    googleNote: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: c.sheetTile,
    },
    googleText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.textMuted,
    },
  });
