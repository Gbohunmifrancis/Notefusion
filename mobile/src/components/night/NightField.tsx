import React, { forwardRef, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { Icon } from "../Icon";
import { night, nightFonts } from "../../design/theme";
import { SecretField, fillRow } from "../../lib/replayPrivacy";

interface Props extends Omit<TextInputProps, "style" | "placeholder" | "secureTextEntry"> {
  label: string;
  value: string;
  /** A password field: hidden by default, with an eye to show it. */
  secure?: boolean;
  /** One plain sentence under the field. Never server text. */
  error?: string;
}

/**
 * The floating-label field from the redesign: the label rests inside the field
 * like a placeholder and lifts to a small caption on focus or once there is a
 * value, so the field always says what it is for. The focused field is ringed
 * in blue.
 */
export const NightField = forwardRef<TextInput, Props>(function NightField(
  { label, value, secure = false, error, onFocus, onBlur, ...input },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const raised = focused || value.length > 0;
  const lift = useRef(new Animated.Value(raised ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(lift, {
      toValue: raised ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [raised, lift]);

  const labelStyle = {
    transform: [
      { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [11, 0] }) },
      { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [15.5 / 11.5, 1] }) },
    ],
  };

  return (
    <View>
      <View style={[styles.field, focused && styles.fieldFocused, !!error && styles.fieldError]}>
        {focused && <View pointerEvents="none" style={styles.ring} />}
        <Animated.Text
          pointerEvents="none"
          numberOfLines={1}
          style={[styles.label, labelStyle]}
        >
          {label}
        </Animated.Text>
        <View style={styles.inputRow}>
          <SecretField secret={Boolean(secure)} style={fillRow}>
            <TextInput
              ref={ref}
              value={value}
              secureTextEntry={secure && !shown}
              placeholderTextColor={night.dim}
              selectionColor={night.blue}
              cursorColor={night.ice}
              accessibilityLabel={label}
              onFocus={(e) => {
                setFocused(true);
                onFocus?.(e);
              }}
              onBlur={(e) => {
                setFocused(false);
                onBlur?.(e);
              }}
              style={styles.input}
              {...input}
            />
          </SecretField>
          {secure && (
            <Pressable
              onPress={() => setShown((s) => !s)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={shown ? "Hide password" : "Show password"}
              style={styles.eye}
            >
              <Icon name={shown ? "eye-off" : "eye"} size={20} color={night.muted} />
            </Pressable>
          )}
        </View>
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Icon name="problem" size={14} color={night.amber} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    height: 62,
    borderRadius: 18,
    backgroundColor: night.surface2,
    borderWidth: 1,
    borderColor: night.line,
    paddingHorizontal: 16,
  },
  fieldFocused: { borderColor: night.blueRing },
  fieldError: { borderColor: "rgba(245, 181, 68, 0.55)" },
  /** The soft 4px halo outside the focused border. */
  ring: {
    position: "absolute",
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 22,
    borderWidth: 4,
    borderColor: night.blueSoft,
  },
  label: {
    position: "absolute",
    left: 16,
    top: 10,
    fontSize: 11.5,
    fontFamily: nightFonts.medium,
    color: night.muted,
    transformOrigin: "left center",
  },
  inputRow: { flex: 1, flexDirection: "row", alignItems: "center", paddingTop: 18 },
  input: {
    flex: 1,
    height: "100%",
    paddingVertical: 0,
    fontSize: 15.5,
    fontFamily: nightFonts.regular,
    color: night.text,
  },
  eye: { paddingLeft: 10 },
  /** A problem in plain words with a small amber icon, never red (board 7c). */
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 7,
    marginLeft: 4,
  },
  error: {
    flexShrink: 1,
    fontSize: 12.5,
    fontFamily: nightFonts.medium,
    color: night.muted,
  },
});
