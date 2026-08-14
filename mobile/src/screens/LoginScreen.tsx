import React, { useEffect, useState } from "react";
import {
  Modal,
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
import { authApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { tokenStore } from "../lib/tokenStore";
import { googleAuthConfigured } from "../lib/env";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useTheme, useThemedStyles, useColors } from "../lib/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Login">;

/**
 * LoginScreen — 100% aligned with design sheet:
 * 1. Top left back arrow
 * 2. Centered BrandMark + Notefusion wordmark
 * 3. Title: "Welcome back!", Subtitle: "Sign in to continue"
 * 4. Email + Password fields + right-aligned "Forgot password?"
 * 5. Primary "Sign in" blue pill button
 * 6. "or" divider + "Sign in with Google" button
 * 7. Bottom link: "Don't have an account? Sign up"
 */
export function LoginScreen({ navigation }: Props) {
  const { signIn, signInWithGoogle } = useAuth();
  const { mode } = useTheme();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [lastAuthMethod, setLastAuthMethod] = useState<"google" | "email" | null>(null);

  useEffect(() => {
    tokenStore.getLastAuthMethod().then(setLastAuthMethod);
  }, []);

  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);

  const canSubmit = email.trim().length > 3 && password.length > 0;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
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

  async function sendForgot() {
    if (!forgotEmail.trim()) return;
    setForgotBusy(true);
    try {
      await authApi.forgotPassword(forgotEmail.trim());
      setForgotSent(true);
    } catch {
      // Show success anyway so user enumeration is avoided
      setForgotSent(true);
    } finally {
      setForgotBusy(false);
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
            <BrandMark size={72} color="#2563EB" waveColor="rgba(37,99,235,0.4)" showWaves={false} />
            <Text style={styles.wordmark}>Notefusion</Text>
          </View>

          {/* ── 3. Title & Subtitle ────────────────────────────────────────── */}
          <View style={styles.titleContainer}>
            <Text style={styles.title}>Welcome back!</Text>
            <Text style={styles.subtitle}>Sign in to continue</Text>
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
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="Email"
            />
            <TextField
              value={password}
              onChangeText={setPassword}
              secure
              autoComplete="current-password"
              placeholder="Password"
            />

            {/* Forgot password right-aligned link */}
            <Pressable
              onPress={() => {
                setForgotEmail(email);
                setForgotSent(false);
                setForgotVisible(true);
              }}
              style={styles.forgotRow}
              accessibilityRole="button"
            >
              <Text style={styles.forgotLink}>Forgot password?</Text>
            </Pressable>
          </View>

          {/* ── 5. Primary Sign in Button ────────────────────────────────── */}
          <Button
            label="Sign in"
            onPress={submit}
            loading={busy}
            disabled={!canSubmit}
            style={styles.submitBtn}
          />

          {/* ── 6. Divider & Google Sign-In ───────────────────────────────── */}
          {googleAuthConfigured && (
            <>
              <OrDivider />
              <GoogleButton
                onPress={google}
                loading={googleBusy}
                label="Sign in with Google"
                isLastUsed={lastAuthMethod === "google"}
              />
            </>
          )}

          {/* ── 7. Footer Sign up link ────────────────────────────────────── */}
          <View style={styles.footerRow}>
            <Text style={styles.footerPrompt}>Don't have an account? </Text>
            <Pressable onPress={() => navigation.navigate("Register")}>
              <Text style={styles.footerLink}>Sign up</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoider>

      {/* ── Forgot Password Sheet ────────────────────────────────────────── */}
      <Modal
        visible={forgotVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setForgotVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {forgotSent ? (
              <>
                <Ionicons name="mail-outline" size={44} color={colors.accent} style={styles.modalIcon} />
                <Text style={styles.modalTitle}>Check your inbox</Text>
                <Text style={styles.modalBody}>
                  If <Text style={{ fontFamily: fonts.semibold }}>{forgotEmail}</Text> is registered, a reset link is on its way.
                </Text>
                <Button label="Done" onPress={() => { setForgotVisible(false); setForgotSent(false); }} />
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Reset password</Text>
                <Text style={styles.modalBody}>Enter your email address and we'll send a reset link.</Text>
                <TextField
                  label="Email"
                  icon="mail-outline"
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  keyboardType="email-address"
                  autoComplete="email"
                  placeholder="you@example.com"
                />
                <Button
                  label="Send reset link"
                  onPress={sendForgot}
                  loading={forgotBusy}
                  disabled={!forgotEmail.trim()}
                />
                <Pressable
                  onPress={() => setForgotVisible(false)}
                  style={styles.cancelRow}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelLink}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
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
      fontFamily: fonts.bold,
      color: "#2563EB",
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
      backgroundColor: "#FEF2F2",
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
    forgotRow: {
      alignSelf: "flex-end",
      marginTop: 2,
      marginBottom: spacing.md,
    },
    forgotLink: {
      fontSize: 13,
      fontFamily: fonts.semibold,
      color: "#2563EB",
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
      color: "#2563EB",
    },

    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },
    modalCard: {
      backgroundColor: c.bg,
      borderRadius: radii.xl,
      padding: spacing.xl,
      width: "100%",
    },
    modalIcon: {
      alignSelf: "center",
      marginBottom: spacing.md,
    },
    modalTitle: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: c.text,
      marginBottom: spacing.sm,
    },
    modalBody: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginBottom: spacing.xl,
      lineHeight: 22,
    },
    cancelRow: {
      alignSelf: "center",
      marginTop: spacing.md,
    },
    cancelLink: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: c.textMuted,
    },
  });
