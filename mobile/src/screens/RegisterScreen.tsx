import React, { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NightButton } from "../components/night/NightButton";
import { NightField } from "../components/night/NightField";
import { BackButton, ErrorNote, NightLink, NightScreen, nightText } from "../components/night/NightUI";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import { NOT_AN_EMAIL, emailFieldError, looksLikeEmail } from "../lib/authErrors";
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
  const [nameTouched, setNameTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The server refused the address itself (a throwaway inbox): said on the Email field, not above the button. */
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Any name the server takes (it asks only that there is one): a one-letter name no longer leaves the button
  // greyed out with nothing said.
  const nameOk = fullName.trim().length > 0;
  const emailOk = looksLikeEmail(email);
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
      <Text style={[nightText.h1, styles.title]} accessibilityRole="header">
        Create your{"\n"}account
      </Text>
      {/* What a free account is (FreeTier): three hummed or recorded tunes every week, not one preview. */}
      <Text style={[nightText.lead, styles.lead]}>Hum or record 3 tunes free, every week.</Text>

      <View style={styles.form}>
        <NightField
          label="Your name"
          value={fullName}
          onChangeText={setFullName}
          onBlur={() => setNameTouched(true)}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          submitBehavior="submit"
          // Said once the field is left empty, as the email's problem is: the button waits for a name.
          error={nameTouched && !nameOk ? "Type your name to continue." : undefined}
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
          error={emailError ?? (emailTouched && email.length > 0 && !emailOk ? NOT_AN_EMAIL : undefined)}
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

      {/* Says what the tap does: the next step is the code it mails. */}
      <NightButton label="Email me a code" variant="blue" onPress={submit} loading={busy} disabled={!canSubmit} style={styles.submit} />

      {/* The link its own 44 px text button (board m-ux-medium P5d); "Already have one?" stays plain text. */}
      <View style={styles.footer}>
        <Text style={nightText.muted}>Already have one?</Text>
        <NightLink label="Sign in" onPress={() => navigation.navigate("Login", { email: email.trim() })} />
      </View>
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
  hint: { marginTop: 8, fontSize: 13, fontFamily: nightFonts.regular, color: night.muted },
  error: { marginTop: 18 },
  submit: { marginTop: 24 },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", marginTop: 12 },
});
