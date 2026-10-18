import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../Button";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import { AdminTopBar } from "./AdminChrome";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import { toApiError } from "../../api/client";
import { cleanCode, lockedFootnote, lockedLine, lockedTitle, type LockMethod } from "../../lib/adminLock";
import {
  finishSetup,
  requestCode,
  setupPending,
  storePendingKey,
  unlockWithPhone,
  verifyCode,
  type UnlockOutcome,
} from "../../lib/adminLockRuntime";

/**
 * Admin, locked (board f-admin/10 revised): no figures, no bottom bar, no names. With this phone's key the fingerprint
 * sheet comes up by itself once; cancelled, this page stays with Unlock and the way out. Without a key yet (or after a
 * new fingerprint wiped it) it sets the phone up: the password, a code emailed to the account, then the fingerprint
 * keeps the key. A phone with no fingerprint or face sensor asks for the password and an emailed code each time.
 * Nothing admin is fetched until the server hands over a pass.
 */
export function LockedView({ method, onBack }: { method: LockMethod | null; onBack: () => void }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const asked = useRef(false);
  // The "set up again" page is read first; its button starts the steps.
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The fingerprint sheet rises by itself the first time, as the board's "back after 6 minutes" shows.
  useEffect(() => {
    if (method !== "biometric" || asked.current) return;
    asked.current = true;
    void unlockWithPhone().then((o) => setError(o.kind === "failed" ? o.message : null));
  }, [method]);

  const shown = method ?? "biometric";
  const steps = method === "setup" || method === "code" || (method === "rekey" && started);
  const tile: { icon: IconName; color: string } =
    method === "rekey" && !started ? { icon: "problem", color: a.warn } : { icon: "lock", color: a.text };

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right", "bottom"]}>
      <AdminTopBar online={false} />
      {steps && method ? (
        <CodeSteps method={method} onBack={onBack} />
      ) : (
        <>
          <View style={s.body}>
            <View style={s.tile}>
              <Icon name={tile.icon} size={26} color={tile.color} />
            </View>
            <Text style={s.title} accessibilityRole="header">
              {lockedTitle(shown)}
            </Text>
            <Text style={s.line}>{lockedLine(shown)}</Text>
            <ErrorLine text={error} />
            {method === "rekey" ? (
              <Button label="Set up again" onPress={() => setStarted(true)} style={s.unlock} />
            ) : (
              <Button
                label="Unlock"
                icon="fingerprint"
                onPress={() => void unlockWithPhone().then((o) => setError(o.kind === "failed" ? o.message : null))}
                disabled={!method}
                style={s.unlock}
              />
            )}
            <Button label="Back to the app" variant="text" onPress={onBack} />
          </View>
          <Text style={s.foot}>{lockedFootnote(shown)}</Text>
        </>
      )}
    </SafeAreaView>
  );
}

type Step = "password" | "code" | "fingerprint";

/**
 * The password, then the emailed code; for a setup, then the fingerprint (board f-admin/10 revised, 2 and 4). A
 * fingerprint sheet cancelled at the end keeps the server's answer, so trying again needs no new code.
 */
function CodeSteps({ method, onBack }: { method: LockMethod; onBack: () => void }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const setup = method !== "code";
  const [step, setStep] = useState<Step>(setup && setupPending() ? "fingerprint" : "password");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState<{ codeId: string; sentTo: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const answer = await requestCode(password, setup ? "setup" : "unlock");
      setSent({ codeId: answer.codeId, sentTo: answer.sentTo });
      setPassword("");
      setCode("");
      setStep("code");
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  function outcome(o: UnlockOutcome) {
    if (o.kind === "failed") setError(o.message);
    // The fingerprint sheet was cancelled: the key waits for it here.
    if (o.kind === "cancelled") setStep("fingerprint");
  }

  async function submitCode() {
    if (!sent) return;
    setBusy(true);
    setError(null);
    try {
      if (setup) outcome(await finishSetup(sent.codeId, code));
      else setError(await verifyCode(sent.codeId, code));
    } finally {
      setBusy(false);
    }
  }

  async function useFingerprint() {
    setBusy(true);
    setError(null);
    try {
      outcome(await storePendingKey());
    } finally {
      setBusy(false);
    }
  }

  const title = setup ? (method === "rekey" ? "Set up Admin again" : "Set up Admin here") : "Admin is locked";
  const line =
    step === "password"
      ? setup
        ? "First, your NoteFusion password. Then we email you a code."
        : lockedLine("code")
      : step === "code"
        ? `We emailed a 6-digit code to ${sent?.sentTo ?? "your email"}. It works for 10 minutes.`
        : "Last, your fingerprint or face keeps this phone's key. Only it can open Admin from now on.";

  return (
    <>
      <View style={s.body}>
        <View style={s.tile}>
          <Icon name={step === "code" ? "mail" : step === "fingerprint" ? "fingerprint" : "lock"} size={26} color={a.text} />
        </View>
        {setup ? <StepDots step={step} /> : null}
        <Text style={s.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={s.line}>{line}</Text>

        {step === "password" ? (
          <View style={s.form}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Your NoteFusion password"
              placeholderTextColor={a.dim}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={s.input}
              onSubmitEditing={() => void sendCode()}
              accessibilityLabel="Password"
            />
            <ErrorLine text={error} />
            <Button label="Email me a code" onPress={() => void sendCode()} loading={busy} disabled={!password} block />
          </View>
        ) : step === "code" ? (
          <View style={s.form}>
            <CodeBoxes value={code} onChange={setCode} onDone={() => void submitCode()} />
            <ErrorLine text={error} />
            <Button label="Continue" onPress={() => void submitCode()} loading={busy} disabled={code.length < 6} block />
            <Button label="Send a new code" variant="text" onPress={() => setStep("password")} disabled={busy} />
          </View>
        ) : (
          <View style={s.form}>
            <ErrorLine text={error} />
            <Button label="Use fingerprint or face" icon="fingerprint" onPress={() => void useFingerprint()} loading={busy} block />
          </View>
        )}
        <Button label="Back to the app" variant="text" onPress={onBack} />
      </View>
      <Text style={s.foot}>{lockedFootnote(method)}</Text>
    </>
  );
}

/** ✓ Password · 2 Email code · 3 Fingerprint. */
function StepDots({ step }: { step: Step }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const order: Step[] = ["password", "code", "fingerprint"];
  const at = order.indexOf(step);
  const labels = ["Password", "Email code", "Fingerprint"];
  return (
    <View style={s.steps} accessibilityLabel={`Step ${at + 1} of 3: ${labels[at]}`}>
      {labels.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 ? <View style={s.stepRule} /> : null}
          <View style={[s.dot, i === at && s.dotOn, i < at && s.dotDone]}>
            {i < at ? (
              <Icon name="check" size={11} color={a.ok} />
            ) : (
              <Text style={[s.dotText, i === at && s.dotTextOn]}>{i + 1}</Text>
            )}
          </View>
          <Text style={s.stepLabel}>{label}</Text>
        </React.Fragment>
      ))}
    </View>
  );
}

