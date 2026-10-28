/**
 * The song a link resolved to: its artwork as a cover with the title and artist set on it,
 * the service and the length as tags — so the person sees they have the right song before
 * anything is spent. Without artwork it falls back to a plain row with the service's mark.
 */

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { ProviderMark } from "./SourceTiles";
import { formatClock } from "../../lib/clipRange";
import { fonts, nightFonts, spacing, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";
import type { SongProvider } from "../../lib/songLink";
import type { LinkInfo } from "../../api/types";
import { useDataSaver } from "../../lib/dataSaver";
import { loadsImages } from "../../lib/dataPolicy";

export const PROVIDER_LABEL = { youtube: "YouTube", spotify: "Spotify", apple_music: "Apple Music", instagram: "Instagram", tiktok: "TikTok" } as const;

/**
 * The shade over the artwork that keeps white text readable. Artwork can be any colour in
 * either theme, so this is a property of the photo, not of the palette.
 */
const PHOTO_SHADE = ["rgba(0,0,0,0)", "rgba(0,0,0,0.68)"] as const;
/** The source and length tags' fill: white 12 px words keep 5.74:1 even over white artwork (0.45 gave 3.35). */
const PHOTO_TAG = "rgba(0,0,0,0.6)";

export function SongCover({
  song,
  provider,
  duration,
}: {
  song: LinkInfo;
  provider: SongProvider;
  duration: number | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const length = duration != null ? formatClock(duration) : null;

  // Data saver: the artwork is decoration, so the plain row stands in for it.
  const dataSaver = useDataSaver();
  if (!song.thumbnailUrl || !loadsImages(dataSaver)) {
    return (
      <View style={styles.row}>
        <ProviderMark provider={provider} size={56} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={2}>{song.title}</Text>
          {song.artist ? <Text style={styles.rowArtist} numberOfLines={1}>{song.artist}</Text> : null}
          <Text style={styles.rowMeta}>
            {PROVIDER_LABEL[provider]} · {length ?? "length not known"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={styles.cover}
      accessible
      accessibilityLabel={`${song.title}${song.artist ? ` by ${song.artist}` : ""}, from ${PROVIDER_LABEL[provider]}${length ? `, ${length} long` : ""}`}
    >
      <Image source={{ uri: song.thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient colors={PHOTO_SHADE} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
      <View style={[styles.tag, styles.tagLeft]}>
        <ProviderMark provider={provider} size={16} />
        <Text style={styles.tagText}>{PROVIDER_LABEL[provider]}</Text>
      </View>
      {length ? (
        <View style={[styles.tag, styles.tagRight]}>
          <Text style={styles.tagMono}>{length}</Text>
        </View>
      ) : null}
      <View style={styles.caption}>
        <Text style={styles.title} numberOfLines={2}>{song.title}</Text>
        {song.artist ? <Text style={styles.artist} numberOfLines={1}>{song.artist}</Text> : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    cover: { height: 196, borderRadius: 24, overflow: "hidden", backgroundColor: c.surfaceAlt, marginTop: spacing.lg },
    tag: {
      position: "absolute", top: 12, height: 28, paddingHorizontal: 10, borderRadius: 14,
      flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: PHOTO_TAG,
    },
    tagLeft: { left: 12 },
    tagRight: { right: 12 },
    tagText: { fontFamily: fonts.medium, fontSize: 12, color: c.onInk },
    tagMono: { fontFamily: nightFonts.mono, fontSize: 12, color: c.onInk },
    caption: { position: "absolute", left: 16, right: 16, bottom: 14 },
    title: { fontFamily: fonts.semibold, fontSize: 22, letterSpacing: -0.7, color: c.onInk },
    artist: { fontFamily: fonts.regular, fontSize: 13, color: c.onInk, opacity: 0.85, marginTop: 2 },
    row: {
      flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.lg,
      padding: 14, borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    },
    rowText: { flex: 1 },
    rowTitle: { fontFamily: fonts.semibold, fontSize: 16, color: c.text },
    rowArtist: { fontFamily: fonts.regular, fontSize: 13, color: c.textMuted, marginTop: 2 },
    rowMeta: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint, marginTop: 4 },
  });
