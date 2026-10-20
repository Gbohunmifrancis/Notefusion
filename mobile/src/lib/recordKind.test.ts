import { test } from "node:test";
import assert from "node:assert/strict";
import { recordKindChoices, type KindBilling } from "./recordKind.ts";

const free = (over: Partial<KindBilling> = {}): KindBilling => ({
  known: true,
  isPro: false,
  freeRemaining: 2,
  boughtRemaining: 0,
  ...over,
});

const costs = (remembered: "song" | "voice", b: KindBilling) =>
  recordKindChoices(remembered, b).map((c) => `${c.kind}${c.lastTime ? "*" : ""}: ${c.cost ?? "-"}`);

test("the remembered answer comes first and wears the Last time chip", () => {
  assert.deepEqual(
    recordKindChoices("voice", free()).map((c) => [c.kind, c.lastTime]),
    [["voice", true], ["song", false]],
  );
  assert.deepEqual(
    recordKindChoices("song", free()).map((c) => [c.kind, c.lastTime]),
    [["song", true], ["voice", false]],
  );
});

test("free with none bought: the song row says so up front (board 03, Night)", () => {
  assert.deepEqual(costs("voice", free()), [
    "voice*: Uses 1 of 2 free this week",
    "song: Needs Pro or a bought song",
  ]);
});

test("free with bought songs: the song uses a bought one", () => {
  assert.deepEqual(costs("song", free({ boughtRemaining: 2, freeRemaining: 3 })), [
    "song*: Uses 1 of your 2 bought songs",
    "voice: Uses 1 of 3 free this week",
  ]);
  assert.equal(recordKindChoices("song", free({ boughtRemaining: 1 }))[0]!.cost, "Uses your last bought song");
});

test("free with the week's free ones gone: a tune is paid from the bought ones", () => {
  assert.deepEqual(costs("voice", free({ freeRemaining: 0, boughtRemaining: 3 })), [
    "voice*: Uses 1 of your 3 bought songs",
    "song: Uses 1 of your 3 bought songs",
  ]);
  assert.equal(recordKindChoices("voice", free({ freeRemaining: 1 }))[0]!.cost, "Uses your last free one this week");
});

test("Pro sees songs left, not prices (board 03, Day)", () => {
  assert.deepEqual(costs("song", { known: true, isPro: true, songCreditsRemaining: 17, freeRemaining: 0, boughtRemaining: 0 }), [
    "song*: 1 of your 17 songs this month",
    "voice: Costs nothing",
  ]);
  assert.equal(
    recordKindChoices("song", { known: true, isPro: true, songCreditsRemaining: 1, freeRemaining: 0, boughtRemaining: 0 })[0]!.cost,
    "Your last song this month",
  );
  assert.equal(
    recordKindChoices("song", { known: true, isPro: true, songCreditsRemaining: 0, freeRemaining: 0, boughtRemaining: 0 })[0]!.cost,
    "No songs left this month",
  );
});

test("Pro without the month's count says nothing about the song, and the tune is still free", () => {
  assert.deepEqual(costs("song", { known: true, isPro: true, songCreditsRemaining: null, freeRemaining: 0, boughtRemaining: 0 }), [
    "song*: -",
    "voice: Costs nothing",
  ]);
});

test("billing not known: no cost chips at all (fails open)", () => {
  assert.deepEqual(costs("song", free({ known: false })), ["song*: -", "voice: -"]);
});

test("nobody has answered yet: a mic take offers the tune first, with no Last time chip", () => {
  assert.deepEqual(
    recordKindChoices("song", free(), { answered: false, fromMic: true }).map((c) => [c.kind, c.lastTime]),
    [["voice", false], ["song", false]],
  );
  // Pro too: a take from the mic is a tune far more often than a speaker held up to it.
  assert.deepEqual(
    recordKindChoices("song", { known: true, isPro: true, songCreditsRemaining: 20, freeRemaining: 0, boughtRemaining: 0 }, { answered: false, fromMic: true })
      .map((c) => c.kind),
    ["voice", "song"],
  );
});

test("nobody has answered yet: an imported file offers the song first, unless this account cannot send one", () => {
  assert.deepEqual(recordKindChoices("song", free({ boughtRemaining: 1 }), { answered: false, fromMic: false }).map((c) => c.kind), ["song", "voice"]);
  assert.deepEqual(recordKindChoices("song", free(), { answered: false, fromMic: false }).map((c) => c.kind), ["voice", "song"]);
  // Billing not read yet: no guess about what the account can afford.
  assert.deepEqual(recordKindChoices("song", { ...free(), known: false }, { answered: false, fromMic: false }).map((c) => c.kind), ["song", "voice"]);
});

test("an answer given before still comes first, from the mic as from a file", () => {
  assert.deepEqual(
    recordKindChoices("song", free({ boughtRemaining: 2 }), { answered: true, fromMic: true }).map((c) => [c.kind, c.lastTime]),
    [["song", true], ["voice", false]],
  );
});
