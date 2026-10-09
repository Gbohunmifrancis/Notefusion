import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";

import { feedbackApi, type FeedbackCategory, type HeardAboutSource } from "../api/endpoints";
import { Button } from "../components/Button";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { logAnalyticsEvent as logEvent } from "./analytics";
import * as haptics from "./haptics";
import { rating } from "./rating";
import { useColors, useThemedStyles } from "./theme";

/**
 * Asking users things: "where did you hear about us?" once, a rating now and then, and a feedback
 * form whenever they want one. The API decides when "heard about" is due (GET /api/feedback/prompts).
 * The rating is asked on the third saved sheet by `lib/rating` (see `ratingPolicy`); this file shows
 * it and sends the answer to the API, so the admin console sees every rating and dismissal.
 */

const SOURCES: { value: HeardAboutSource; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "friend", label: "Friend or family", icon: "people-outline" },
  { value: "church", label: "Church or choir", icon: "musical-notes-outline" },
  { value: "whatsapp", label: "WhatsApp", icon: "logo-whatsapp" },
  { value: "instagram", label: "Instagram", icon: "logo-instagram" },
  { value: "tiktok", label: "TikTok", icon: "logo-tiktok" },
  { value: "youtube", label: "YouTube", icon: "logo-youtube" },
  { value: "facebook", label: "Facebook", icon: "logo-facebook" },
  { value: "x", label: "X (Twitter)", icon: "logo-twitter" },
  { value: "google", label: "Google search", icon: "search-outline" },
  { value: "play_store", label: "Play Store", icon: "logo-google-playstore" },
  { value: "other", label: "Somewhere else", icon: "ellipsis-horizontal" },
];

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Something's broken" },
  { value: "idea", label: "An idea" },
  { value: "accuracy", label: "Transcription accuracy" },
  { value: "payments", label: "Payments" },
  { value: "other", label: "Other" },
];

const appVersion = Constants.expoConfig?.version ?? undefined;

type Sheet = "heard" | "rating" | "feedback" | null;

interface FeedbackApi {
  /** Opens the feedback form. `screen` says where it was opened from, for the console. */
  openFeedback: (screen: string) => void;
}

const FeedbackContext = createContext<FeedbackApi>({ openFeedback: () => undefined });

export function useFeedback(): FeedbackApi {
  return useContext(FeedbackContext);
}

/**
 * Mounted once, inside the signed-in app. Asks "where did you hear about us?" a few seconds into the
 * first session that has not answered it, and owns the rating sheet and the feedback form.
 */
