import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GoogleG } from "../components/night/GoogleG";
import { NightButton } from "../components/night/NightButton";
import { NightField } from "../components/night/NightField";
import { BackButton, ErrorNote, Mark, NightScreen, OrRule, nightText, pressedLink } from "../components/night/NightUI";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import { tokenStore } from "../lib/tokenStore";
import { googleAuthConfigured } from "../lib/env";
import { night, nightFonts } from "../design/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Login">;

/** Sign in with email and password, or Google. */
export function LoginScreen({ navigation }: Props) {
  const { signIn, signInWithGoogle } = useAuth();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [lastAuthMethod, setLastAuthMethod] = useState<"google" | "email" | null>(null);

  useEffect(() => {
    tokenStore.getLastAuthMethod().then(setLastAuthMethod);
  }, []);

  const canSubmit = email.trim().length > 3 && password.length > 0;

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      const err = toApiError(e);
      // The password was right; the address was never confirmed. The server has already
      // mailed a fresh code by the time this lands, so send them straight to the boxes
      // rather than showing an error they can do nothing about.
      if (err.code === "AUTH_EMAIL_NOT_VERIFIED") {
        navigation.navigate("VerifyEmail", { email: email.trim().toLowerCase() });
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(toApiError(e).message);
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
      <Text style={[nightText.h1, styles.title]}>Welcome back</Text>
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
        onPress={() => navigation.navigate("ForgotPassword", { email: email.trim() })}
        style={({ pressed }) => [styles.forgot, pressed && pressedLink]}
        hitSlop={8}
        accessibilityRole="button"
      >
        <Text style={styles.forgotText}>Forgot password?</Text>
      </Pressable>

      {error && (
        <View style={styles.error}>
          <ErrorNote message={error} />
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
          />
        </>
      )}

      <Text style={[nightText.muted, styles.footer]}>
        New here?{" "}
        <Text style={nightText.link} onPress={() => navigation.navigate("Register")} accessibilityRole="link">
          Create an account
        </Text>
      </Text>
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
  footer: { textAlign: "center", marginTop: 22 },
});