/** Six boxes over one hidden field: the keyboard's own one-time-code suggestion fills them all at once. */
function CodeBoxes({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  const s = useAdminStyles(makeStyles);
  const input = useRef<TextInput>(null);
  return (
    <Touchable onPress={() => input.current?.focus()} ripple={false} accessibilityLabel="Code from the email">
      <View style={s.code}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={[s.box, i === value.length && s.boxCurrent]}>
            <Text style={s.boxText}>{value[i] ?? ""}</Text>
          </View>
        ))}
        <TextInput
          ref={input}
          value={value}
          onChangeText={(t) => {
            const next = cleanCode(t);
            onChange(next);
            if (next.length === 6) onDone();
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          caretHidden
          style={s.hidden}
        />
      </View>
    </Touchable>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  if (!text) return null;
  return (
    <View style={s.error}>
      <Icon name="problem" size={16} color={a.warn} />
      <Text style={s.errorText}>{text}</Text>
    </View>
  );
}

/** The blank cover while the app is not in front: what Recents shows of Admin. */
export function AwayCover() {
  const a = useAdminColors();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: a.bg }]} pointerEvents="none" />;
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: a.bg },
    body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 6 },
    tile: {
      width: 72,
      height: 72,
      borderRadius: 18,
      backgroundColor: a.sub,
      borderWidth: 1,
      borderColor: a.line,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 18,
    },
    title: { fontFamily: fonts.semibold, fontSize: 24, letterSpacing: -0.4, color: a.text, textAlign: "center" },
    line: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: a.muted, textAlign: "center", marginTop: 6, marginBottom: 18 },
    unlock: { marginBottom: 6 },
    form: { alignSelf: "stretch", gap: 10, marginBottom: 6 },
    input: {
      minHeight: 50,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: a.line,
      backgroundColor: a.card,
      paddingHorizontal: 14,
      fontFamily: fonts.regular,
      fontSize: 16,
      color: a.text,
    },
    steps: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 18 },
    stepRule: { width: 14, height: 1, backgroundColor: a.line },
    dot: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: a.line,
      alignItems: "center",
      justifyContent: "center",
    },
    dotOn: { backgroundColor: a.fill, borderColor: a.fill },
    dotDone: { backgroundColor: a.sub, borderColor: a.ok },
    dotText: { fontFamily: fonts.semibold, fontSize: 11, color: a.muted },
    dotTextOn: { color: "#FFFFFF" },
    stepLabel: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted },
    code: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 6 },
    box: {
      width: 44,
      height: 54,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: a.line,
      backgroundColor: a.card,
      alignItems: "center",
      justifyContent: "center",
    },
    boxCurrent: { borderColor: a.brand },
    boxText: { fontFamily: fonts.semibold, fontSize: 22, color: a.text },
    // Covers the boxes, invisible: taps land on it and the keyboard types into it.
    hidden: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0, color: "transparent" },
    error: { flexDirection: "row", gap: 8, alignItems: "flex-start", alignSelf: "stretch" },
    errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.text },
    foot: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: a.faint, textAlign: "center", paddingHorizontal: 28, paddingBottom: 18 },
  });
