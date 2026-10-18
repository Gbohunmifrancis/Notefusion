import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Constants from "expo-constants";

import { feedbackApi, type FeedbackCategory, type HeardAboutSource } from "../api/endpoints";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ProblemNote } from "../components/ProblemNote";
import { Sheet, SheetActions, SheetMessage, SheetTitle } from "../components/Sheet";
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

/** Words only: an icon (or a brand's logo) on each chip would say nothing the word does not. */
const SOURCES: { value: HeardAboutSource; label: string }[] = [
  { value: "friend", label: "Friend or family" },
  { value: "church", label: "Church or choir" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
  { value: "x", label: "X (Twitter)" },
  { value: "google", label: "Google search" },
  { value: "play_store", label: "Play Store" },
  { value: "other", label: "Somewhere else" },
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

/** The bottom sheet every ask here is drawn on: title, a line, the controls, the action row. */
function Frame({
  visible,
  onDismiss,
  title,
  message,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  message?: string;
  children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onDismiss} avoidKeyboard>
      <SheetTitle>{title}</SheetTitle>
      <ScrollView
        style={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {message ? <SheetMessage>{message}</SheetMessage> : null}
        {children}
      </ScrollView>
    </Sheet>
  );
}

/** A chip you tap: 36 px, with a 44 px touch target. */
function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={() => {
        haptics.play("light");
        onPress();
      }}
      hitSlop={4}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.chipPressed]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/* ── Where did you hear about us? ───────────────────────────────────────────── */

/** The sources that ask for a word more; every other one is answered by the tap itself. */
const WITH_DETAIL: readonly HeardAboutSource[] = ["other", "friend", "church"];

function HeardAboutSheet({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const [source, setSource] = useState<HeardAboutSource | null>(null);
  const [detail, setDetail] = useState("");
  const [sending, setSending] = useState(false);
  const wantsDetail = source !== null && WITH_DETAIL.includes(source);

  const submit = (answer: HeardAboutSource) => {
    setSending(true);
    feedbackApi
      .submit({ kind: "heard_about", source: answer, message: detail.trim() || undefined, client: "app", appVersion })
      .catch(() => undefined) // a lost answer is asked again next session; nothing to show the user
      .finally(() => {
        setSending(false);
        void logEvent("heard_about_answered", { source: answer });
        onDone();
      });
  };

  return (
    // Skipping is allowed: closing without an answer simply asks again next session.
    <Frame visible={visible} onDismiss={onDone} title="How did you hear about us?" message="One quick question — it helps us reach more choirs.">
      <View style={styles.chips}>
        {SOURCES.map((s) => (
          <Chip
            key={s.value}
            label={s.label}
            on={source === s.value}
            onPress={() => {
              setSource(s.value);
              // One tap answers it, unless this source has a word more to say.
              if (!WITH_DETAIL.includes(s.value) && !sending) submit(s.value);
            }}
          />
        ))}
      </View>
      {wantsDetail ? (
        <TextInput
          value={detail}
          onChangeText={setDetail}
          placeholder={source === "other" ? "Where? (optional)" : "Anything to add? (optional)"}
          placeholderTextColor={c.textFaint}
          maxLength={200}
          style={styles.input}
        />
      ) : null}
      <SheetActions style={styles.actions}>
        <Button label="Skip" variant="text" onPress={onDone} />
        {wantsDetail && source ? <Button label="Send" onPress={() => submit(source)} loading={sending} /> : null}
      </SheetActions>
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
      <Frame visible={visible} onDismiss={onDone} title="Thank you!" message="Would you share that on Google Play? It helps other choirs find NoteFusion.">
        <SheetActions>
          <Button label="Maybe later" variant="text" onPress={onDone} />
          <Button label="Rate on Google Play" onPress={openStore} />
        </SheetActions>
      </Frame>
    );
  }

  return (
    <Frame visible={visible} onDismiss={notNow} title="Enjoying NoteFusion?" message={`Saved — that's ${saves} sheets in your library. How would you rate the app so far?`}>
      {/* Blue, not gold: gold is Pro's. */}
      <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`${stars} of 5 stars`}>
        {[1, 2, 3, 4, 5].map((s) => (
          <Pressable
            key={s}
            hitSlop={4}
            onPress={() => {
              haptics.play("light");
              setStars(s);
            }}
            style={styles.star}
            accessibilityRole="button"
            accessibilityLabel={`${s} star${s === 1 ? "" : "s"}`}
          >
            <Icon name="rate" size={34} filled={s <= stars} color={s <= stars ? c.link : c.textFaint} />
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
      <SheetActions style={styles.actions}>
        <Button label="Not now" variant="text" onPress={notNow} />
        <Button label="Send" onPress={submit} disabled={stars === 0} loading={sending} />
      </SheetActions>
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
      <Frame visible={visible} onDismiss={onDone} title="Thanks — we read every one" message="If you asked us something, we'll reply to your account's email.">
        <SheetActions>
          <Button label="Done" variant="secondary" onPress={onDone} />
        </SheetActions>
      </Frame>
    );
  }

  return (
    <Frame visible={visible} onDismiss={onDone} title="Send feedback" message="Tell us what's working, what isn't, or what you'd love to see.">
      <View style={styles.chips}>
        {CATEGORIES.map((cat) => (
          <Chip key={cat.value} label={cat.label} on={category === cat.value} onPress={() => setCategory(cat.value)} />
        ))}
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
      {state === "failed" ? <ProblemNote>That didn't send. Check your connection and try again.</ProblemNote> : null}
      <SheetActions style={styles.actions}>
        <Button label="Cancel" variant="text" onPress={onDone} />
        <Button label="Send" onPress={submit} disabled={!message.trim()} loading={state === "sending"} />
      </SheetActions>
    </Frame>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: { flexGrow: 0 },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 36,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    chipOn: { borderColor: c.primary, backgroundColor: c.accentSoft },
    chipPressed: { opacity: 0.8 },
    chipText: { fontFamily: fonts.medium, fontSize: 13.5, color: c.text },
    chipTextOn: { color: c.link },
    stars: { flexDirection: "row", gap: spacing.xs, marginTop: -spacing.xs },
    star: { padding: 4 },
    input: {
      ...typography.body,
      fontSize: 16,
      marginTop: spacing.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
      color: c.text,
    },
    multiline: { minHeight: 110, textAlignVertical: "top" },
    actions: { marginTop: spacing.xl },
  });
