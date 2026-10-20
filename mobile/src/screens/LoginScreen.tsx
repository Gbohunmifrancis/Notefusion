import React, { useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GoogleG } from "../components/night/GoogleG";
import { NightButton } from "../components/night/NightButton";
import { NightField } from "../components/night/NightField";
import { BackButton, ErrorNote, Mark, NightLink, NightScreen, OrRule, nightText, pressedLink } from "../components/night/NightUI";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import { NOT_AN_EMAIL, contactUsUrl, googleFailure, looksLikeEmail, missesAfter, offersReset } from "../lib/authErrors";
import { tokenStore } from "../lib/tokenStore";
import { googleAuthConfigured } from "../lib/env";
import { night, nightFonts } from "../design/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Login">;

/** Sign in with email and password, or Google. */
export function LoginScreen({ navigation, route }: Props) {
  const { signIn, signInWithGoogle } = useAuth();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState(route.params?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Wrong email or password in a row: from the second, the note offers Forgot password? (board l-ux-high 04d). */
  const [misses, setMisses] = useState(0);
  /** A refusal only we can lift (a deactivated account): the note carries a mail to us. */
  const [contact, setContact] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  /** Undefined until the phone has said how it last signed in: Google's button waits, unseen, for its chip. */
  const [lastAuthMethod, setLastAuthMethod] = useState<"google" | "email" | null | undefined>(undefined);

  useEffect(() => {
    tokenStore.getLastAuthMethod().then(setLastAuthMethod, () => setLastAuthMethod(null));
    // No address handed over: the one this phone last used by email, unless something is typed by then.
    if (route.params?.email) return;
    void tokenStore.getLastEmail().then((last) => {
      if (last) setEmail((typed) => typed || last);
    });
  }, []);

  /** The email field has been left once: from then a mistyped address is said under it, as on Register. */
  const [emailTouched, setEmailTouched] = useState(false);
  const emailOk = looksLikeEmail(email);
  const canSubmit = emailOk && password.length > 0;

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      const err = toApiError(e);
      setMisses((n) => missesAfter(n, err.code));
      setContact(contactUsUrl(err.code));
      // The password was right; the address was never confirmed. The server has already
      // mailed a fresh code by the time this lands, so send them straight to the boxes
      // rather than showing an error they can do nothing about.
      if (err.code === "AUTH_EMAIL_NOT_VERIFIED") {
        navigation.navigate("VerifyEmail", { email: email.trim().toLowerCase(), fromSignUp: false, sentAt: Date.now() });
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const forgot = () => navigation.navigate("ForgotPassword", { email: email.trim() });

  async function google() {
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      const err = toApiError(e);
      setMisses(0);
      setContact(contactUsUrl(err.code));
      setError(googleFailure(err, "sign in with your email and password"));
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <NightScreen
      header={
        <>
          {navigation.canGoBack() ? <BackButton onPress={() => navigation.goBack()} /> : <View style={styles.side} />}
          <Mark height={26} />
          <View style={styles.side} />
        </>
      }
    >
      <Text style={[nightText.h1, styles.title]} accessibilityRole="header">
        Welcome back
      </Text>
      <Text style={[nightText.lead, styles.lead]}>Sign in to your sheets and folders.</Text>

      <View style={styles.form}>
        <NightField
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          submitBehavior="submit"
          onBlur={() => setEmailTouched(true)}
          // Said once the field is left, so a greyed Sign in always has its reason on screen.
          error={emailTouched && email.length > 0 && !emailOk ? NOT_AN_EMAIL : undefined}
        />
        <NightField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            setError(null);
          }}
          secure
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </View>

      <Pressable
        onPress={forgot}
        style={({ pressed }) => [styles.forgot, pressed && pressedLink]}
        // 44 pt tall without moving the link: up to the field above, and down into the gap below.
        hitSlop={{ top: 12, bottom: 14, left: 12, right: 12 }}
        accessibilityRole="button"
      >
        <Text style={styles.forgotText}>Forgot password?</Text>
      </Pressable>

      {error && (
        <View style={styles.error}>
          <ErrorNote
            message={error}
            action={
              offersReset(misses)
                ? { label: "Forgot password?", onPress: forgot }
                : contact
                  ? { label: "Email us", onPress: () => void Linking.openURL(contact).catch(() => undefined) }
                  : undefined
            }
          />
        </View>
      )}

      <NightButton label="Sign in" variant="blue" onPress={submit} loading={busy} disabled={!canSubmit} style={styles.submit} />

      {googleAuthConfigured && (
        <>
          <OrRule />
          <NightButton
            label="Continue with Google"
            variant="ghost"
            icon={<GoogleG size={20} />}
            badge={lastAuthMethod === "google" ? "Last used" : undefined}
            onPress={google}
            loading={googleBusy}
            style={lastAuthMethod === undefined && styles.waiting}
          />
        </>
      )}

      {/* The link its own 44 px text button (board m-ux-medium P5d); "New here?" stays plain text. */}
      <View style={styles.footer}>
        <Text style={nightText.muted}>New here?</Text>
        <NightLink label="Create an account" onPress={() => navigation.navigate("Register", { email: email.trim() })} />
      </View>
    </NightScreen>
  );
}

const styles = StyleSheet.create({
  side: { width: 40 },
  title: { marginTop: 26 },
  lead: { marginTop: 8 },
  form: { marginTop: 30, gap: 12 },
  forgot: { alignSelf: "flex-end", marginTop: 12 },
  forgotText: { fontSize: 13.5, fontFamily: nightFonts.medium, color: night.ice },
  error: { marginTop: 18 },
  submit: { marginTop: 22 },
  /** Laid out but unseen while the last way in is read. */
  waiting: { opacity: 0 },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", marginTop: 12 },
});
