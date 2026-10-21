import React, { useId } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { Touchable } from "../Touchable";
import { Mark } from "../night/NightUI";
import { useSubscription } from "../../lib/subscription";
import { fonts, radii, spacing, type Palette } from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import { tierOf } from "../../lib/planTier";

const RADIUS = 26;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "1 Nov". Built by hand because Hermes on Android can ignore `toLocaleDateString`'s options,
 * which would print a full locale date inside a line sized for two words.
 */
function shortDate(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The membership as a card worth keeping (board "07 · You"): the mark, the songs left as a ring and
 * the date Pro runs to. A free account gets the same footprint inviting the upgrade instead — Pro
 * accounts see their membership, free accounts the way to the plans, never the other way round.
 *
 * Says "Pro until", not "renews": nothing renews by itself here, a member buys again to add time.
 */
export function MembershipCard({ onPress }: { onPress: () => void }) {
  const { isPro, isGift, known, subscription, freeRemaining, freePerWeek, freeBack, boughtRemaining } = useSubscription();
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  const lifetime = isPro && (subscription?.isLifetime ?? false);
  const until =
    isPro && !lifetime && subscription?.currentPeriodEndUtc
      ? shortDate(subscription.currentPeriodEndUtc)
      : null;

  let period: string;
  let left: number | null = null;
  let total = 0;
  let caption: string;

  if (isPro) {
    period = lifetime ? "Lifetime" : isGift ? "Gift" : subscription ? tierOf(subscription) : "Pro";
    if (typeof subscription?.songCreditsRemaining === "number") {
      left = subscription.songCreditsRemaining;
      total = subscription.songCreditsTotal ?? 20;
      caption = lifetime
        ? "songs left this month"
        : until
          ? `songs left · Pro until ${until}`
          : "songs left";
    } else {
      caption = lifetime ? "Yours for good" : until ? `Pro until ${until}` : "Membership active";
    }
  } else {
    period = "Free plan";
    // The free count falls back to the full allowance while unknown; showing that as a fact
    // would be a guess, so the ring waits for the server's answer. The ring is this week's free
    // hums and recordings; bought songs, which never expire, ride in the caption.
    if (known) {
      left = Math.max(0, freeRemaining);
      total = freePerWeek;
      caption =
        (left > 0 ? `free this week · back ${freeBack}` : `Free ones back ${freeBack}`) +
        (boughtRemaining > 0 ? ` · ${boughtRemaining} bought` : "");
    } else {
      caption = "Whole songs, four-part harmony, every download";
    }
  }

  const a11y = isPro
    ? `Manage membership. ${period}${left !== null ? `, ${left} of ${total} songs left` : ""}${until ? `, Pro until ${until}` : ""}`
    : `See Pro plans${left !== null ? `. ${left} of ${total} free transcriptions left this week, back ${freeBack}` : ""}`;

  return (
    <View style={styles.glow}>
      <Touchable onPress={onPress} radius={RADIUS} accessibilityLabel={a11y}>
        <LinearGradient
          colors={[c.ink, c.purpleDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          {/* Deepens the lower corner. Black at low alpha rather than a palette blue: the Day palette's
              ink and purpleDark are the same blue, so without it the card would be flat there. */}
          <LinearGradient
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.38)"]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Sheen color={c.onInk} />
          <View style={styles.watermark} pointerEvents="none">
            <Mark height={190} color={c.onInk} />
          </View>

          <View style={styles.top}>
            <View style={styles.brand}>
              <Mark height={20} color={c.onInk} />
              {/* A free account's card is not headed Pro: its plan, "Free plan", is on the right. */}
              <Text style={styles.brandText}>{isPro ? "Notefusion Pro" : "Notefusion"}</Text>
            </View>
            <Text style={styles.period}>{period}</Text>
          </View>

          <View style={styles.body}>
            {left !== null && total > 0 ? (
              <>
                <Ring progress={left / total} color={c.onInk} />
                <View style={styles.flex}>
                  <Text style={styles.count}>
                    {left}
                    <Text style={styles.countOf}> / {total}</Text>
                  </Text>
                  <Text style={styles.caption}>{caption}</Text>
                </View>
              </>
            ) : (
              <Text style={[styles.caption, styles.flex]}>{caption}</Text>
            )}
            {!isPro && (
              <View style={styles.cta}>
                <Text style={styles.ctaText}>See plans</Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </Touchable>
    </View>
  );
}

/** Songs left as a ring, drawn from the top clockwise. */
function Ring({ progress, color }: { progress: number; color: string }) {
  const r = 27;
  const circ = 2 * Math.PI * r;
  const len = Math.min(1, Math.max(0, progress)) * circ;
  return (
    <Svg width={64} height={64} viewBox="0 0 64 64">
      <Circle cx={32} cy={32} r={r} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={6} />
      {/* A round cap on a zero-length arc still paints a dot, so an empty ring draws no arc. */}
      {len > 0 && (
        <Circle
          cx={32}
          cy={32}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${len} ${circ}`}
          transform="rotate(-90 32 32)"
        />
      )}
    </Svg>
  );
}

/** The soft light in the upper right of the card; RN has no radial gradient of its own. */
function Sheen({ color }: { color: string }) {
  // useId gives ":r1:"; colons are not safe inside an SVG url(#…) reference.
  const id = "sheen" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <RadialGradient id={id} cx="85%" cy="15%" r="65%">
          <Stop offset="0" stopColor={color} stopOpacity={0.22} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The one blue glow on the screen. On the outer view so the Touchable's clip cannot cut it off.
    glow: {
      borderRadius: RADIUS,
      backgroundColor: c.ink,
      shadowColor: c.ink,
      shadowOpacity: 0.35,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 14 },
      // Android 9+ tints an elevation shadow with shadowColor, so it glows blue there too.
      elevation: 8,
    },
    card: {
      borderRadius: RADIUS,
      padding: 22,
      overflow: "hidden",
    },
    watermark: {
      position: "absolute",
      right: -26,
      bottom: -40,
      opacity: 0.16,
    },
    top: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    brand: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    brandText: {
      fontSize: 16,
      fontFamily: fonts.semibold,
      letterSpacing: -0.3,
      color: c.onInk,
    },
    period: {
      fontSize: 12,
      fontFamily: fonts.medium,
      color: c.onInk,
      opacity: 0.8,
    },
    body: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.lg,
      marginTop: 30,
      minHeight: 64,
    },
    flex: {
      flex: 1,
    },
    count: {
      fontSize: 30,
      fontFamily: fonts.semibold,
      letterSpacing: -1.2,
      lineHeight: 32,
      color: c.onInk,
    },
    countOf: {
      fontSize: 16,
      letterSpacing: -0.3,
      opacity: 0.7,
    },
    // The key line under the count ("free this week · back Friday 6pm"): 14 px at full strength, 5.59:1 on the card's
    // blue (12.5 px at 80 % was 4.16:1), board n-ux-low Q5h.
    caption: {
      fontSize: 14,
      lineHeight: 19,
      fontFamily: fonts.regular,
      color: c.onInk,
      marginTop: 5,
    },
    cta: {
      backgroundColor: c.onInk,
      borderRadius: radii.pill,
      paddingHorizontal: 18,
      height: 40,
      justifyContent: "center",
    },
    ctaText: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: c.ink,
    },
  });
