/**
 * Where a song link can come from: the four services as their own marks, so someone
 * holding a Spotify link sees at a glance that it will do. YouTube Music has no provider
 * of its own — its links are youtube.com links (`lib/songLink`) — but people know it as a
 * separate app, so it gets its own tile.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppleMusicLogo, SpotifyLogo, YouTubeLogo, YouTubeMusicLogo } from "../SourceLogos";
import { fonts, spacing, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";
import type { SongProvider } from "../../lib/songLink";

const TILES = [
  { name: "YouTube", what: "Videos and Shorts", Logo: YouTubeLogo },
  { name: "YouTube Music", what: "Any song", Logo: YouTubeMusicLogo },
  { name: "Spotify", what: "Tracks", Logo: SpotifyLogo },
  { name: "Apple Music", what: "Songs", Logo: AppleMusicLogo },
] as const;

/** The mark of the service a link points at. */
export function ProviderMark({ provider, size }: { provider: SongProvider; size: number }) {
  if (provider === "spotify") return <SpotifyLogo size={size} />;
  if (provider === "apple_music") return <AppleMusicLogo size={size} />;
  return <YouTubeLogo size={size} />;
}

export function SourceTiles() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.grid}
      accessible
      accessibilityLabel="Works with YouTube, YouTube Music, Spotify and Apple Music"
    >
      {TILES.map(({ name, what, Logo }) => (
        <View key={name} style={styles.tile}>
          <Logo size={42} />
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.what}>{what}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: spacing.md },
    // Two to a row: just under half the width each, and flexGrow takes up what the gap leaves.
    tile: {
      flexBasis: "47%", flexGrow: 1, padding: 14, borderRadius: 18,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    },
    name: { fontFamily: fonts.semibold, fontSize: 14, color: c.text, marginTop: spacing.md },
    what: { fontFamily: fonts.regular, fontSize: 12, color: c.textMuted, marginTop: 2 },
  });
