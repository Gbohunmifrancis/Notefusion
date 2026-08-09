import React, { useState } from "react";
import {
  Dimensions,
  KeyboardAvoidingView,
  Linking,
  Platform,
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
import { OrDivider } from "../components/OrDivider";
import { StaffRibbon } from "../components/StaffRibbon";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import { googleAuthConfigured } from "../lib/env";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useTheme, useThemedStyles } from "../lib/theme";
import type { AuthStackParams } from "../navigation/types";

const { width } = Dimensions.get("window");

type Props = NativeStackScreenProps<AuthStackParams, "Register">;

/**
 * RegisterScreen — the sign-up counterpart to Login.
 *
 * Deliberately the same frame as LoginScreen: brand block, heading pair, fields,
 * primary action, the "or" break, Google, and the staff ribbon at the foot. The
 * two screens are one flow with one difference — the number of fields — so
 * anything that moved between them would read as a different app.
 *
 * Google appears here too because `POST /api/auth/google` creates the account the
 * first time it sees a subject: signing up with Google and signing in with it are
 * the same call, so there is no reason to make someone find the Login screen.
 */
export function RegisterScreen({ navigation }: Props) {
  const { signUp, signInWithGoogle } = useAuth();
  const { mode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Mirror the server's RegisterCommandValidator so users get instant feedback.
  const nameOk = fullName.trim().length >= 2;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const pwOk = password.length >= 8;
  const canSubmit = nameOk && emailOk && pwOk;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signUp(fullName.trim(), email.trim(), password);
      // On success the AuthProvider swaps the root navigator — no navigate here.
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
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "android" ? 0 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Back ───────────────────────────────────────────────────────── */}
          {navigation.canGoBack() && (
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={styles.back}
            >
              <Ionicons name="arrow-back" size={26} color="#2563EB" />
            </Pressable>
          )}

          {/* ── Brand ──────────────────────────────────────────────────────── */}
          <View style={styles.brand}>
            <BrandMark size={104} color="#2563EB" waveColor="#BFD4FE" showWaves />
            <Text style={styles.wordmark}>Notefusion</Text>
            <Text style={styles.tagline}>Hear it. See it. Notate it.</Text>
          </View>

          {/* ── Heading ────────────────────────────────────────────────────── */}
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Start turning melodies into notation</Text>

          {/* ── Fields ─────────────────────────────────────────────────────── */}
          <View style={styles.form}>
            <TextField
              label="Full name"
              icon="person-outline"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoComplete="name"
              placeholder="Enter your name"
            />
            <TextField
              label="Email"
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              placeholder="Enter your email"
              error={
                email.length > 0 && !emailOk ? "Enter a valid email" : undefined
              }
            />
            <TextField
              label="Password"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              secure
              autoComplete="new-password"
              placeholder="At least 8 characters"
              error={
                password.length > 0 && !pwOk ? "Minimum 8 characters" : undefined
              }
              style={styles.lastField}
            />
          </View>

          {/* ── Inline error ───────────────────────────────────────────────── */}
          {error && (
            <View style={styles.errorBox}>
              <View style={styles.errorDot} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* ── Actions ────────────────────────────────────────────────────── */}
          <Button
            label="Create account"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
            icon="arrow-forward"
            iconPosition="right"
          />

          {googleAuthConfigured && (
            <>
              <OrDivider />
              <GoogleButton
                label="Sign up with Google"
                onPress={google}
                loading={googleBusy}
              />
            </>
          )}

          <View style={styles.signinRow}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <Pressable
              onPress={() => navigation.navigate("Login")}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.signinLink}>Log in</Text>
            </Pressable>
          </View>

          {/* ── Privacy policy ─────────────────────────────────────────────── */}
          <Pressable
            style={styles.privacyRow}
            onPress={() =>
              Linking.openURL(
                "https://notefusion-privacy.vercel.app/privacy-policy.html",
              )
            }
            accessibilityRole="link"
          >
            <Text style={styles.privacyText}>
              By creating an account you agree to our{" "}
              <Text style={styles.privacyLink}>Privacy Policy</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Decorative staff ─────────────────────────────────────────────── */}
      {/* Outside the ScrollView so it stays pinned to the bottom edge and never
          scrolls up over the form. */}
      <View style={styles.ribbon} pointerEvents="none">
        <StaffRibbon width={width} height={120} color="#2563EB" opacity={0.2} />
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.bg,
    },

    flex: {
      flex: 1,
    },

    scroll: {
      paddingHorizontal: spacing.xl,
      // Bottom padding clears the staff ribbon so the sign-in line is never
      // sitting on top of the artwork.
      paddingBottom: 130,
    },

    back: {
      alignSelf: "flex-start",
      paddingVertical: spacing.md,
    },

    // ── Brand ─────────────────────────────────────────────────────────────────

    brand: {
      alignItems: "center",
      marginTop: spacing.sm,
    },

    wordmark: {
      ...typography.hero,
      color: c.text,
      marginTop: spacing.md,
    },

    tagline: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: spacing.xs,
    },

    // ── Heading ───────────────────────────────────────────────────────────────

    title: {
      ...typography.screenTitle,
      color: c.text,
      marginTop: spacing.xxl,
    },

    subtitle: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: spacing.xs,
    },

    // ── Form ──────────────────────────────────────────────────────────────────

    form: {
      marginTop: spacing.xl,
      marginBottom: spacing.xl,
    },

    /** Pull the bottom margin off the last field so the form → button gap
     *  matches the top. */
    lastField: {
      marginBottom: 0,
    },

    // ── Error chip ────────────────────────────────────────────────────────────

    errorBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "rgba(220, 38, 38, 0.10)",
      borderWidth: 1,
      borderColor: "rgba(220, 38, 38, 0.28)",
      borderRadius: radii.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },

    errorDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.danger,
      marginRight: spacing.sm,
    },

    errorText: {
      ...typography.caption,
      color: c.danger,
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
    },

    // ── Sign-in line ──────────────────────────────────────────────────────────

    signinRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xl,
    },

    signinText: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },

    signinLink: {
      fontSize: 15,
      fontFamily: fonts.bold,
      color: c.accent,
    },

    privacyRow: {
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
      alignItems: "center",
      paddingHorizontal: spacing.md,
    },

    privacyText: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: c.textFaint,
      textAlign: "center",
      lineHeight: 18,
    },

    privacyLink: {
      fontSize: 12,
      fontFamily: fonts.semibold,
      color: c.accent,
      textDecorationLine: "underline",
    },

    ribbon: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
    },
  });
