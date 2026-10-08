import React from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";

/**
 * The marks of the services a song link can come from, drawn as vector so they
 * stay crisp at any size and keep their own colours. Used where the app names
 * the sources (onboarding, the paste-a-link screen); they identify the service
 * a link is from and imply no endorsement.
 */

export function YouTubeLogo({ size = 54 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size * 0.6} height={size * 0.43} viewBox="0 0 28 20">
        <Rect width={28} height={20} rx={5.5} fill="#FF0033" />
        <Path d="M11.2 5.8v8.4l7.2-4.2z" fill="#FFFFFF" />
      </Svg>
    </View>
  );
}

export function YouTubeMusicLogo({ size = 54 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 42 42">
      <Circle cx={21} cy={21} r={21} fill="#FF0033" />
      <Circle cx={21} cy={21} r={11} fill="none" stroke="#FFFFFF" strokeWidth={2} />
      <Path d="M18.3 15.8v10.4l8.4-5.2z" fill="#FFFFFF" />
    </Svg>
  );
}

export function SpotifyLogo({ size = 54 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 42 42">
      <Circle cx={21} cy={21} r={21} fill="#1ED760" />
      <G fill="none" stroke="#0A0D14" strokeLinecap="round">
        <Path d="M11.5 16.5c6.5-2 13.5-1.5 19 1.7" strokeWidth={3} />
        <Path d="M12.5 22c5.5-1.6 11-1.1 15.8 1.5" strokeWidth={2.5} />
        <Path d="M13.5 27.2c4.4-1.2 8.7-.8 12.4 1.2" strokeWidth={2} />
      </G>
    </Svg>
  );
}

export function AppleMusicLogo({ size = 54 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 42 42">
      <Defs>
        <LinearGradient id="appleMusicFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF5C79" />
          <Stop offset="1" stopColor="#F9324F" />
        </LinearGradient>
      </Defs>
      <Rect width={42} height={42} rx={11} fill="url(#appleMusicFill)" />
      <Path d="M17 27.5V14.2l11-2.4v12.8" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinejoin="round" />
      <Ellipse cx={14.6} cy={27.8} rx={3.2} ry={2.7} fill="#FFFFFF" />
      <Ellipse cx={25.6} cy={25} rx={3.2} ry={2.7} fill="#FFFFFF" />
    </Svg>
  );
}
