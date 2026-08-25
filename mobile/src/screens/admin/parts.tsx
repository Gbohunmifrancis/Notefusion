/**
 * The pieces every admin screen needs. Four screens read from paged, filtered
 * lists of money-shaped rows, and none of that vocabulary exists anywhere else in
 * the app — so it lives here rather than being spelled out four times or pushed
 * into `components/`, where it would sit beside primitives a customer can see.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Touchable } from "../../components/Touchable";
import { toApiError } from "../../api/client";
import {
  fonts,
  radii,
  spacing,
  typography,
  type Palette,
} from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import type {
  AdminPaymentStatus,
  AdminWebhookStatus,
  PagedResult,
} from "../../api/types";

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Parses a server timestamp as UTC.
 *
 * Every field here is named `...Utc`, but whether the JSON carries a `Z` depends
 * on the `DateTime.Kind` EF handed back — and `new Date()` reads a string without
 * one as *local time*, silently shifting it by the device's offset. On screens
 * whose whole question is "how long has this been stuck", that is the difference
 * between fine and hours overdue.
 */
export function parseUtc(iso: string): Date {
  return new Date(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
}

/** Date and clock time, in the operator's own timezone. */
export function dateTime(iso: string): string {
  const d = parseUtc(iso);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

/** How long ago, coarsely. For "this has been sitting there" rather than a log. */
export function ago(iso: string): string {
  const mins = Math.max(
    0,
    Math.round((Date.now() - parseUtc(iso).getTime()) / 60_000),
  );
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Minor units to a readable amount. `amountMinor` is a `long` end to end and
 * never a float, so the only division happens here, at the point of display.
 *
 * Two decimals unconditionally: the product prices in USD and the providers
 * settle in NGN, both hundredth-unit currencies, so an exponent lookup would be
 * speculative for a currency nothing charges in.
 */
export function money(minor: number, currency: string): string {
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${currency} ${whole}.${String(abs % 100).padStart(2, "0")}`;
}

// ─── Status tones ────────────────────────────────────────────────────────────

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

/**
 * A payment status' colour.
 *
 * `Failed` is deliberately *not* red. A declined card is an ordinary terminal
 * outcome that needs nobody, and painting every one of them alarming buries the
 * row that does. The danger colour goes to `Verified` instead — money taken, no
 * subscription written, and the sweep does not touch it — because that is the
 * status somebody has to act on.
 */
export function paymentTone(status: AdminPaymentStatus): Tone {
  switch (status) {
    case "Completed":
      return "good";
    case "Verified":
      return "bad";
    case "Processing":
      return "warn";
    case "Failed":
      return "muted";
    default:
      return "info"; // Pending — a checkout nobody has finished yet.
  }
}

export function webhookTone(status: AdminWebhookStatus): Tone {
  switch (status) {
    case "Processed":
      return "good";
    case "Failed":
      return "bad";
    default:
      return "warn"; // Received — waiting to drain.
  }
}

function toneColor(tone: Tone, c: Palette): string {
  switch (tone) {
    case "good":
      return c.success;
    case "warn":
      return c.warning;
    case "bad":
      return c.danger;
    case "info":
      return c.accent;
    default:
      return c.textMuted;
  }
}

// ─── Chrome ──────────────────────────────────────────────────────────────────

/**
 * The pushed-screen header, matching `HelpScreen`'s: a back circle, an uppercase
 * eyebrow, and the title. `right` takes one control — a refresh, usually.
 */
export function AdminHeader({
  label,
  title,
  onBack,
  right,
}: {
  label: string;
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.headerRow}>
      <Touchable
        onPress={onBack}
        accessibilityLabel="Go back"
        hitSlop={8}
        ripple="borderless"
      >
        <View style={styles.backCircle}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </View>
      </Touchable>

      <View style={styles.titleBlock}>
        <Text style={styles.titleLabel}>{label}</Text>
        <Text style={styles.titleMain} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {right}
    </View>
  );
}

/** A small refresh control for a header's `right` slot. */
export function RefreshButton({
  onPress,
  busy,
}: {
  onPress: () => void;
  busy: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Touchable
      onPress={onPress}
      disabled={busy}
      accessibilityLabel="Refresh"
      hitSlop={8}
      ripple="borderless"
    >
      <View style={styles.backCircle}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Ionicons name="refresh" size={18} color={colors.text} />
        )}
      </View>
    </Touchable>
  );
}

/** The enum member's name, as a coloured badge. */
export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const color = toneColor(tone, colors);

  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

/** A filter chip. Same geometry as the library's tabs, so the app reads as one. */
export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Touchable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      radius={radii.pill}
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filter: ${label}`}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Touchable>
  );
}

/** The pill search field. */
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.searchBar}>
      <Ionicons
        name="search-outline"
        size={18}
        color={colors.textFaint}
        style={styles.searchIcon}
      />
      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        textAlignVertical="center"
      />
    </View>
  );
}

