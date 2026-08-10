import React, { useState } from "react";
import {
  Dimensions,
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
import { StaffRibbon } from "../components/StaffRibbon";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import { googleAuthConfigured } from "../lib/env";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useTheme, useThemedStyles } from "../lib/theme";
import type { AuthStackParams } from "../navigation/types";

const { width } = Dimensions.get("window");

type Props = NativeStackScreenProps<AuthStackParams, "Login">;

/**
 * LoginScreen — the email/password entry point, with Google as the alternative.
 *
 * Follows the design sheet top to bottom: back arrow, brand mark with its
 * waveform flanks, wordmark and tagline, the "Welcome back!" heading, the two
 * fields, a forgot-password link, the primary Login button, the "or" break,
 * Continue with Google, the sign-up line, and the staff ribbon at the foot.
 *
 * The Google button is only rendered when client IDs are actually configured
 * (see `googleAuthConfigured`) — a button that opens a broken consent screen is
 * worse than one that isn't there, and email sign-in covers the same ground.
 */
export function LoginScreen({ navigation }: Props) {
  const { signIn, signInWithGoogle } = useAuth();
  const { mode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const canSubmit = email.trim().length > 3 && password.length > 0;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      // On success the AuthProvider swaps the root navigator — no manual navigate needed.
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

      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
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
          <Text style={styles.title}>Welcome back!</Text>
          <Text style={styles.subtitle}>Login to continue to your account</Text>

          {/* ── Fields ─────────────────────────────────────────────────────── */}
          <View style={styles.form}>
            <TextField
              label="Email"
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              placeholder="Enter your email"
            />
            <TextField
              label="Password"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              secure
              autoComplete="current-password"
              placeholder="Enter your password"
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
            label="Login"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
            icon="arrow-forward"
            iconPosition="right"
          />

          {googleAuthConfigured && (
            <>
              <OrDivider />
              <GoogleButton onPress={google} loading={googleBusy} />
            </>
          )}

          <View style={styles.signupRow}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Pressable
              onPress={() => navigation.navigate("Register")}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.signupLink}>Sign up</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoider>

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
      // Bottom padding clears the staff ribbon so the sign-up line is never
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

    /** One colour, not the old two-tone split: the design sets the wordmark
     *  solid in Ink Navy and lets the mark above carry the blue. */
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
      marginTop: spacing.xxxl,
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

    // ── Sign-up line ──────────────────────────────────────────────────────────

    signupRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xl,
    },

    signupText: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },

    signupLink: {
      fontSize: 15,
      fontFamily: fonts.bold,
      color: c.accent,
    },

    ribbon: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
    },
  });
