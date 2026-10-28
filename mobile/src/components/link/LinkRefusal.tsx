/**
 * A link that can't be used, said calmly. The sentence is always the API's own plain one
 * (`TranscriptionErrors.ForLink`, read through `toApiError`); this file only adds a heading
 * and an icon for the codes it knows, and the short list of links that never work, so
 * the person knows what to try instead.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "../Icon";

import { fonts, spacing, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";

/** The link refusals the API names, as the screen titles them. */
const REFUSALS: Record<string, { title: string; icon: IconName }> = {
  TRANS_LINK_LIVE: { title: "That's a live stream", icon: "live" },
  TRANS_LINK_UNAVAILABLE: { title: "That video can't be fetched", icon: "video-off" },
  TRANS_LINK_NOT_FOUND: { title: "No video at that link", icon: "not-found" },
  TRANS_LINK_TOO_LONG: { title: "That video is too long", icon: "too-long" },
  TRANS_LINK_REFUSED: { title: "YouTube said no for now", icon: "later" },
  TRANS_LINK_POST_REFUSED: { title: "That video is for signed-in viewers", icon: "later" },
  TRANS_INVALID_LINK: { title: "That isn't a song link", icon: "link-off" },
};

/** Heading and icon for a link the API turned away; null for any other failure. */
export function linkRefusal(code: string | null | undefined): { title: string; icon: IconName } | null {
  return (code && REFUSALS[code]) || null;
}

const NEVER = [
  { what: "Live streams and premieres", why: "There's no fixed song to cut a part from." },
  { what: "Private or removed videos", why: "We can only fetch what anyone can watch." },
  { what: "Videos over the length limit", why: "Upload the song's audio file instead." },
  { what: "Playlists, channels and albums", why: "Share the song itself and paste that link." },
];

/**
 * An icon, a heading, the plain sentence, and what to do next. The icon names what happened on a neutral tile;
 * only the alert sign is amber and only Pro's crown gold. The next steps are the shared Button (board n-ux-low Q5e):
 * the one to take `secondary` and `sm`, the other a `text` button, so nothing in the card reads as a second primary.
 */
export function NoticeCard({
  icon,
  title,
  message,
  children,
}: {
  icon: IconName;
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={[styles.iconTile, icon === "pro" && { backgroundColor: colors.premiumSoft }]}>
        <Icon
          name={icon}
          size={22}
          color={icon === "problem" ? colors.warning : icon === "pro" ? colors.premium : colors.icon}
        />
      </View>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

/** The links that never work, so a refusal doesn't read as the app being broken. */
export function RefusedLinks() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.list}>
      <Text style={styles.eyebrow}>Links we can't use</Text>
      {NEVER.map((n, i) => (
        <View key={n.what} style={[styles.item, i > 0 && styles.itemRule]}>
          <View style={styles.dot} />
          <View style={styles.itemText}>
            <Text style={styles.what}>{n.what}</Text>
            <Text style={styles.why}>{n.why}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      marginTop: spacing.lg, padding: 20, borderRadius: 24,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    },
    iconTile: {
      width: 44, height: 44, borderRadius: 14, backgroundColor: c.sheetTile,
      alignItems: "center", justifyContent: "center",
    },
    title: { fontFamily: fonts.semibold, fontSize: 19, letterSpacing: -0.4, color: c.text, marginTop: 14 },
    message: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: c.textMuted, marginTop: 6 },
    actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
    list: { marginTop: 28 },
    eyebrow: {
      fontFamily: fonts.medium, fontSize: 12, letterSpacing: 1.7, textTransform: "uppercase",
      color: c.textMuted, marginBottom: spacing.xs,
    },
    item: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: 12 },
    itemRule: { borderTopWidth: 1, borderTopColor: c.border },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.warning, marginTop: 6 },
    itemText: { flex: 1 },
    what: { fontFamily: fonts.medium, fontSize: 14, color: c.text },
    why: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: c.textMuted, marginTop: 2 },
  });
