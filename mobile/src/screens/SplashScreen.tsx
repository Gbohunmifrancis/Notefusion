import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  StatusBar,
  StyleSheet,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BrandMark } from "../components/BrandMark";
import { StaffRibbon } from "../components/StaffRibbon";
import { fonts } from "../design/theme";

const { width } = Dimensions.get("window");

/** Brand blue, deepening top-left → bottom-right as in the design sheet. */
const SPLASH_GRADIENT = ["#2F7CF6", "#1D6FF2", "#1257E8"] as const;

/**
 * SplashScreen — the branded hold shown while the app boots.
 *
 * A full-bleed brand-blue field with the mark, wordmark, and tagline stacked in
 * the centre and the staff ribbon washing across the bottom.
 *
 * Deliberately not themed: it is the same blue in light and dark mode because it
 * is the brand's first impression, and it renders before the stored theme
 * preference has been read — see `useAppReady`, which is what holds it on screen
 * and gives the animation below its full run on a first launch.
 *
 * The entrance is staged rather than simultaneous — mark, then wordmark, then
 * tagline — so the eye is led down the stack instead of everything arriving at
 * once and resolving into a static image.
 */
export function SplashScreen() {
  // ── Animation values ──────────────────────────────────────────────────────
  const markScale = useRef(new Animated.Value(0.82)).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const wordTranslateY = useRef(new Animated.Value(18)).current;
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const ribbonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      // 1. The mark settles in, slightly overshooting so it lands rather than
      //    simply appearing.
      Animated.parallel([
        Animated.timing(markOpacity, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(markScale, {
          toValue: 1,
          speed: 6,
          bounciness: 8,
          useNativeDriver: true,
        }),
      ]),

      // 2. Wordmark rises under it.
      Animated.parallel([
        Animated.timing(wordOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(wordTranslateY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),

      // 3. Tagline and the staff wash arrive together to close the composition.
      Animated.parallel([
        Animated.timing(tagOpacity, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ribbonOpacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [
    markOpacity,
    markScale,
    wordOpacity,
    wordTranslateY,
    tagOpacity,
    ribbonOpacity,
  ]);

  return (
    <View style={styles.root}>
      {/* Light status-bar content: the canvas below it is always deep blue. */}
      <StatusBar barStyle="light-content" />

      <LinearGradient
        colors={SPLASH_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fill}
      />

      {/* Soft diagonal sheen across the upper half, as in the design. */}
      <LinearGradient
        colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0.62 }}
        style={styles.fill}
      />

      <View style={styles.center}>
        <Animated.View
          style={{
            opacity: markOpacity,
            transform: [{ scale: markScale }],
          }}
        >
          <BrandMark
            size={150}
            color="#FFFFFF"
            waveColor="rgba(255,255,255,0.55)"
            showWaves
          />
        </Animated.View>

        <Animated.Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            styles.wordmark,
            {
              opacity: wordOpacity,
              transform: [{ translateY: wordTranslateY }],
            },
          ]}
        >
          Notefusion
        </Animated.Text>
 
         <Animated.Text style={[styles.tagline, { opacity: tagOpacity }]}>
           Hear it. See it. Notate it.
         </Animated.Text>
       </View>
 
       <Animated.View style={[styles.ribbon, { opacity: ribbonOpacity }]}>
         <StaffRibbon width={width} height={200} color="#FFFFFF" opacity={0.22} />
       </Animated.View>
     </View>
   );
 }
 
 const styles = StyleSheet.create({
   root: {
     flex: 1,
     backgroundColor: "#1D6FF2",
   },
 
   fill: {
     position: "absolute",
     top: 0,
     left: 0,
     right: 0,
     bottom: 0,
   },
 
   center: {
     flex: 1,
     alignItems: "center",
     justifyContent: "center",
     // Nudged up so the stack sits above the staff ribbon rather than over it.
     paddingBottom: 120,
     paddingHorizontal: 20,
   },
 
   wordmark: {
     marginTop: 24,
     fontSize: 36,
     fontFamily: fonts.bold,
     color: "#FFFFFF",
     letterSpacing: -0.2,
     textAlign: "center",
     includeFontPadding: false,
   },

  tagline: {
    marginTop: 10,
    fontSize: 17,
    fontFamily: fonts.medium,
    color: "rgba(255,255,255,0.92)",
  },

  ribbon: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
