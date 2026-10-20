import React, { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NightButton } from "../components/night/NightButton";
import { NightField } from "../components/night/NightField";
import { BackButton, ErrorNote, NightScreen, nightText } from "../components/night/NightUI";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import { emailFieldError } from "../lib/authErrors";
import { MIN_PASSWORD, passwordStrength } from "../lib/passwordStrength";
import { night, nightFonts } from "../design/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Register">;

/**
 * Step one of two: name, email and a password, then the emailed code. There is
 * no "confirm password" field — the eye in the field shows what was typed, which
 * catches a typo without making everyone type it twice.
 */
export function RegisterScreen({ navigation, route }: Props) {
  const { signUp } = useAuth();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The server refused the address itself (a throwaway inbox): said on the Email field, not above Continue. */
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOk = fullName.trim().length >= 2;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const pwOk = password.length >= MIN_PASSWORD;
  const canSubmit = nameOk && emailOk && pwOk;
  const strength = passwordStrength(password);

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setEmailError(null);
    setBusy(true);
    try {
      // No session yet: registration mails a code, and VerifyEmail is what signs in.
      const registered = await signUp(fullName.trim(), email.trim(), password);
      navigation.navigate("VerifyEmail", { email: registered, fromSignUp: true, sentAt: Date.now() });
    } catch (e) {
      const err = toApiError(e);
      const onEmail = emailFieldError(err);
      if (onEmail) setEmailError(onEmail);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <NightScreen
      header={
        <>
          {navigation.canGoBack() ? <BackButton onPress={() => navigation.goBack()} /> : <View style={styles.side} />}
          <Text style={nightText.step}>1 of 2</Text>
          <View style={styles.side} />
        </>
      }
    >
      <Text style={[nightText.h1, styles.title]}>Create your{"\n"}account</Text>
      <Text style={[nightText.lead, styles.lead]}>Your first song preview is free.</Text>

      <View style={styles.form}>
        <NightField
          label="Your name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          submitBehavior="submit"
        />
        <NightField
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setError(null);
            setEmailError(null);
          }}
          onBlur={() => setEmailTouched(true)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          submitBehavior="submit"
          // Only once they have left the field: "enter a valid email" while someone
          // is still typing the address is nagging, not help.
          error={emailError ?? (emailTouched && email.length > 0 && !emailOk ? "That doesn't look like an email address." : undefined)}
        />
        <NightField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          secure
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
      </View>

      <View style={styles.meter} accessibilityLabel={strength.hint} accessibilityLiveRegion="polite">
        <View style={styles.bars}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.bar, i < strength.score && { backgroundColor: night[strength.tone] }]} />
          ))}
        </View>
        <Text style={styles.hint}>{strength.hint}</Text>
      </View>

      {error && (
        <View style={styles.error}>
          <ErrorNote message={error} />
        </View>
      )}

      <NightButton label="Continue" variant="blue" onPress={submit} loading={busy} disabled={!canSubmit} style={styles.submit} />

      <Text style={[nightText.muted, styles.footer]}>
        Already have one?{" "}
        <Text style={nightText.link} onPress={() => navigation.navigate("Login", { email: email.trim() })} accessibilityRole="link">
          Sign in
        </Text>
      </Text>
    </NightScreen>
  );
}

const styles = StyleSheet.create({
  side: { width: 40 },
  title: { marginTop: 26 },
  lead: { marginTop: 8 },
  form: { marginTop: 28, gap: 12 },
  meter: { marginTop: 12 },
  bars: { flexDirection: "row", gap: 5 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255, 255, 255, 0.12)" },
  hint: { marginTop: 8, fontSize: 12.5, fontFamily: nightFonts.regular, color: night.muted },
  error: { marginTop: 18 },
  submit: { marginTop: 24 },
  footer: { textAlign: "center", marginTop: 20 },
});
