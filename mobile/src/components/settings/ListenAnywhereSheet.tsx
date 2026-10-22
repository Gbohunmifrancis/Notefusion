import React from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Sheet, SheetActions, SheetMessage, SheetTitle } from "../Sheet";
import { Group, GroupNote, Row } from "./Rows";
import { SETUP_STEPS, SETUP_WORDS, nextSetupStep, setupButtonLabel, type SetupState, type SetupStep } from "../../lib/listenAnywhere";
import { useColors } from "../../lib/theme";
import type { IconName } from "../Icon";

const STEP_ICONS: Record<SetupStep, IconName> = { mic: "mic", notifications: "bell", overlay: "overlay" };

/**
 * The setup sheet for "Listen from anywhere" (board r-listen R3/2): the three things Android needs, in
 * order, a mint tick on each once given and "Needed" until then; the one button names the next step
 * (Allow microphone → Allow notifications → Open settings → Done). The third is Android's own Settings
 * page, so the sheet says so and reads the three again when the app comes back.
 */
export function ListenAnywhereSheet({
  visible,
  state,
  busy,
  onNotNow,
  onStep,
}: {
  visible: boolean;
  state: SetupState;
  /** A permission prompt is up: the button waits for it. */
  busy: boolean;
  onNotNow: () => void;
  /** Runs the next step, or finishes when every step is given. */
  onStep: () => void;
}) {
  const c = useColors();
  const next = nextSetupStep(state);
  const done = next === null;
  return (
    <Sheet visible={visible} onClose={onNotNow}>
      <SheetTitle>{done ? SETUP_WORDS.doneTitle : SETUP_WORDS.title}</SheetTitle>
      <SheetMessage>{done ? SETUP_WORDS.doneMessage : SETUP_WORDS.message}</SheetMessage>
      <Group style={styles.group}>
        {SETUP_STEPS.map(({ step, label, hint }) => (
          <Row
            key={step}
            icon={STEP_ICONS[step]}
            label={label}
            hint={hint}
            value={state[step] ? undefined : "Needed"}
            trailing={state[step] ? <Icon name="check" size={18} color={c.success} /> : undefined}
            accessibilityLabel={`${label}, ${state[step] ? "allowed" : "needed"}`}
          />
        ))}
      </Group>
      {!done && next === "overlay" ? <GroupNote>{SETUP_WORDS.overlayNote}</GroupNote> : null}
      <SheetActions>
        {!done ? <Button label={SETUP_WORDS.notNow} variant="text" onPress={onNotNow} /> : <View />}
        <Button label={busy ? "…" : setupButtonLabel(state)} variant="primary" onPress={onStep} disabled={busy} />
      </SheetActions>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: 4 },
});
