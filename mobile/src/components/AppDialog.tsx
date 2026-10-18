import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Sheet, SheetActions, SheetMessage, SheetTitle } from "./Sheet";
import { ChoiceRow, OptionRow, type ChoiceChip } from "./SheetRows";
import { fonts, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import { arrangeActions, sheetKind, titleIcon, type SheetKind } from "../lib/sheetKind";

/** How an action is weighted. Mirrors `Alert.alert`'s button styles so replacing a call is mechanical. */
export type DialogActionStyle = "default" | "cancel" | "destructive";

export interface DialogAction {
  label: string;
  style?: DialogActionStyle;
  /** The row's icon in an options sheet. Buttons in the action row carry no icon. */
  icon?: IconName;
  /** The current choice in an options sheet (the sort order, a sheet's folder): a tick. */
  selected?: boolean;
  onPress?: () => void;
}

/** A row you tap once in an offer sheet: what it is, and what it costs. */
export interface DialogChoice {
  label: string;
  detail?: string;
  price?: string;
  priceUnit?: string;
  icon: IconName;
  tone?: "accent" | "premium" | "choir";
  chips?: ChoiceChip[];
  onPress?: () => void;
}

export interface DialogOptions {
  title: string;
  /** A line or two: what happened and what to do. Three lines at most. */
  message?: string;
  /**
   * Shown small on the title line for an info sheet (the amber "problem" sign, the mint "done" tick,
   * otherwise ink), as Pro's gold crown ("pro") on an upsell, and as the tile of a celebration.
   * A question carries none.
   */
  icon?: IconName;
  /**
   * `danger` makes a lone message an info sheet with the amber icon; it never paints anything red.
   * `premium` is Pro's gold; `choir` the choir's violet.
   */
  tone?: "brand" | "premium" | "danger" | "choir";
  /** Defaults to a single "OK", matching `Alert.alert` with no buttons. */
  actions?: DialogAction[];
  /** Choice rows (an offer sheet): each acts on one tap, and closes the sheet. */
  choices?: DialogChoice[];
  /** A celebration's perk lines. */
  perks?: { icon: IconName; text: string }[];
  /** Overrides the kind `lib/sheetKind` infers from the actions and tone. */
  kind?: SheetKind;
  /**
   * Removes every way out except the actions: no grabber, the scrim and the swipe do nothing, and
   * the Android back button does nothing. For the one case that has no "later" — a build below the
   * minimum the server will serve, where letting the user past the dialog only lands them on a
   * screen that cannot work — and for a question that must be answered.
   */
  blocking?: boolean;
}

/** Something to run once the sheet has gone: an action's or a choice's handler. */
export type DialogOutcome = { onPress?: () => void } | undefined;

interface Props {
  visible: boolean;
  options: DialogOptions | null;
  /** Closes the sheet; the outcome's handler runs once it has left the screen. Nothing on a dismissal with no Cancel. */
  onResolve: (outcome: DialogOutcome) => void;
  /** The sheet has left the screen. */
  onClosed: () => void;
}

const OK: DialogAction = { label: "OK", style: "cancel" };

/**
 * Every dialog in the app, drawn as the one bottom sheet (board 7a): grabber, title, a short
 * message, and the actions in one row on the right — a text button, then one pill. The kind is
 * read off the options (`lib/sheetKind`), so the callers of `showDialog` say what they mean
 * (a `destructive` action, a `danger` tone, three choices) and never pick colours: a destructive
 * confirm is the quiet pill with a red word, a problem is a small amber icon, three or more
 * choices are rows, an offer is choice rows with prices, and good news is a toast (`showToast`),
 * not a sheet.
 *
 * Presentational only — mounting, queueing, and the imperative entry point live in
 * `lib/dialog.tsx`.
 */
export function AppDialog({ visible, options, onResolve, onClosed }: Props) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);

  // Retained through the exit, so the sheet leaves looking like itself.
  const [shown, setShown] = useState<DialogOptions | null>(options);
  useEffect(() => {
    if (options) setShown(options);
  }, [options]);

  const o = shown;
  const kind = o ? sheetKind(o) : "info";
  const given = o?.actions ?? [];
  const actions =
    given.length > 0 ? given : kind === "options" || kind === "offer" || o?.blocking ? [] : [OK];
  const arranged = arrangeActions(kind, actions);
  const cancel = actions.find((a) => a.style === "cancel");
  const iconTone = o ? titleIcon(kind, o.tone, o.icon) : null;

  /** The scrim, a swipe and Android back resolve as the Cancel would. */
  const dismiss = () => {
    if (o?.blocking) return;
    onResolve(cancel);
  };

  const titleLeading =
    kind === "celebrate" && o?.icon ? (
      <View style={[styles.tile, { backgroundColor: o.tone === "choir" ? c.choirSoft : c.premiumSoft }]}>
        <Icon name={o.icon} size={20} color={o.tone === "choir" ? c.choir : c.premium} />
      </View>
    ) : iconTone && o?.icon ? (
      <Icon
        name={o.icon}
        size={21}
        color={
          iconTone === "premium"
            ? c.premium
            : iconTone === "success"
              ? c.success
              : iconTone === "warning"
                ? c.warning
                : c.icon
        }
      />
    ) : undefined;

  return (
    <Sheet visible={visible && o !== null} onClose={dismiss} dismissable={!o?.blocking} onClosed={onClosed}>
      {o ? (
        <>
          <SheetTitle leading={titleLeading}>{o.title}</SheetTitle>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {o.message ? <SheetMessage>{o.message}</SheetMessage> : <View style={styles.noMessage} />}

            {kind === "celebrate" && o.perks?.length ? (
              <View style={styles.perks}>
                {o.perks.map((p) => (
                  <View key={p.text} style={styles.perk}>
                    <Icon name={p.icon} size={16} color={c.textMuted} />
                    <Text style={styles.perkText}>{p.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {o.choices?.map((choice) => (
              <ChoiceRow
                key={choice.label}
                title={choice.label}
                detail={choice.detail}
                price={choice.price}
                priceUnit={choice.priceUnit}
                icon={choice.icon}
                tone={choice.tone}
                chips={choice.chips}
                onPress={() => onResolve(choice)}
              />
            ))}

            {arranged.rows.map((row, i) => (
              <OptionRow
                key={row.label}
                label={row.label}
                icon={row.icon}
                selected={row.selected}
                destructive={row.style === "destructive"}
                first={i === 0}
                onPress={row.onPress ? () => onResolve(row) : undefined}
              />
            ))}
          </ScrollView>

          {arranged.buttons.length > 0 ? (
            <SheetActions style={(o.choices?.length || arranged.rows.length) ? styles.actionsAfterRows : undefined}>
              {arranged.buttons.map(({ action, variant }) => (
                <Button
                  key={action.label}
                  label={action.label}
                  variant={variant}
                  onPress={() => onResolve(action)}
                />
              ))}
            </SheetActions>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    /** Grows to its content; a long message or a long list scrolls instead of pushing the actions off. */
    body: {
      flexGrow: 0,
    },
    bodyContent: {
      paddingBottom: 2,
    },
    noMessage: {
      height: 10,
    },
    tile: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    perks: {
      gap: 10,
      marginTop: -6,
      marginBottom: 22,
    },
    perk: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    perkText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 20,
      color: c.text,
    },
    actionsAfterRows: {
      marginTop: 8,
    },
  });
