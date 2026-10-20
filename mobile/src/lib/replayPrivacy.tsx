import React, { createContext, useContext } from "react";
import { UIManager, type StyleProp, type ViewStyle } from "react-native";
import * as Sentry from "@sentry/react-native";

/**
 * What a session recording may show (docs/DEPLOYMENT.md, "Error reports"): the screen as the person saw it, except
 * password fields and Admin, which shows other people's accounts. Sentry's <Mask> is a native view, and a build
 * without it renders a plain View instead, so there the recorder keeps blanking everything rather than show a password.
 */
export const canMaskViews = Boolean(UIManager.hasViewManagerConfig?.("RNSentryReplayMask"));

const Private = createContext(false);

/** Keeps a whole area out of recordings, the sheets it opens included: each sheet is a window of its own. */
export function PrivateArea({ children }: { children: React.ReactNode }) {
  return (
    <Private.Provider value>
      <Sentry.Mask style={{ flex: 1 }}>{children}</Sentry.Mask>
    </Private.Provider>
  );
}

/** A window's content (a sheet) masked when it was opened from inside a PrivateArea. */
export function MaskIfPrivate({ children }: { children: React.ReactElement }) {
  return useContext(Private) ? <Sentry.Mask style={{ flex: 1 }}>{children}</Sentry.Mask> : children;
}

/** A password input kept out of recordings, shown or hidden; anything else passes through untouched. */
export function SecretField({
  secret,
  style,
  children,
}: {
  secret: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactElement;
}) {
  return secret ? <Sentry.Mask style={style}>{children}</Sentry.Mask> : children;
}

/** For an input that fills the rest of its row (it keeps its own flex and height inside). */
export const fillRow: ViewStyle = { flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "center" };
