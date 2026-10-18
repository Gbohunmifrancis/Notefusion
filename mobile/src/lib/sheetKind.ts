/**
 * How a dialog is drawn: which of the sheet's kinds it is, and which button each of its actions
 * becomes. Pure, so the rules the ~99 `showDialog` callers lean on are tested
 * (`sheetKind.test.ts`); `components/AppDialog.tsx` draws the result.
 *
 * The kinds (board 7a/7b/7c):
 *  - confirm      a question: Cancel as a text button, the act as the one blue pill.
 *  - destructive  the same, but the pill is the quiet one with its word in red. Only for a loss
 *                 that cannot be undone.
 *  - info         something to know, often a problem: a small amber icon on the title line; a
 *                 lone "OK" is a quiet pill, a fix ("Try again") is the blue one.
 *  - options      three or more choices: one row each, no Cancel button (the scrim closes it).
 *  - offer        choice rows you tap once, each with what it costs, and "Not now".
 *  - celebrate    a payment or a welcome: a gold (Pro) or violet (choir) tile beside the title.
 */

export type SheetKind = "confirm" | "destructive" | "info" | "options" | "offer" | "celebrate";

export type ButtonVariant = "primary" | "secondary" | "text" | "destructive";

interface ActionLike {
  style?: "default" | "cancel" | "destructive";
}

export interface KindInput {
  kind?: SheetKind;
  tone?: "brand" | "premium" | "danger" | "choir";
  actions?: readonly ActionLike[];
  choices?: readonly unknown[];
}

/**
 * The kind a dialog is drawn as. An explicit `kind` wins; otherwise: choice rows make an offer,
 * three or more actions (two plus a Cancel) an options sheet, a destructive action a destructive
 * confirm, a `danger` tone or a lone action an info sheet, and anything else a confirm.
 */
export function sheetKind(o: KindInput): SheetKind {
  if (o.kind) return o.kind;
  if (o.choices && o.choices.length > 0) return "offer";
  const actions = o.actions ?? [];
  const rest = actions.filter((a) => a.style !== "cancel");
  const hasCancel = rest.length < actions.length;
  if (rest.length >= 3 || (rest.length === 2 && hasCancel)) return "options";
  if (rest.some((a) => a.style === "destructive")) return "destructive";
  if (o.tone === "danger" || actions.length <= 1) return "info";
  return "confirm";
}

export interface Arranged<A> {
  /** One row each (an options sheet). */
  rows: A[];
  /** The action row, left to right: text buttons first, the one pill last (the thumb's side). */
  buttons: { action: A; variant: ButtonVariant }[];
}

/**
 * Which button each action becomes. The row is never stacked: every cancel (and any extra
 * action) is a text button, and the last real action is the pill. A lone cancel ("OK" with
 * nothing to do) is the quiet pill rather than a bare word; in a celebration it is the blue one,
 * and under an offer's choice rows it stays a text button.
 */
export function arrangeActions<A extends ActionLike>(kind: SheetKind, actions: readonly A[]): Arranged<A> {
  if (kind === "options") {
    return { rows: actions.filter((a) => a.style !== "cancel"), buttons: [] };
  }
  if (actions.length === 0) return { rows: [], buttons: [] };
  if (actions.length === 1) {
    const only = actions[0]!;
    const variant: ButtonVariant =
      only.style === "destructive"
        ? "destructive"
        : only.style !== "cancel" || kind === "celebrate"
          ? "primary"
          : kind === "offer"
            ? // The rows are the choices; "Not now" is only the way out (board 7b, a-core/03).
              "text"
            : "secondary";
    return { rows: [], buttons: [{ action: only, variant }] };
  }
  const cancels = actions.filter((a) => a.style === "cancel");
  const rest = actions.filter((a) => a.style !== "cancel");
  if (rest.length === 0) {
    // Only ways out (two cancels): the last is the quiet pill.
    return {
      rows: [],
      buttons: cancels.map((action, i) => ({
        action,
        variant: i === cancels.length - 1 ? ("secondary" as const) : ("text" as const),
      })),
    };
  }
  const pill = rest[rest.length - 1]!;
  return {
    rows: [],
    buttons: [
      ...[...cancels, ...rest.slice(0, -1)].map((action) => ({ action, variant: "text" as const })),
      { action: pill, variant: pill.style === "destructive" ? "destructive" : "primary" },
    ],
  };
}

/**
 * Whether the title carries a small icon, and in which colour: an info sheet's (amber for a
 * problem, mint for good news) and Pro's gold star on an upsell. A confirm or a destructive
 * confirm has none: the question says it.
 */
export function titleIcon(
  kind: SheetKind,
  tone: KindInput["tone"],
  icon: string | undefined,
): "warning" | "success" | "premium" | null {
  if (!icon || kind === "options" || kind === "celebrate") return null;
  if (tone === "premium") return "premium";
  if (kind !== "info") return null;
  return icon.startsWith("checkmark") ? "success" : "warning";
}
