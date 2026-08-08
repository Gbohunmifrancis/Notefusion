import React, { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import {
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useThemedStyles } from "../lib/theme";
import { appIcons } from "../design/icons";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Login">;

/**
 * LoginScreen — light blue auth entry point.
 *
 * Layout (top → bottom):
 *   • Ambient blue glow orb behind the brand mark.
 *   • "Note"(sky) + "Fusion"(blue) glowing wordmark — same treatment as SplashScreen.
 *   • Subtitle in Slate.
 *   • Glass input fields for email + password.
 *   • Inline error chip (red-tinted glass) if sign-in fails.
 *   • Primary "Sign in" button — "The Fusion" gradient.
 *   • Ghost CTA to navigate to Register.
 */
export function LoginScreen({ navigation }: Props) {
  const { signIn } = useAuth();
  const styles = useThemedStyles(makeStyles);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <Screen scroll>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* ── Brand header ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Ambient glow orb behind the mark */}
          <View style={styles.orbWrap}>
            <View style={styles.orbPink} />
            <View style={styles.orbPurple} />

            {/* Gradient ring mark */}
            <LinearGradient
              colors={gradients.brandStart} // #0EA5E9 → #2563EB
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.mark}
            >
              {/* Inner glass disc */}
              <View style={styles.markInner}>
                <Image source={appIcons.music} style={styles.markImg} />
              </View>
            </LinearGradient>
          </View>

          {/* "Note" (pink) + "Fusion" (purple) glowing wordmark */}
          <View style={styles.wordmarkRow}>
            <Text style={styles.wordNote}>Note</Text>
            <Text style={styles.wordFusion}>Fusion</Text>
          </View>

          <Text style={styles.subtitle}>
            Welcome back — sign in to continue.
          </Text>
        </View>

        {/* ── Form fields ──────────────────────────────────────────────────── */}
        <View style={styles.form}>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@example.com"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secure
            placeholder="••••••••"
          />
        </View>

        {/* ── Inline error ─────────────────────────────────────────────────── */}
        {error && (
          <View style={styles.errorBox}>
            {/* Danger dot */}
            <View style={styles.errorDot} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <View style={styles.actions}>
          <Button
            label="Sign in"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
          />
          <Button
            label="Create an account"
            variant="ghost"
            onPress={() => navigation.navigate("Register")}
            style={styles.ghostBtn}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // ── Header ────────────────────────────────────────────────────────────────

    header: {
      alignItems: "center",
      marginTop: spacing.xxxl,
      marginBottom: spacing.xxl,
    },

    /** Wrapper that stacks the glow orbs + mark in a single positioned group. */
    orbWrap: {
      width: 120,
      height: 120,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xl,
    },

    orbPink: {
      position: "absolute",
      width: 130,
      height: 130,
      borderRadius: 65,
      backgroundColor: "rgba(14, 165, 233, 0.18)",
    },

    orbPurple: {
      position: "absolute",
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: "rgba(37, 99, 235, 0.22)",
    },

    /** Gradient ring — 80 × 80 pill with an inner disc. */
    mark: {
      width: 80,
      height: 80,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      // Blue glow
      shadowColor: "#2563EB",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.6,
      shadowRadius: 20,
      elevation: 10,
    },

    /** The disc the brand icon sits on — surface-coloured so the icon reads
     *  in both modes rather than punching a white hole in the dark canvas. */
    markInner: {
      width: 60,
      height: 60,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.borderLight,
    },

    markImg: {
      width: 34,
      height: 34,
    },

    // ── Wordmark ──────────────────────────────────────────────────────────────
    // Brand hues, literal in both modes — this is the logo, not themed chrome.

    wordmarkRow: {
      flexDirection: "row",
      alignItems: "baseline",
      marginBottom: spacing.sm,
    },

    wordNote: {
      fontSize: 32,
      fontWeight: "800",
      color: "#0EA5E9",
      letterSpacing: -1,
      textShadowColor: "rgba(14, 165, 233, 0.9)",
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 14,
    },

    wordFusion: {
      fontSize: 32,
      fontWeight: "800",
      color: "#2563EB",
      letterSpacing: -1,
      textShadowColor: "rgba(37, 99, 235, 0.9)",
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 14,
    },

    subtitle: {
      ...typography.body,
      color: c.textMuted,
      textAlign: "center",
      marginTop: spacing.xs,
      fontSize: 15,
    },

    // ── Form ──────────────────────────────────────────────────────────────────

    form: {
      marginBottom: spacing.sm,
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
      // Glow
      shadowColor: c.danger,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.8,
      shadowRadius: 6,
      elevation: 3,
    },

    errorText: {
      ...typography.caption,
      color: c.danger,
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
    },

    // ── Actions ───────────────────────────────────────────────────────────────

    actions: {
      gap: spacing.xs,
    },

    ghostBtn: {
      marginTop: spacing.xs,
    },
  });
