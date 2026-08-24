import React, { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../components/Button";
import { BrandMark } from "../components/BrandMark";
import { KeyboardAvoider } from "../components/KeyboardAvoider";
import { useAuth } from "../lib/auth";
import { authApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { fonts, radii, spacing, type Palette } from "../design/theme";
import { useTheme, useThemedStyles, useColors } from "../lib/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "VerifyEmail">;

const CODE_LENGTH = 6;

/** Matches `User.EmailVerificationResendCooldown` on the server, in seconds. */
const RESEND_COOLDOWN = 60;

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
  const { email } = route.params;
  const { verifyEmail } = useAuth();
  const { mode } = useTheme();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const inputRef = useRef<TextInput>(null);

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
  }

  const activeIndex = Math.min(code.length, CODE_LENGTH - 1);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />

      <KeyboardAvoider>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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

          <View style={styles.brandContainer}>
            <BrandMark
              size={72}
              color={colors.accent}
              waveColor={colors.accentGlow}
              showWaves={false}
            />
            <Text style={styles.wordmark}>Notefusion</Text>
          </View>

          <View style={styles.titleContainer}>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a {CODE_LENGTH}-digit code to
            </Text>
            {/* Shown, and shown exactly as the server stored it, so a typo in the address
                is visible here instead of looking like a mail that never arrived. */}
            <Text style={styles.email}>{email}</Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {resent && !error && (
            <View style={styles.noticeCard}>
              <Ionicons name="mail-outline" size={18} color={colors.success} />
              <Text style={styles.noticeText}>
                A new code is on its way. Use the most recent one — the older code stops
                working.
              </Text>
            </View>
          )}

          <View style={styles.cells}>
            {Array.from({ length: CODE_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.cell,
                  focused && i === activeIndex && styles.cellActive,
                  !!code[i] && styles.cellFilled,
                ]}
              >
                <Text style={styles.cellText}>{code[i] ?? ""}</Text>
              </View>
            ))}

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
              maxLength={CODE_LENGTH}
              autoFocus
              caretHidden
              accessibilityLabel="Verification code"
            />
          </View>

          <Button
            label="Verify email"
            onPress={() => submit(code)}
            loading={busy}
            disabled={code.length !== CODE_LENGTH}
            style={styles.submitBtn}
          />

          <View style={styles.footerRow}>
            {secondsLeft > 0 ? (
              <Text style={styles.footerPrompt}>
                Didn&apos;t get it? Resend in {secondsLeft}s
              </Text>
            ) : (
              <>
                <Text style={styles.footerPrompt}>Didn&apos;t get it? </Text>
                <Pressable onPress={resend} disabled={resending} hitSlop={8}>
                  <Text style={styles.footerLink}>
                    {resending ? "Sending…" : "Resend code"}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          <Text style={styles.hint}>
            The code expires in 10 minutes. Check your spam folder if it isn&apos;t
            there.
          </Text>
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
    email: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: c.text,
      marginTop: 2,
    },

    errorCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
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

    noticeCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
      gap: spacing.xs,
    },
    noticeText: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: c.textMuted,
      flex: 1,
    },

    cells: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    cell: {
      flex: 1,
      height: 60,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.md,
    },
    cellActive: {
      borderColor: c.purple,
      borderWidth: 1.5,
    },
    cellFilled: {
      borderColor: c.accent,
    },
    cellText: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: c.text,
    },
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

    submitBtn: {
      marginBottom: spacing.md,
    },

    footerRow: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.sm,
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

    hint: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: c.textFaint,
      textAlign: "center",
      marginTop: spacing.lg,
    },
  });
