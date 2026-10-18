import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASKED_MAX,
  EXIT_ROWS,
  NOTE_MAX,
  cleanNote,
  exitReply,
  exitRows,
  parseAsked,
  rememberAsked,
  secondsOpen,
  shouldReportReturn,
  type ReplyContext,
} from "./checkoutExit.ts";

const dollars: ReplyContext = { currency: "USD", price: "$9.99", songPrice: "$1.99", buyingSong: false, keptMinutes: 30 };
const naira: ReplyContext = { currency: "NGN", price: "₦7,500", songPrice: "₦1,500", buyingSong: false, keptMinutes: 30 };

const text = (r: ReturnType<typeof exitReply>) => (r.kind === "answer" ? r.parts.map((p) => p.text).join("") : "");

test("six answers on a dollar checkout, the currency one first", () => {
  assert.deepEqual(
    exitRows("USD").map((r) => r.label),
    [
      "The price wasn't in my currency",
      "My card was declined",
      "The page was slow or didn't load",
      "It costs too much",
      "I'm just looking",
      "Something else",
    ],
  );
  assert.equal(exitRows("usd").length, 6);
});

test("a naira checkout is never asked about its currency", () => {
  assert.deepEqual(
    exitRows("NGN").map((r) => r.reason),
    ["cardDeclined", "slow", "tooExpensive", "justLooking", "somethingElse"],
  );
});

test("each row has its own icon, none of them a problem sign", () => {
  const icons = EXIT_ROWS.map((r) => r.icon);
  assert.equal(new Set(icons).size, icons.length);
  assert.ok(!icons.includes("problem"));
});

test("asked only when the page was closed by hand and the quick check found nothing paid", () => {
  const base = { returned: false, check: "unpaid" as const, reference: "NF_1", asked: [] };
  assert.equal(shouldReportReturn(base), true);
  // The provider's own return: a payment is being confirmed.
  assert.equal(shouldReportReturn({ ...base, returned: true }), false);
  assert.equal(shouldReportReturn({ ...base, check: "paid" }), false);
  assert.equal(shouldReportReturn({ ...base, check: "unknown" }), false);
  assert.equal(shouldReportReturn({ ...base, reference: null }), false);
});

test("once per checkout", () => {
  const asked = rememberAsked([], "NF_1");
  assert.equal(shouldReportReturn({ returned: false, check: "unpaid", reference: "NF_1", asked }), false);
  assert.equal(shouldReportReturn({ returned: false, check: "unpaid", reference: "NF_2", asked }), true);
});

test("the asked list keeps the newest checkouts, each once", () => {
  let asked: string[] = [];
  for (let i = 0; i < ASKED_MAX + 5; i++) asked = rememberAsked(asked, `NF_${i}`);
  asked = rememberAsked(asked, `NF_${ASKED_MAX + 2}`);
  assert.equal(asked.length, ASKED_MAX);
  assert.equal(asked[0], `NF_${ASKED_MAX + 2}`);
  assert.equal(new Set(asked).size, ASKED_MAX);
  assert.ok(!asked.includes("NF_0"));
});

test("a stored list that cannot be read is empty", () => {
  assert.deepEqual(parseAsked(null), []);
  assert.deepEqual(parseAsked("not json"), []);
  assert.deepEqual(parseAsked('{"a":1}'), []);
  assert.deepEqual(parseAsked('["NF_1", 2, "NF_3"]'), ["NF_1", "NF_3"]);
});

test("seconds open are whole, never negative, never past two days", () => {
  assert.equal(secondsOpen(1_000, 38_400), 37);
  assert.equal(secondsOpen(5_000, 1_000), 0);
  assert.equal(secondsOpen(0, 10 * 24 * 3600 * 1000), 2 * 24 * 3600);
  assert.equal(secondsOpen(Number.NaN, 1_000), 0);
});

test("a note is trimmed and kept to 280 characters", () => {
  assert.equal(cleanNote("  I wanted to pay with PayPal \n"), "I wanted to pay with PayPal");
  assert.equal(cleanNote("a".repeat(400)).length, NOTE_MAX);
  assert.equal(NOTE_MAX, 280);
});

test("a declined card: nothing charged, bank transfer on the same page, and the one-song row", () => {
  const r = exitReply("cardDeclined", dollars);
  assert.equal(r.kind, "answer");
  if (r.kind !== "answer") return;
  assert.equal(r.title, "Thanks for telling us");
  assert.equal(
    text(r),
    "Nothing was charged. Some banks outside Nigeria turn down a card payment in naira. Bank transfer, on the same page, usually goes through.",
  );
  assert.deepEqual(r.parts.filter((p) => p.strong).map((p) => p.text), ["Bank transfer"]);
  assert.equal(r.offerSong, true);
  assert.equal(r.tryAgain, true);
});

test("a declined naira card is not told about banks outside Nigeria", () => {
  const r = exitReply("cardDeclined", naira);
  assert.ok(!text(r).includes("outside Nigeria"));
  assert.ok(text(r).startsWith("Nothing was charged."));
});

test("no one-song row for Pro, or when one song was what they were buying", () => {
  const pro = exitReply("cardDeclined", { ...dollars, songPrice: null });
  const song = exitReply("cardDeclined", { ...dollars, buyingSong: true });
  assert.ok(pro.kind === "answer" && !pro.offerSong);
  assert.ok(song.kind === "answer" && !song.offerSong);
});

test("the currency: the page turns their dollars into naira, with no naira figure quoted", () => {
  const r = exitReply("currency", dollars);
  assert.equal(
    text(r),
    "The payment page turns your $9.99 into naira at today's rate, so you see a naira total. Your bank may add a small fee for the conversion.",
  );
  assert.ok(!text(r).includes("₦"));
  assert.ok(r.kind === "answer" && r.tryAgain && !r.offerSong);
});

test("slow: up to 20 seconds, and the same checkout kept for the server's minutes", () => {
  const r = exitReply("slow", { ...dollars, keptMinutes: 45 });
  assert.ok(r.kind === "answer");
  if (r.kind !== "answer") return;
  assert.equal(r.title, "Sorry it was slow");
  assert.equal(text(r), "The ways to pay can take up to 20 seconds to appear. Try again opens the same checkout: we keep it for 45 minutes.");
  assert.deepEqual(r.parts.filter((p) => p.strong).map((p) => p.text), ["Try again"]);
  assert.equal(r.tryAgain, true);
});

test("too much: the one-song row and Close, no Try again", () => {
  const r = exitReply("tooExpensive", dollars);
  assert.ok(r.kind === "answer" && r.offerSong && !r.tryAgain);
  const none = exitReply("tooExpensive", { ...dollars, songPrice: null });
  assert.ok(none.kind === "answer" && !none.offerSong);
});

test("just looking closes with a toast; something else opens the text box", () => {
  assert.deepEqual(exitReply("justLooking", dollars), { kind: "toast", message: "Thanks. Pro is here when you want it." });
  assert.deepEqual(exitReply("justLooking", { ...dollars, buyingSong: true }), {
    kind: "toast",
    message: "Thanks. It's here when you want it.",
  });
  assert.deepEqual(exitReply("somethingElse", dollars), { kind: "note" });
});

test("no answer is a problem: no red words, nothing technical", () => {
  for (const row of EXIT_ROWS) {
    const r = exitReply(row.reason, dollars);
    const words = r.kind === "answer" ? r.title + text(r) : r.kind === "toast" ? r.message : "";
    assert.ok(!/error|failed|declined by/i.test(words), words);
  }
});
