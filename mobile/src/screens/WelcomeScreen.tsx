import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { GoogleG } from "../components/night/GoogleG";
import { Icon } from "../components/Icon";
import { NightButton } from "../components/night/NightButton";
import { ErrorNote, Glow, Mark, Wordmark, nightText } from "../components/night/NightUI";
import { useAuth } from "../lib/auth";
import { toApiError } from "../api/client";
import { tokenStore } from "../lib/tokenStore";
import { guestPreviewStore } from "../lib/guestPreviewStore";
import { GUEST_PREVIEW_TITLE } from "../lib/guestPreview";
import { welcomeChoices } from "../lib/welcomeChoices";
import { googleAuthConfigured, siteUrls } from "../lib/env";
import { night, nightFonts } from "../design/theme";
import type { AuthStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<AuthStackParams, "Welcome">;

/**
 * Choose how to come in: Google first, email second, and a sign-in link for
 * people who already have an account. One screen of choices instead of a login
 * page and a register page that each try to be the front door.
 *
 * When this phone last signed in by email (board l-ux-high/04a), the second button is
 * "Sign in with email" with the same "Last used" chip Google gets, and creating an
 * account moves into the line under the buttons.
 *
 * "Try it first — hum a tune" (board l-ux-high/07) records thirty seconds as a guest with no
 * account; it is the second button unless email was used last, when it is a link in the line
 * (`lib/welcomeChoices`: never more than two buttons).
 */
export function WelcomeScreen({ navigation }: Props) {
  const { signInWithGoogle } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAuthMethod, setLastAuthMethod] = useState<"google" | "email" | null>(null);
  const emailLast = lastAuthMethod === "email";
  const choices = welcomeChoices(googleAuthConfigured, emailLast);

  useEffect(() => {
    tokenStore.getLastAuthMethod().then(setLastAuthMethod);
  }, []);

  /**
   * A guest's take. A preview this phone has made and not kept yet opens again instead (one per phone): its sheet
   * when it has one, else Record follows it to the end.
   */
  async function tryFirst() {
    const pending = await guestPreviewStore.read();
    if (pending?.result) navigation.navigate("Result", { result: pending.result, guest: true, title: GUEST_PREVIEW_TITLE });
    else navigation.navigate("GuestRecord");
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
    <View style={styles.root}>
      <StatusBar style="light" />
      <Glow y={0.3} radius={320} opacity={0.38} />
      <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
        <View style={styles.brand}>
          <Mark height={110} />
          <Wordmark size={34} style={styles.wordmark} />
          <Text style={[nightText.lead, styles.tagline]}>Hear it. See it. Notate it.</Text>
        </View>

        <View style={styles.actions}>
          {error && <ErrorNote message={error} />}
          {choices.blocks.map((block, i) =>
            block === "google" ? (
              <NightButton
                key={block}
                label="Continue with Google"
                icon={<GoogleG size={20} />}
                badge={lastAuthMethod === "google" ? "Last used" : undefined}
                onPress={google}
                loading={googleBusy}
              />
            ) : block === "email" && emailLast ? (
              <NightButton
                key={block}
                label="Sign in with email"
                // The envelope on the quiet button only: the blue one keeps its disc for Google's G.
                icon={i > 0 ? <Icon name="mail" size={18} color={night.text} /> : undefined}
                badge="Last used"
                variant={i > 0 ? "ghost" : "white"}
                onPress={() => navigation.navigate("Login")}
              />
            ) : block === "email" ? (
              <NightButton
                key={block}
                label="Create an account with email"
                variant={i > 0 ? "ghost" : "white"}
                onPress={() => navigation.navigate("Register")}
              />
            ) : (
              <NightButton
                key={block}
                label="Try it first — hum a tune"
                icon={<Icon name="mic" size={18} color={night.text} />}
                variant="ghost"
                onPress={() => void tryFirst()}
              />
            ),
          )}
          <Text style={[nightText.muted, styles.center, styles.signIn]}>
            {choices.lead}{" "}
            {choices.links.map((link, i) => (
              <React.Fragment key={link}>
                {i > 0 ? " · " : null}
                <Text
                  style={nightText.link}
                  onPress={
                    link === "create"
                      ? () => navigation.navigate("Register")
                      : link === "signIn"
                        ? () => navigation.navigate("Login")
                        : () => void tryFirst()
                  }
                  accessibilityRole="link"
                >
                  {link === "create" ? "Create an account" : link === "signIn" ? "Sign in" : "Try it first"}
                </Text>
              </React.Fragment>
            ))}
          </Text>
          <Text style={styles.legal}>
            By continuing you agree to the{" "}
            <Text style={styles.legalLink} onPress={() => WebBrowser.openBrowserAsync(siteUrls.terms)}>
              Terms
            </Text>{" "}
            and the{" "}
            <Text style={styles.legalLink} onPress={() => WebBrowser.openBrowserAsync(siteUrls.privacy)}>
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: night.bgDeep },
  flex: { flex: 1 },
  brand: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 40 },
  wordmark: { marginTop: 24 },
  tagline: { marginTop: 6 },
  actions: { paddingHorizontal: 22, paddingBottom: 20, gap: 10 },
  center: { textAlign: "center" },
  signIn: { marginTop: 8 },
  legal: {
    marginTop: 6,
    textAlign: "center",
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: nightFonts.regular,
    color: night.faint,
  },
  legalLink: { color: night.muted, textDecorationLine: "underline" },
});
