import { test } from "node:test";
import assert from "node:assert/strict";
import { arrangeActions, sheetKind, titleIcon } from "./sheetKind.ts";

const cancel = (label: string) => ({ label, style: "cancel" as const });
const act = (label: string) => ({ label });
const destroy = (label: string) => ({ label, style: "destructive" as const });

const labels = (a: ReturnType<typeof arrangeActions<{ label: string; style?: "default" | "cancel" | "destructive" }>>) =>
  a.buttons.map((b) => `${b.action.label}:${b.variant}`);

test("a question with a Cancel is a confirm: text button, then the blue pill", () => {
  const actions = [act("Notify me"), cancel("Not now")];
  assert.equal(sheetKind({ actions }), "confirm");
  assert.deepEqual(labels(arrangeActions("confirm", actions)), ["Not now:text", "Notify me:primary"]);
});

test("a destructive action makes a destructive confirm with the red word on the quiet pill", () => {
  const actions = [destroy("Delete"), cancel("Cancel")];
  assert.equal(sheetKind({ actions, tone: "danger" }), "destructive");
  assert.deepEqual(labels(arrangeActions("destructive", actions)), ["Cancel:text", "Delete:destructive"]);
});

test("a problem with nothing to do is an info sheet with one quiet OK", () => {
  assert.equal(sheetKind({ tone: "danger" }), "info");
  assert.equal(sheetKind({}), "info");
  assert.deepEqual(labels(arrangeActions("info", [cancel("OK")])), ["OK:secondary"]);
});

test("a problem with a fix keeps OK as text and makes the fix the pill", () => {
  const actions = [cancel("OK"), act("Record again")];
  assert.equal(sheetKind({ tone: "danger", actions }), "info");
  assert.deepEqual(labels(arrangeActions("info", actions)), ["OK:text", "Record again:primary"]);
});

test("a lone action that does something is the blue pill (Update required)", () => {
  assert.deepEqual(labels(arrangeActions("info", [act("Update now")])), ["Update now:primary"]);
});

test("three or more choices are rows, and the Cancel goes (the scrim closes it)", () => {
  const actions = [act("Newest first"), act("Oldest first"), cancel("Cancel")];
  assert.equal(sheetKind({ actions }), "options");
  const arranged = arrangeActions("options", actions);
  assert.deepEqual(arranged.rows.map((r) => r.label), ["Newest first", "Oldest first"]);
  assert.deepEqual(arranged.buttons, []);
  assert.equal(sheetKind({ actions: [act("a"), act("b"), act("c")] }), "options");
});

test("a destructive row in an options sheet stays a row", () => {
  const actions = [act("Edit notes"), act("Export"), destroy("Delete from Library"), cancel("Cancel")];
  assert.equal(sheetKind({ actions }), "options");
  assert.equal(arrangeActions("options", actions).rows.at(-1)!.label, "Delete from Library");
});

test("choice rows make an offer, whatever the actions; its Not now is a text button", () => {
  assert.equal(sheetKind({ choices: [{}], actions: [cancel("Not now")] }), "offer");
  assert.deepEqual(labels(arrangeActions("offer", [cancel("Not now")])), ["Not now:text"]);
  assert.deepEqual(arrangeActions("offer", []).buttons, []);
});

test("an explicit kind wins over the inference", () => {
  assert.equal(sheetKind({ kind: "celebrate", tone: "premium" }), "celebrate");
  assert.equal(sheetKind({ kind: "options", actions: [act("Choose photo"), cancel("Cancel")] }), "options");
});

test("a celebration's one button is the blue pill even when it only closes", () => {
  assert.deepEqual(labels(arrangeActions("celebrate", [cancel("Start using Pro")])), ["Start using Pro:primary"]);
});

test("two acts with no Cancel: the first is text, the last the pill; never stacked", () => {
  const actions = [act("Later"), act("Try again")];
  assert.equal(sheetKind({ actions }), "confirm");
  assert.deepEqual(labels(arrangeActions("confirm", actions)), ["Later:text", "Try again:primary"]);
});

test("the title icon: amber for a problem, mint for good news, gold for Pro, none on a question", () => {
  assert.equal(titleIcon("info", "danger", "alert-circle-outline"), "warning");
  assert.equal(titleIcon("info", undefined, "cloud-offline-outline"), "warning");
  assert.equal(titleIcon("info", undefined, "checkmark-circle-outline"), "success");
  assert.equal(titleIcon("confirm", "premium", "star"), "premium");
  assert.equal(titleIcon("confirm", "brand", "notifications-outline"), null);
  assert.equal(titleIcon("destructive", "danger", "trash-outline"), null);
  assert.equal(titleIcon("options", undefined, "ellipsis-horizontal"), null);
  assert.equal(titleIcon("info", "danger", undefined), null);
});