/** A label/value line. `mono` for a reference an operator will want to select. */
export function Field({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  tone?: Tone;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text
        style={[
          styles.fieldValue,
          mono && styles.fieldValueMono,
          tone && { color: toneColor(tone, colors) },
        ]}
        selectable={mono}
      >
        {value ?? "—"}
      </Text>
    </View>
  );
}

/** A number with its name under it. The unit of every summary block. */
export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.stat}>
      <Text
        style={[styles.statValue, tone && { color: toneColor(tone, colors) }]}
      >
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

/** A titled block inside a screen. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/**
 * The detail sheet. Slides up over the list rather than pushing a route: the
 * lists are filtered and paged, and a push would drop the operator back at an
 * unscrolled page one every time they closed a row.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* Swallows taps on the sheet so they don't reach the dismissing backdrop. */}
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {title}
            </Text>
            <Touchable
              onPress={onClose}
              accessibilityLabel="Close"
              hitSlop={8}
              ripple="borderless"
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Touchable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.sheetBody}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A provider payload or a stack trace — long, wrapped, and selectable. */
export function RawBlock({ text }: { text: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.raw}>
      <Text style={styles.rawText} selectable>
        {text}
      </Text>
    </View>
  );
}

/** What a list shows instead of rows. One component so all four agree. */
export function ListState({
  loading,
  error,
  emptyIcon,
  emptyTitle,
  emptyHint,
}: {
  loading: boolean;
  error: string | null;
  emptyIcon: keyof typeof Ionicons.glyphMap;
  emptyTitle: string;
  emptyHint: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  if (loading) {
    return (
      <View style={styles.listState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.listState}>
      <Ionicons
        name={error ? "alert-circle-outline" : emptyIcon}
        size={38}
        color={error ? colors.danger : colors.textFaint}
      />
      <Text style={styles.emptyTitle}>{error ? "Couldn't load" : emptyTitle}</Text>
      <Text style={styles.emptyHint}>{error ?? emptyHint}</Text>
    </View>
  );
}

// ─── Data ────────────────────────────────────────────────────────────────────

/** The value, settled. Keeps a search box from firing a request per keystroke. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export interface PagedList<T> {
  items: T[];
  /** First page of a new filter. `refreshing` and `loadingMore` are separate so
   *  a pull-to-refresh does not blank the rows already on screen. */
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  total: number;
  refresh: () => void;
  loadMore: () => void;
}

/**
 * Reads one `PagedResult` endpoint as an append-on-scroll list. Re-fetches page
 * one whenever `deps` change, which is how a filter or a settled search term
 * takes effect.
 *
 * The generation counter is the part that matters: typing in a search box fires a
 * request per settled keystroke and they do not come back in order, so without it
 * a slow early response can land after a fast later one and show results for a
 * query the operator has already moved off.
 */
export function usePagedList<T>(
  load: (page: number) => Promise<PagedResult<T>>,
  deps: React.DependencyList,
): PagedList<T> {
  // Held in a ref so a fresh closure per render does not itself trigger a fetch;
  // `deps` alone decides when the filter has really changed.
  const loadRef = useRef(load);
  loadRef.current = load;

  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);

  const fetchPage = useCallback(
    async (target: number, mode: "first" | "refresh" | "more") => {
      const gen = ++generation.current;
      if (mode === "more") setLoadingMore(true);
      else if (mode === "refresh") setRefreshing(true);
      else setLoading(true);

      try {
        const res = await loadRef.current(target);
        if (gen !== generation.current) return;
        setItems((prev) => (mode === "more" ? [...prev, ...res.items] : res.items));
        setPage(res.page);
        setTotalPages(res.totalPages);
        setTotal(res.totalCount);
        setError(null);
      } catch (e) {
        if (gen !== generation.current) return;
        setError(toApiError(e).message);
        // A failed "load more" keeps what is already on screen; a failed first
        // page has nothing to keep.
        if (mode !== "more") setItems([]);
      } finally {
        if (gen === generation.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void fetchPage(1, "first");
  }, deps);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    total,
    refresh: () => void fetchPage(1, "refresh"),
    loadMore: () => {
      if (loading || refreshing || loadingMore) return;
      if (page >= totalPages) return;
      void fetchPage(page + 1, "more");
    },
  };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // ── Header ──────────────────────────────────────────────────────────────
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
    },
    backCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    titleBlock: {
      flex: 1,
      marginHorizontal: spacing.md,
    },
    titleLabel: {
      ...typography.caption,
      color: c.textFaint,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontSize: 10,
    },
    titleMain: {
      ...typography.title,
      color: c.text,
      fontSize: 22,
      letterSpacing: -0.4,
      marginTop: 1,
    },

    // ── Status pill ─────────────────────────────────────────────────────────
    pill: {
      borderRadius: radii.pill,
      borderWidth: 1,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    pillText: {
      fontSize: 10,
      fontFamily: fonts.bold,
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },

    // ── Filter chips ────────────────────────────────────────────────────────
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: radii.pill,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    /** `ink`, not `accent`: a fill carrying white text has to stay dark in both
     *  modes — the same reason the library's tabs use it. */
    chipActive: {
      backgroundColor: c.ink,
      borderColor: c.ink,
    },
    chipText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: c.textMuted,
    },
    chipTextActive: {
      color: c.onInk,
      fontFamily: fonts.bold,
    },

    // ── Search ──────────────────────────────────────────────────────────────
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      height: 46,
    },
    searchIcon: {
      marginRight: spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: c.text,
      height: "100%",
      paddingVertical: 0,
    },

    // ── Fields and stats ────────────────────────────────────────────────────
    field: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: spacing.xs + 2,
      gap: spacing.md,
    },
    fieldLabel: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 12,
      width: 116,
    },
    fieldValue: {
      ...typography.body,
      color: c.text,
      fontSize: 13,
      flex: 1,
    },
    fieldValueMono: {
      ...typography.mono,
      fontSize: 12,
      color: c.text,
    },

    stat: {
      flex: 1,
      minWidth: 74,
    },
    statValue: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: c.text,
      letterSpacing: -0.5,
    },
    statLabel: {
      fontSize: 11,
      fontFamily: fonts.medium,
      color: c.textMuted,
      marginTop: 1,
    },
    statHint: {
      fontSize: 10,
      fontFamily: fonts.regular,
      color: c.textFaint,
      marginTop: 2,
    },

    sectionTitle: {
      ...typography.caption,
      color: c.textFaint,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontSize: 10,
      marginBottom: spacing.sm,
      marginTop: spacing.lg,
    },

    // ── Sheet ───────────────────────────────────────────────────────────────
    overlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: c.bgElevated,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      borderTopWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      // Capped so a long payload scrolls inside the sheet instead of pushing it
      // off the top of the screen.
      maxHeight: "88%",
    },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginBottom: spacing.md,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    sheetTitle: {
      ...typography.heading,
      color: c.text,
      fontSize: 16,
      flex: 1,
    },
    sheetBody: {
      paddingTop: spacing.md,
      paddingBottom: spacing.xxl,
    },

    raw: {
      backgroundColor: c.surfaceAlt,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      marginTop: spacing.xs,
    },
    rawText: {
      ...typography.mono,
      fontSize: 11,
      lineHeight: 16,
      color: c.textMuted,
    },

    // ── Empty / error / loading ─────────────────────────────────────────────
    listState: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.xxl,
    },
    emptyTitle: {
      fontSize: 16,
      fontFamily: fonts.bold,
      color: c.text,
      marginTop: spacing.md,
    },
    emptyHint: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: 2,
      textAlign: "center",
    },
  });
