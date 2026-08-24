import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../components/Button";
import { BrandMark } from "../components/BrandMark";
import { GoogleButton } from "../components/GoogleButton";
import { KeyboardAvoider } from "../components/KeyboardAvoider";
import { OrDivider } from "../components/OrDivider";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import { googleAuthConfigured } from "../lib/env";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useTheme, useThemedStyles, useColors } from "../lib/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Register">;

/**
 * RegisterScreen — 100% aligned with design sheet:
 * 1. Top left back arrow
 * 2. Centered BrandMark + Notefusion wordmark
 * 3. Title: "Create your account", Subtitle: "Start your musical journey"
 * 4. Full name, Email, Password, and Confirm password fields
 * 5. Primary "Sign up" blue pill button
 * 6. "or" divider + "Sign up with Google" button
 * 7. Bottom link: "Already have an account? Sign in"
 */
export function RegisterScreen({ navigation }: Props) {
  const { signUp, signInWithGoogle } = useAuth();
  const { mode } = useTheme();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const nameOk = fullName.trim().length >= 2;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const pwOk = password.length >= 8;
  const confirmOk = password === confirmPassword;

  const canSubmit = nameOk && emailOk && pwOk && confirmOk;

  async function submit() {
    if (!confirmOk) {
      setError("Passwords do not match");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // No session yet: registration mails a code, and VerifyEmail is what signs in.
      const registered = await signUp(fullName.trim(), email.trim(), password);
      navigation.navigate("VerifyEmail", { email: registered });
    } catch (e) {
      setError(toApiError(e).message);
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
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />

      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. Top Header: Back arrow ─────────────────────────────────── */}
          <View style={styles.topHeader}>
            {navigation.canGoBack() ? (
              <Pressable
                onPress={() => navigation.goBack()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
            ) : (
              <View />
            )}
          </View>

          {/* ── 2. Centered Brand Logo ────────────────────────────────────── */}
          <View style={styles.brandContainer}>
            <BrandMark size={72} color={colors.accent} waveColor={colors.accentGlow} showWaves={false} />
            <Text style={styles.wordmark}>Notefusion</Text>
          </View>

          {/* ── 3. Title & Subtitle ────────────────────────────────────────── */}
          <View style={styles.titleContainer}>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>Start your musical journey</Text>
          </View>

          {/* Error Banner */}
          {error && (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* ── 4. Form Fields ────────────────────────────────────────────── */}
          <View style={styles.form}>
            <TextField
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoComplete="name"
              placeholder="Full name"
            />
            <TextField
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="Email"
              error={
                email.length > 0 && !emailOk ? "Enter a valid email" : undefined
              }
            />
            <TextField
              value={password}
              onChangeText={setPassword}
              secure
              autoComplete="new-password"
              placeholder="Password"
              error={
                password.length > 0 && !pwOk ? "Minimum 8 characters" : undefined
              }
            />
            <TextField
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secure
              autoComplete="new-password"
              placeholder="Confirm password"
              error={
                confirmPassword.length > 0 && !confirmOk
                  ? "Passwords do not match"
                  : undefined
              }
            />
          </View>

          {/* ── 5. Primary Sign up Button ────────────────────────────────── */}
          <Button
            label="Sign up"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
            style={styles.submitBtn}
          />

          {/* ── 6. Divider & Google Sign-Up ───────────────────────────────── */}
          {googleAuthConfigured && (
            <>
              <OrDivider />
              <GoogleButton
                onPress={google}
                loading={googleBusy}
                label="Sign up with Google"
              />
            </>
          )}

          {/* ── 7. Footer Sign in link ────────────────────────────────────── */}
          <View style={styles.footerRow}>
            <Text style={styles.footerPrompt}>Already have an account? </Text>
            <Pressable onPress={() => navigation.navigate("Login")}>
              <Text style={styles.footerLink}>Sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoider>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.bg,
    },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xxl,
    },

    topHeader: {
      paddingTop: spacing.xs,
      marginBottom: spacing.md,
    },

    brandContainer: {
      alignItems: "center",
      marginBottom: spacing.lg,
    },
    wordmark: {
      fontSize: 26,
      // Poppins: this is the wordmark, not UI text. See `fonts` in design/theme.
      fontFamily: fonts.displayBold,
      color: c.accent,
      letterSpacing: -0.5,
      marginTop: spacing.xs,
    },

    titleContainer: {
      alignItems: "center",
      marginBottom: spacing.xl,
    },
    title: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: c.text,
      marginBottom: 2,
    },
    subtitle: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },

    errorCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.dangerSoft,
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: radii.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
      gap: spacing.xs,
    },
    errorText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: c.danger,
      flex: 1,
    },

    form: {
      marginBottom: spacing.md,
    },

    submitBtn: {
      marginBottom: spacing.md,
    },

    footerRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xxl,
    },
    footerPrompt: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },
    footerLink: {
      fontSize: 14,
      fontFamily: fonts.bold,
      color: c.accent,
    },
  });
