/**
 * Where a song link can come from: the four services as their own marks, so someone
 * holding a Spotify link sees at a glance that it will do. YouTube Music has no provider
 * of its own — its links are youtube.com links (`lib/songLink`) — but people know it as a
 * separate app, so it gets its own mark.
 *
 * A picture, not four things to pick (board n-ux-low Q5d): one plain row of the marks with
 * their names under them, no card and no border; the Tip below says what to do.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppleMusicLogo, SpotifyLogo, YouTubeLogo, YouTubeMusicLogo } from "../SourceLogos";
import { fonts, spacing, type Palette } from "../../design/theme";
import { useThemedStyles } from "../../lib/theme";
import type { SongProvider } from "../../lib/songLink";

const SOURCES = [
  { name: "YouTube", Logo: YouTubeLogo },
  { name: "YouTube Music", Logo: YouTubeMusicLogo },
  { name: "Spotify", Logo: SpotifyLogo },
  { name: "Apple Music", Logo: AppleMusicLogo },
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
      style={styles.row}
      accessible
      accessibilityLabel="Works with YouTube, YouTube Music, Spotify and Apple Music"
    >
      {SOURCES.map(({ name, Logo }) => (
        <View key={name} style={styles.source}>
          <Logo size={42} />
          <Text style={styles.name}>{name}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md },
    // A quarter of the row each, so "YouTube Music" breaks under its own mark rather than pushing the others.
    source: { flexBasis: "25%", flexShrink: 1, alignItems: "center" },
    name: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, color: c.text, textAlign: "center", marginTop: spacing.sm },
  });
