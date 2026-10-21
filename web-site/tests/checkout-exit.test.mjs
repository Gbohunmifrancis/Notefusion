// node --test web-site/tests/*.test.mjs
// checkout-exit.js is a plain browser script that sets window.NfCheckoutExit. The phone app's copy is
// mobile/src/lib/checkoutExit.ts, tested the same way in checkoutExit.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/checkout-exit.js", import.meta.url), "utf8"), { window, Intl, JSON, Math, isFinite, String, Array });
const X = window.NfCheckoutExit;
// The vm realm has its own Array, so results are copied into this one to compare.
const plain = (v) => JSON.parse(JSON.stringify(v));

const dollars = { currency: "USD", price: "$9.99", songPrice: "$1.99", buyingSong: false, keptMinutes: 30 };
const naira = { currency: "NGN", price: "₦7,500", songPrice: "₦1,500", buyingSong: false, keptMinutes: 30 };
const text = (r) => (r.kind === "answer" ? r.parts.map((p) => p.text).join("") : "");

test("six answers on a dollar checkout, the currency one first", () => {
  assert.deepEqual(plain(X.rows("USD").map((r) => r.label)), [
    "The price wasn't in my currency",
    "My card was declined",
    "The page was slow or didn't load",
    "It costs too much",
    "I'm just looking",
    "Something else",
  ]);
});

test("a naira checkout is never asked about its currency", () => {
  assert.deepEqual(plain(X.rows("NGN").map((r) => r.reason)), ["cardDeclined", "slow", "tooExpensive", "justLooking", "somethingElse"]);
});

test("every row's icon is in the site's sprite", () => {
  const sprite = readFileSync(new URL("../assets/icons.svg", import.meta.url), "utf8");
  for (const row of X.ROWS) assert.ok(sprite.includes(`id="i-${row.icon}"`), row.icon);
});

test("reported only when the quick check found nothing paid, once per checkout", () => {
  const base = { returned: false, check: "unpaid", reference: "NF_1", asked: [] };
  assert.equal(X.shouldReportReturn(base), true);
  assert.equal(X.shouldReportReturn({ ...base, check: "paid" }), false);
  assert.equal(X.shouldReportReturn({ ...base, check: "unknown" }), false);
  assert.equal(X.shouldReportReturn({ ...base, returned: true }), false);
  assert.equal(X.shouldReportReturn({ ...base, reference: null }), false);
  assert.equal(X.shouldReportReturn({ ...base, asked: X.rememberAsked([], "NF_1") }), false);
});

test("the asked list keeps the newest checkouts, each once, and survives junk", () => {
  let asked = [];
  for (let i = 0; i < X.ASKED_MAX + 3; i++) asked = X.rememberAsked(asked, `NF_${i}`);
  asked = X.rememberAsked(asked, "NF_5");
  assert.equal(asked.length, X.ASKED_MAX);
  assert.equal(asked[0], "NF_5");
  assert.equal(new Set(asked).size, X.ASKED_MAX);
  assert.deepEqual(plain(X.parseAsked(null)), []);
  assert.deepEqual(plain(X.parseAsked("{oops")), []);
  assert.deepEqual(plain(X.parseAsked('["NF_1", 7]')), ["NF_1"]);
});

test("seconds open are whole, never negative, never past two days", () => {
  assert.equal(X.secondsOpen(1000, 38400), 37);
  assert.equal(X.secondsOpen(5000, 1000), 0);
  assert.equal(X.secondsOpen(0, 10 * 864e5), 2 * 86400);
});

test("a note is trimmed and kept to 280 characters", () => {
  assert.equal(X.cleanNote("  I wanted to pay with PayPal \n"), "I wanted to pay with PayPal");
  assert.equal(X.cleanNote("a".repeat(300)).length, 280);
  assert.equal(X.NOTE_MAX, 280);
});

test("prices in their own symbol", () => {
  assert.equal(X.formatPrice(999, "USD"), "$9.99");
  assert.equal(X.formatPrice(199, "USD"), "$1.99");
  assert.equal(X.formatPrice(750000, "NGN"), "₦7,500");
});

test("a declined card: nothing charged, bank transfer on the same page, and the one-song row", () => {
  const r = X.reply("cardDeclined", dollars);
  assert.equal(r.title, "Thanks for telling us");
  assert.equal(text(r), "Nothing was charged. Banks sometimes turn down a card payment online. Bank transfer, on the same page, usually goes through.");
  assert.deepEqual(plain(r.parts.filter((p) => p.strong).map((p) => p.text)), ["Bank transfer"]);
  assert.equal(r.offerSong, true);
  assert.equal(r.tryAgain, true);
  assert.ok(!text(X.reply("cardDeclined", naira)).includes("outside Nigeria"));
  assert.equal(X.reply("cardDeclined", { ...dollars, songPrice: null }).offerSong, false); // Pro: none on sale
  assert.equal(X.reply("cardDeclined", { ...dollars, buyingSong: true }).offerSong, false);
});

test("the currency answer names their dollars and quotes no naira", () => {
  const r = X.reply("currency", dollars);
  assert.equal(text(r), "Your $9.99 is charged in US dollars. If your card is in another currency, your bank converts it and may add a small fee.");
  assert.ok(!text(r).includes("₦"));
});

test("slow: the same checkout, kept for the server's minutes", () => {
  const r = X.reply("slow", { ...dollars, keptMinutes: 30 });
  assert.equal(r.title, "Sorry it was slow");
  assert.equal(text(r), "The ways to pay can take up to 20 seconds to appear. Try again opens the same checkout: we keep it for 30 minutes.");
});

test("too much offers one song and no Try again; just looking is a toast; something else a text box", () => {
  const r = X.reply("tooExpensive", dollars);
  assert.equal(r.offerSong, true);
  assert.equal(r.tryAgain, false);
  assert.deepEqual(plain(X.reply("justLooking", dollars)), { kind: "toast", message: "Thanks. Pro is here when you want it." });
  assert.deepEqual(plain(X.reply("somethingElse", dollars)), { kind: "note" });
});

test("the website and the phone say the same words", () => {
  const phone = readFileSync(new URL("../../mobile/src/lib/checkoutExit.ts", import.meta.url), "utf8");
  for (const row of X.ROWS) assert.ok(phone.includes(`"${row.label}"`), row.label);
  for (const reason of ["cardDeclined", "currency", "slow", "tooExpensive"]) {
    for (const part of X.reply(reason, dollars).parts) {
      const words = part.text.replace("$9.99", "${ctx.price}").replace(/\d+ minutes/, "").trim();
      if (words.length > 12) assert.ok(phone.includes(words.split(" ").slice(0, 6).join(" ")), words);
    }
  }
});
