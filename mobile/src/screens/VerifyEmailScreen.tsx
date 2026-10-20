import React, { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "../components/Icon";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NightButton } from "../components/night/NightButton";
import { BackButton, ErrorNote, Glow, NightScreen, nightText, pressedLink } from "../components/night/NightUI";
import { useAuth } from "../lib/auth";
import { authApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { pendingVerifyStore } from "../lib/pendingVerifyStore";
import { night, nightFonts } from "../design/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "VerifyEmail">;

const CODE_LENGTH = 6;

/** Matches `User.EmailVerificationResendCooldown` on the server, in seconds. */
const RESEND_COOLDOWN = 60;

/** Where someone whose code never comes can write (the address the website and receipts give). */
const HELP_EMAIL = "hello@notefusion.studio";

/**
 * The six-digit code that finishes sign-up. Reached from Register, and from a Login
 * that was refused as unverified — both of which have just caused a code to be sent,
 * which is why the countdown starts at the full cooldown rather than at zero.
 *
 * The boxes are display only: one real TextInput sits transparently on top of them.
 * Six separate `maxLength={1}` inputs is the obvious build and the wrong one — Android
 * clips a pasted six-digit code to its first character, so pasting from the mail app,
 * the thing people actually do, would silently lose five digits.
 */
export function VerifyEmailScreen({ navigation, route }: Props) {
  const { email, fromSignUp } = route.params;
  const { verifyEmail } = useAuth();
  const inputRef = useRef<TextInput>(null);

  // Kept while this screen is open, so a phone that closes the app while the code is fetched from the mail reopens
  // here (lib/pendingVerify). Leaving — verified, Back or Change email — unmounts it and forgets the code.
  const sentAt = useRef(route.params.sentAt);
  useEffect(() => {
    pendingVerifyStore.save({ email, fromSignUp, sentAt: sentAt.current });
    return () => pendingVerifyStore.clear();
  }, [email, fromSignUp]);

  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN);

  // Keyed on "is it counting", not on the value: depending on secondsLeft would tear the
  // interval down and rebuild it on every tick, and each rebuild adds a little drift.
  const counting = secondsLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  // Auto-submit on the sixth digit: the button stays for a retry after a failure, but
  // nobody should have to reach for it once the code is complete.
  useEffect(() => {
    if (code.length === CODE_LENGTH) void submit(code);
  }, [code]);

  async function submit(entered: string) {
    // The only guard against a double submit — the input is left editable on purpose, so
    // that the refocus below can actually reopen the keypad on Android.
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      // On success the session lands and RootNavigator swaps to the app stack, so there
      // is nothing to navigate to from here.
      await verifyEmail(email, entered);
    } catch (e) {
      setError(toApiError(e).message);
      // Clear rather than leave the rejected digits sitting there: it makes the next
      // attempt a fresh typing action, and stops the effect above resubmitting them.
      setCode("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setResending(true);
    try {
      await authApi.resendVerification(email);
    } catch (e) {
      setError(toApiError(e).message);
      return;
    } finally {
      setResending(false);
    }
    // The server reports success whether or not it actually sent — it refuses to say
    // whether the address is registered — so the countdown is the only honest feedback
    // we can give, and it restarts either way.
    setResent(true);
    setSecondsLeft(RESEND_COOLDOWN);
    sentAt.current = Date.now();
    pendingVerifyStore.save({ email, fromSignUp, sentAt: sentAt.current });
  }

  /**
   * Back to where the address was typed. Reopened at start (the app had closed), nothing is behind this screen, so
   * Welcome and the form it came from are put back, the address filled in.
   */
  function changeEmail() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.reset({
      index: 1,
      routes: [{ name: "Welcome" }, fromSignUp ? { name: "Register", params: { email } } : { name: "Login", params: { email } }],
    });
  }

  const activeIndex = Math.min(code.length, CODE_LENGTH - 1);
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <NightScreen
      glow={<Glow y={0.18} radius={260} opacity={0.2} />}
      header={
        <>
          <BackButton onPress={changeEmail} />
          {fromSignUp ? <Text style={nightText.step}>2 of 2</Text> : <View />}
          <View style={styles.side} />
        </>
      }
    >
      <View style={styles.icon}>
        <Icon name="mail" size={28} color={night.ice} />
      </View>
      <Text style={[nightText.h1, styles.title]}>Check your email</Text>
      <Text style={[nightText.lead, styles.lead]}>
        We sent a {CODE_LENGTH}-digit code to{"\n"}
        {/* Shown exactly as the server stored it, so a typo in the address is visible
            here instead of looking like a mail that never arrived. */}
        <Text style={styles.email}>{email}</Text>
      </Text>

      <View style={styles.cells}>
        {Array.from({ length: CODE_LENGTH }).map((_, i) => {
          const active = focused && i === activeIndex && code.length < CODE_LENGTH;
          return (
            <View key={i} style={[styles.cell, active && styles.cellActive]}>
              {active && <View pointerEvents="none" style={styles.cellRing} />}
              <Text style={styles.cellText}>{code[i] ?? ""}</Text>
              {active && !code[i] && <View style={styles.caret} />}
            </View>
          );
        })}

        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={code}
          onChangeText={(t) => {
            setError(null);
            setCode(t.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH));
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          autoFocus
          caretHidden
          accessibilityLabel="Verification code"
        />
      </View>
      <Text style={styles.paste}>Copied it? Paste the whole code in one tap.</Text>

      {error ? (
        <View style={styles.note}>
          <ErrorNote message={error} />
        </View>
      ) : resent ? (
        <Text style={[styles.paste, styles.resent]}>
          A new code is on its way. Use the newest one; the older code stops working.
        </Text>
      ) : null}

      <NightButton
        label="Verify"
        variant="blue"
        onPress={() => submit(code)}
        loading={busy}
        disabled={code.length !== CODE_LENGTH}
        style={styles.submit}
      />

      <View style={styles.resendRow}>
        <Text style={nightText.muted}>Didn&apos;t get it?</Text>
        {counting ? (
          <Text style={styles.countdown}>Resend in {clock}</Text>
        ) : (
          <Pressable
            onPress={resend}
            disabled={resending}
            hitSlop={13}
            accessibilityRole="button"
            style={({ pressed }) => pressed && pressedLink}
          >
            <Text style={nightText.link}>{resending ? "Sending…" : "Resend code"}</Text>
          </Pressable>
        )}
      </View>
      <Pressable onPress={changeEmail} hitSlop={13} accessibilityRole="button" style={({ pressed }) => [styles.change, pressed && pressedLink]}>
        <Text style={styles.changeText}>Change email</Text>
      </Pressable>
      <Text style={styles.hint}>
        The code expires in 10 minutes. Check your spam folder if it isn&apos;t there.
        {/* Sign-up answers a taken address as it answers a new one (no one learns who has an account); the owner is
            emailed how to sign in instead, so the screen says that can be what arrived. */}
        {fromSignUp ? " If this address already has an account, we've emailed you how to sign in instead." : ""}
        {" Still nothing? Write to "}
        <Text
          style={styles.hintLink}
          onPress={() => void Linking.openURL(`mailto:${HELP_EMAIL}?subject=${encodeURIComponent("My code hasn't arrived")}`).catch(() => undefined)}
          accessibilityRole="link"
        >
          {HELP_EMAIL}
        </Text>
        .
      </Text>
    </NightScreen>
  );
}

