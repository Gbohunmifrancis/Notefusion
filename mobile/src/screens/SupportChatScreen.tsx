/**
 * SupportChatScreen — "Chat with us": the account's one support thread (the same one the website and web app show),
 * answered by a person from the admin console.
 *
 * While the screen is open and the app in front, the thread's stream (`GET /api/support/events`) says `message` when
 * either side writes and the thread is read again; the API then pushes nothing, since the person is looking. Behind
 * or closed, an answer comes as a push (`data.screen` "SupportChat") that opens this screen. A stream that cannot be
 * held is replaced by a read every 15 s while the screen is open.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { baseURL, streamHeaders, toApiError } from "../api/client";
import { supportApi } from "../api/endpoints";
import type { SupportMessage, SupportThread } from "../api/types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Screen } from "../components/Screen";
import { Touchable } from "../components/Touchable";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { markSupportSeen } from "../lib/supportSeen";
import { SseParser } from "../lib/sse";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "SupportChat">;

const FALLBACK_MS = 15_000;

/** "14:05" today, "Mon 14:05" before. */
export function messageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.toLocaleDateString(undefined, { weekday: "short" })} ${hm}`;
}

export function SupportChatScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<SupportMessage>>(null);

  const read = useCallback(async () => {
    try {
      const next = await supportApi.thread();
      setThread(next);
      const last = next.messages[next.messages.length - 1];
      if (last) void markSupportSeen(last.createdAtUtc);
    } catch {
      // Kept as it was; the next event or read tries again.
    }
  }, []);

  // The stream while the screen is in focus and the app in front; a timed read when it cannot be held.
  useFocusEffect(
    useCallback(() => {
      let xhr: XMLHttpRequest | null = null;
      let fallback: ReturnType<typeof setInterval> | null = null;
      let stopped = false;

      const stop = () => {
        if (xhr) {
          xhr.onprogress = null;
          xhr.onreadystatechange = null;
          try { xhr.abort(); } catch { /* finished */ }
          xhr = null;
        }
        if (fallback) clearInterval(fallback);
        fallback = null;
      };
      const poll = () => { if (!fallback) fallback = setInterval(() => void read(), FALLBACK_MS); };

      const open = async () => {
        stop();
        if (stopped || AppState.currentState !== "active") return;
        await read();
        const headers = await streamHeaders().catch(() => ({} as Record<string, string>));
        if (stopped) return;
        const request = new XMLHttpRequest();
        xhr = request;
        const parser = new SseParser();
        let seen = 0;
        request.open("GET", `${baseURL}/api/support/events`);
        for (const [k, v] of Object.entries({ ...headers, Accept: "text/event-stream" })) request.setRequestHeader(k, v);
        request.onprogress = () => {
          const text = request.responseText ?? "";
          const events = parser.feed(text.slice(seen));
          seen = text.length;
          if (events.some((e) => e.event === "message")) void read();
        };
        request.onreadystatechange = () => {
          if (request.readyState !== 4 || xhr !== request) return;
          xhr = null;
          // Closed by the server after ten minutes: open again. Refused (no thread yet, too many open): read on a timer.
          if (request.status === 200) void open();
          else poll();
        };
        request.send();
      };

      void open();
      const sub = AppState.addEventListener("change", (state) => (state === "active" ? void open() : stop()));
      return () => {
        stopped = true;
        stop();
        sub.remove();
      };
    }, [read]),
  );

  useEffect(() => {
    if (thread?.messages.length) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false }));
  }, [thread?.messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await supportApi.send(body, "SupportChat");
      setDraft("");
      await read();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSending(false);
    }
  }

  const messages = thread?.messages ?? [];
  return (
    <Screen edges={["top", "bottom"]} contentStyle={styles.screen}>
      <View style={styles.header}>
        <Touchable onPress={() => navigation.goBack()} accessibilityLabel="Go back" hitSlop={8} ripple="borderless">
          <View style={styles.back}>
            <Icon name="back" size={20} color={colors.text} />
          </View>
        </Touchable>
        <View style={styles.titles}>
          <Text style={styles.title}>Chat with us</Text>
          <Text style={styles.subtitle}>A person from NoteFusion answers here, usually within a few hours.</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={messages.length ? styles.listContent : styles.emptyContent}
          ListEmptyComponent={
            thread ? (
              <View style={styles.hello}>
                <Icon name="chat" size={28} color={colors.textMuted} />
                <Text style={styles.helloText}>
                  Ask a question, or tell us what went wrong with a recording or a payment. We'll answer here and send you a
                  notification.
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.row, item.fromAdmin ? styles.rowThem : styles.rowMe]}>
              <View style={[styles.bubble, item.fromAdmin ? styles.bubbleThem : styles.bubbleMe]}>
                <Text style={item.fromAdmin ? styles.textThem : styles.textMe}>{item.body}</Text>
              </View>
              <Text style={styles.meta}>
                {item.fromAdmin && item.adminName ? `${item.adminName} · ` : ""}
                {messageTime(item.createdAtUtc)}
              </Text>
            </View>
          )}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            maxLength={2000}
            accessibilityLabel="Message"
          />
          <Button label="Send" icon="send" size="md" onPress={() => void send()} loading={sending} disabled={!draft.trim()} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, paddingHorizontal: 0 },
    header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceAlt },
    titles: { flex: 1 },
    title: { ...typography.title, color: c.text },
    subtitle: { ...typography.caption, color: c.textMuted },
    body: { flex: 1 },
    listContent: { padding: spacing.lg, gap: spacing.sm },
    emptyContent: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
    hello: { alignItems: "center", gap: spacing.md },
    helloText: { ...typography.body, color: c.textMuted, textAlign: "center" },
    row: { maxWidth: "84%", gap: 2 },
    rowMe: { alignSelf: "flex-end", alignItems: "flex-end" },
    rowThem: { alignSelf: "flex-start" },
    bubble: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.lg },
    bubbleMe: { backgroundColor: c.accent, borderBottomRightRadius: 4 },
    bubbleThem: { backgroundColor: c.surfaceAlt, borderBottomLeftRadius: 4 },
    textMe: { ...typography.body, color: "#fff" },
    textThem: { ...typography.body, color: c.text },
    meta: { fontFamily: fonts.regular, fontSize: 11, color: c.textMuted, marginHorizontal: 4 },
    error: { ...typography.caption, color: c.warningText, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
    composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    input: { flex: 1, minHeight: 44, maxHeight: 140, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radii.md, borderWidth: 1, borderColor: c.border, color: c.text, fontFamily: fonts.regular, fontSize: 16 },
  });