export function FeedbackProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const screenRef = useRef("App");
  const heardChecked = useRef(false);
  const [saves, setSaves] = useState(0);

  // "Where did you hear about us?" — once a session at most, and not over the splash or the first frame.
  useEffect(() => {
    if (!enabled || heardChecked.current) return;
    heardChecked.current = true;
    const timer = setTimeout(() => {
      feedbackApi
        .prompts()
        .then((p) => {
          if (p.askHeardAbout) setSheet((current) => current ?? "heard");
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearTimeout(timer);
  }, [enabled]);

  const openFeedback = useCallback((screen: string) => {
    screenRef.current = screen;
    setSheet("feedback");
  }, []);

  // The rating ask comes from a save (`rating.recordSave`), which already checked the policy.
  // It wins over "heard about": the save flow left out its "Saved" dialog because of it.
  useEffect(() => {
    if (!enabled) return;
    return rating.subscribe((count) => {
      screenRef.current = "Result";
      setSaves(count);
      setSheet("rating");
      void logEvent("rating_prompt_shown");
    });
  }, [enabled]);

  const value = useMemo(() => ({ openFeedback }), [openFeedback]);
  const close = () => setSheet(null);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <HeardAboutSheet visible={sheet === "heard"} onDone={close} />
      <RatingSheet visible={sheet === "rating"} saves={saves} screen={screenRef.current} onDone={close} />
      <FeedbackSheet visible={sheet === "feedback"} screen={screenRef.current} onDone={close} />
    </FeedbackContext.Provider>
  );
}

/* ── Shared frame ───────────────────────────────────────────────────────────── */

function Frame({
  visible,
  onDismiss,
  icon,
  title,
  message,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  children: ReactNode;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <Pressable style={styles.overlay} onPress={onDismiss}>
          <Pressable style={styles.card} onPress={() => undefined}>
            <ScrollView contentContainerStyle={styles.cardContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={[styles.medallion, { backgroundColor: c.accentSoft }]}>
                <Ionicons name={icon} size={26} color={c.accent} />
              </View>
              <Text style={styles.title}>{title}</Text>
              {message ? <Text style={styles.message}>{message}</Text> : null}
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── Where did you hear about us? ───────────────────────────────────────────── */

function HeardAboutSheet({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [source, setSource] = useState<HeardAboutSource | null>(null);
  const [detail, setDetail] = useState("");
  const [sending, setSending] = useState(false);

  const submit = () => {
    if (!source) return;
    setSending(true);
    feedbackApi
      .submit({ kind: "heard_about", source, message: detail.trim() || undefined, client: "app", appVersion })
      .catch(() => undefined) // a lost answer is asked again next session; nothing to show the user
      .finally(() => {
        setSending(false);
        void logEvent("heard_about_answered", { source });
        onDone();
      });
  };

  return (
    // Skipping is allowed: closing without an answer simply asks again next session.
    <Frame visible={visible} onDismiss={onDone} icon="megaphone-outline" title="How did you hear about us?" message="One quick question — it helps us reach more choirs.">
      <View style={styles.chips}>
        {SOURCES.map((s) => {
          const on = source === s.value;
          return (
            <Pressable
              key={s.value}
              onPress={() => {
                haptics.play("light");
                setSource(s.value);
              }}
              style={[styles.chip, on && { borderColor: c.accent, backgroundColor: c.accentSoft }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={s.icon} size={15} color={on ? c.accent : c.textMuted} />
              <Text style={[styles.chipText, on && { color: c.accent }]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {source === "other" || source === "friend" || source === "church" ? (
        <TextInput
          value={detail}
          onChangeText={setDetail}
          placeholder={source === "other" ? "Where? (optional)" : "Anything to add? (optional)"}
          placeholderTextColor={c.textFaint}
          maxLength={200}
          style={styles.input}
        />
      ) : null}
      <View style={styles.actions}>
        <Button label="Send" onPress={submit} disabled={!source} loading={sending} />
        <Button label="Skip" variant="ghost" onPress={onDone} />
      </View>
    </Frame>
  );
}

/* ── Rating ─────────────────────────────────────────────────────────────────── */

function RatingSheet({
  visible,
  saves,
  screen,
  onDone,
}: {
  visible: boolean;
  saves: number;
  screen: string;
  onDone: () => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (visible) {
      setStars(0);
      setComment("");
      setSent(false);
    }
  }, [visible]);

  const notNow = () => {
    if (!sent) {
      void rating.snooze();
      feedbackApi.submit({ kind: "rating_dismissed", client: "app", appVersion, screen }).catch(() => undefined);
      void logEvent("rating_prompt_dismissed");
    }
    onDone();
  };

  const submit = () => {
    if (stars === 0) return;
    setSending(true);
    void rating.markRated();
    feedbackApi
      .submit({ kind: "rating", rating: stars, message: comment.trim() || undefined, client: "app", appVersion, screen })
      .catch(() => undefined)
      .finally(() => {
        setSending(false);
        setSent(true);
        void logEvent("rating_submitted", { rating: stars });
        // A low rating is a conversation, not a store review: thank them and close.
        if (stars < 4) onDone();
      });
  };

  const openStore = () => {
    void logEvent("rating_opened_store");
    void rating.rate();
    onDone();
  };

  if (sent && stars >= 4) {
    return (
      <Frame visible={visible} onDismiss={onDone} icon="heart-outline" title="Thank you!" message="Would you share that on Google Play? It helps other choirs find NoteFusion.">
        <View style={styles.actions}>
          <Button label="Rate on Google Play" icon="logo-google-playstore" onPress={openStore} />
          <Button label="Maybe later" variant="ghost" onPress={onDone} />
        </View>
      </Frame>
    );
  }

  return (
    <Frame visible={visible} onDismiss={notNow} icon="star-outline" title="Enjoying NoteFusion?" message={`Saved — that's ${saves} sheets in your library. How would you rate the app so far?`}>
      <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`${stars} of 5 stars`}>
        {[1, 2, 3, 4, 5].map((s) => (
          <Pressable
            key={s}
            hitSlop={6}
            onPress={() => {
              haptics.play("light");
              setStars(s);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${s} star${s === 1 ? "" : "s"}`}
          >
            <Ionicons name={s <= stars ? "star" : "star-outline"} size={36} color={s <= stars ? c.premium : c.textFaint} />
          </Pressable>
        ))}
      </View>
      {stars > 0 && stars < 4 ? (
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="What could be better? (optional)"
          placeholderTextColor={c.textFaint}
          multiline
          maxLength={2000}
          style={[styles.input, styles.multiline]}
        />
      ) : null}
      <View style={styles.actions}>
        <Button label="Submit" onPress={submit} disabled={stars === 0} loading={sending} />
        <Button label="Not now" variant="ghost" onPress={notNow} />
      </View>
    </Frame>
  );
}

/* ── Feedback form ──────────────────────────────────────────────────────────── */

function FeedbackSheet({ visible, screen, onDone }: { visible: boolean; screen: string; onDone: () => void }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  useEffect(() => {
    if (visible) {
      setMessage("");
      setState("idle");
    }
  }, [visible]);

  const submit = () => {
    if (!message.trim()) return;
    setState("sending");
    feedbackApi
      .submit({ kind: "feedback", category, message: message.trim(), client: "app", appVersion, screen })
      .then(() => {
        setState("sent");
        void logEvent("feedback_sent", { category });
      })
      .catch(() => setState("failed"));
  };

  if (state === "sent") {
    return (
      <Frame visible={visible} onDismiss={onDone} icon="checkmark-circle-outline" title="Thanks — we read every one" message="If you asked us something, we'll reply to your account's email.">
        <View style={styles.actions}>
          <Button label="Done" onPress={onDone} />
        </View>
      </Frame>
    );
  }

  return (
    <Frame visible={visible} onDismiss={onDone} icon="chatbubble-ellipses-outline" title="Send feedback" message="Tell us what's working, what isn't, or what you'd love to see.">
      <View style={styles.chips}>
        {CATEGORIES.map((cat) => {
          const on = category === cat.value;
          return (
            <Pressable
              key={cat.value}
              onPress={() => setCategory(cat.value)}
              style={[styles.chip, on && { borderColor: c.accent, backgroundColor: c.accentSoft }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && { color: c.accent }]}>{cat.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="Your message"
        placeholderTextColor={c.textFaint}
        multiline
        maxLength={2000}
        style={[styles.input, styles.multiline]}
        autoFocus
      />
      {state === "failed" ? <Text style={styles.error}>That didn't send. Check your connection and try again.</Text> : null}
      <View style={styles.actions}>
        <Button label="Send" onPress={submit} disabled={!message.trim()} loading={state === "sending"} />
        <Button label="Cancel" variant="ghost" onPress={onDone} />
      </View>
    </Frame>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    overlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      maxHeight: "88%",
      backgroundColor: c.bgElevated,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardContent: {
      paddingTop: spacing.xl,
      paddingBottom: spacing.lg,
      paddingHorizontal: spacing.xl,
      alignItems: "center",
    },
    medallion: {
      width: 56,
      height: 56,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.md,
    },
    title: {
      fontSize: 20,
      fontFamily: fonts.display,
      color: c.text,
      textAlign: "center",
      letterSpacing: -0.3,
    },
    message: {
      ...typography.body,
      color: c.textMuted,
      textAlign: "center",
      lineHeight: 22,
      marginTop: spacing.sm,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: spacing.sm,
      marginTop: spacing.lg,
      alignSelf: "stretch",
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    chipText: { ...typography.caption, color: c.text },
    stars: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
    input: {
      ...typography.body,
      alignSelf: "stretch",
      marginTop: spacing.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      color: c.text,
    },
    multiline: { minHeight: 110, textAlignVertical: "top" },
    error: { ...typography.caption, color: c.danger, marginTop: spacing.sm, textAlign: "center" },
    actions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.xl },
  });