const styles = StyleSheet.create({
  side: { width: 40 },
  icon: {
    marginTop: 26,
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "rgba(47, 123, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(47, 123, 255, 0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { marginTop: 22 },
  lead: { marginTop: 8 },
  email: { color: night.text, fontFamily: nightFonts.medium },

  cells: { flexDirection: "row", gap: 8, marginTop: 30 },
  cell: {
    flex: 1,
    height: 62,
    borderRadius: 16,
    backgroundColor: night.surface2,
    borderWidth: 1,
    borderColor: night.line,
    alignItems: "center",
    justifyContent: "center",
  },
  cellActive: { borderColor: night.blueRing },
  cellRing: {
    position: "absolute",
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 20,
    borderWidth: 4,
    borderColor: night.blueSoft,
  },
  cellText: { fontSize: 26, fontFamily: nightFonts.monoBold, color: night.text },
  caret: { position: "absolute", width: 2, height: 26, backgroundColor: night.ice },
  /**
   * Covers the whole row so a tap anywhere on it opens the keypad, and so a long-press
   * offers Paste. Invisible rather than absent: the cells above are the visible field.
   */
  hiddenInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: "transparent",
    fontSize: 24,
    textAlign: "center",
  },
  paste: { marginTop: 16, fontSize: 13, fontFamily: nightFonts.regular, color: night.muted },
  resent: { color: night.mint },
  note: { marginTop: 16 },
  submit: { marginTop: 28 },
  resendRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 20 },
  countdown: { fontSize: 14, fontFamily: nightFonts.mono, color: night.faint },
  change: { alignSelf: "flex-start", marginTop: 12 },
  changeText: { fontSize: 13.5, fontFamily: nightFonts.medium, color: night.ice },
  hint: { marginTop: 24, fontSize: 12, lineHeight: 17, fontFamily: nightFonts.regular, color: night.faint },
  hintLink: { color: night.muted, textDecorationLine: "underline" },
});
