import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_DOH_MEMORY,
  chooseDohCard,
  dismissDohCard,
  dohCandidates,
  localDay,
  parseDohMemory,
  type DohInput,
  type DohMemory,
} from "./dohSuggestion.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-18T20:41:00Z");

const input = (over: Partial<DohInput> = {}): DohInput => ({
  now: NOW,
  hour: 20,
  day: "2026-10-18",
  sheets: [],
  streak: null,
  joinedAt: null,
  freeLeft: null,
  canTranscribe: true,
  ...over,
});
const sheet = (id: string, title: string, ago: number) => ({ id, title, savedAt: NOW - ago });
const atRisk = { current: 6, todayDone: false, freezeAvailable: false };
const everything = input({ sheets: [sheet("s1", "Abide with Me", 2 * HOUR)], streak: atRisk, joinedAt: NOW - 2 * DAY, freeLeft: 3 });

test("priority: a sheet from the last 24 h, then the streak at risk, then the first week", () => {
  assert.deepEqual(dohCandidates(everything).map((c) => c.kind), ["ready", "streak", "welcome"]);
  assert.equal(chooseDohCard(everything, EMPTY_DOH_MEMORY).card?.kind, "ready");
  assert.equal(chooseDohCard({ ...everything, sheets: [] }, EMPTY_DOH_MEMORY).card?.kind, "streak");
  assert.equal(chooseDohCard({ ...everything, sheets: [], streak: null }, EMPTY_DOH_MEMORY).card?.kind, "welcome");
  assert.equal(chooseDohCard(input(), EMPTY_DOH_MEMORY).card, null);
});

test("the ready card names the newest sheet saved in the last 24 hours, and offers to practise it", () => {
  const card = chooseDohCard(
    input({ sheets: [sheet("old", "Old", 25 * HOUR), sheet("a", "Abide with Me", 3 * HOUR), sheet("b", "Great Is Thy Faithfulness", HOUR)] }),
    EMPTY_DOH_MEMORY,
  ).card!;
  assert.equal(card.key, "ready:b");
  assert.equal(card.sheetId, "b");
  assert.equal(card.title, "“Great Is Thy Faithfulness” is ready");
  assert.equal(card.action, "Practise this tune");
  assert.equal(card.pose, "sing");
  assert.equal(chooseDohCard(input({ sheets: [sheet("old", "Old", 25 * HOUR)] }), EMPTY_DOH_MEMORY).card, null);
});

test("the streak card: after 18:00, today not sung, a streak of two days or more", () => {
  const card = chooseDohCard(input({ streak: atRisk }), EMPTY_DOH_MEMORY).card!;
  assert.equal(card.title, "Your 6-day streak ends at midnight");
  assert.equal(card.body, "One drill keeps it going. It takes about two minutes.");
  assert.equal(card.action, "Sing today's drill");
  assert.equal(card.key, "streak:2026-10-18");
  assert.equal(chooseDohCard(input({ streak: atRisk, hour: 17 }), EMPTY_DOH_MEMORY).card, null);
  assert.equal(chooseDohCard(input({ streak: { ...atRisk, todayDone: true } }), EMPTY_DOH_MEMORY).card, null);
  assert.equal(chooseDohCard(input({ streak: { ...atRisk, current: 1 } }), EMPTY_DOH_MEMORY).card, null);
});

test("the streak card never says it ends at midnight while this week's freeze would cover today", () => {
  assert.equal(chooseDohCard(input({ streak: { ...atRisk, freezeAvailable: true } }), EMPTY_DOH_MEMORY).card, null);
});

test("the first week: Doh says hello while the account can transcribe, with the free ones left", () => {
  const card = chooseDohCard(input({ joinedAt: NOW - 6 * DAY, freeLeft: 3 }), EMPTY_DOH_MEMORY).card!;
  assert.equal(card.title, "Hi, I'm Doh! Hum a hymn you love");
  assert.equal(card.body, "Just the first line. I'll write it in solfa. You have 3 free this week.");
  assert.equal(card.action, "Hum one now");
  // Pro (or billing unknown): no count.
  assert.equal(chooseDohCard(input({ joinedAt: NOW - DAY }), EMPTY_DOH_MEMORY).card!.body, "Just the first line. I'll write it in solfa.");
  assert.equal(chooseDohCard(input({ joinedAt: NOW - 8 * DAY }), EMPTY_DOH_MEMORY).card, null);
  assert.equal(chooseDohCard(input({ joinedAt: NOW - DAY, canTranscribe: false }), EMPTY_DOH_MEMORY).card, null);
  assert.equal(chooseDohCard(input({ joinedAt: null }), EMPTY_DOH_MEMORY).card, null);
});

test("the card stays while its moment lasts: leaving Home and coming back keeps it", () => {
  const first = chooseDohCard(input({ streak: atRisk }), EMPTY_DOH_MEMORY);
  const again = chooseDohCard(input({ streak: atRisk, now: NOW + HOUR, hour: 21 }), first.memory);
  assert.equal(again.card?.key, first.card?.key);
});

test("× hides the card until the context changes", () => {
  const first = chooseDohCard(input({ streak: atRisk }), EMPTY_DOH_MEMORY);
  const after = dismissDohCard(first.memory, first.card!.key, "2026-10-18");
  assert.equal(chooseDohCard(input({ streak: atRisk }), after).card, null);
  // Another evening is another context.
  const tomorrow = input({ streak: { ...atRisk, current: 7 }, now: NOW + DAY, day: "2026-10-19" });
  assert.equal(chooseDohCard(tomorrow, after).card?.key, "streak:2026-10-19");
  // A new sheet is another context.
  const ready = chooseDohCard(input({ sheets: [sheet("a", "A", HOUR)] }), EMPTY_DOH_MEMORY);
  const gone = dismissDohCard(ready.memory, "ready:a", "2026-10-18");
  assert.equal(chooseDohCard(input({ sheets: [sheet("a", "A", HOUR)] }), gone).card, null);
  assert.equal(chooseDohCard(input({ sheets: [sheet("a", "A", 2 * HOUR), sheet("b", "B", HOUR)] }), gone).card?.key, "ready:b");
});

test("never two cards, and never the same card twice a day: one pushed aside does not come back", () => {
  // The first-week card is up; a sheet is saved and takes its place; × on that leaves Home with no card.
  const welcome = chooseDohCard(input({ joinedAt: NOW - DAY }), EMPTY_DOH_MEMORY);
  assert.equal(welcome.card?.kind, "welcome");
  const ready = chooseDohCard(input({ joinedAt: NOW - DAY, sheets: [sheet("a", "A", 0)] }), welcome.memory);
  assert.equal(ready.card?.kind, "ready");
  const closed = dismissDohCard(ready.memory, "ready:a", "2026-10-18");
  assert.equal(chooseDohCard(input({ joinedAt: NOW - DAY, sheets: [sheet("a", "A", 0)] }), closed).card, null);
});

test("Doh says hello once: the first-week card is on Home for one day", () => {
  const today = chooseDohCard(input({ joinedAt: NOW - DAY }), EMPTY_DOH_MEMORY);
  const tomorrow = chooseDohCard(input({ joinedAt: NOW - DAY, now: NOW + DAY, day: "2026-10-19" }), today.memory);
  assert.equal(tomorrow.card, null);
});

test("old keys are forgotten after two weeks, current ones kept", () => {
  const memory: DohMemory = { shown: null, seen: { "streak:2026-10-01": "2026-10-01", welcome: "2026-10-10" } };
  const { memory: next } = chooseDohCard(input(), memory);
  assert.deepEqual(next.seen, { welcome: "2026-10-10" });
});

test("stored memory is read leniently", () => {
  assert.deepEqual(parseDohMemory(null), EMPTY_DOH_MEMORY);
  assert.deepEqual(parseDohMemory("{oops"), EMPTY_DOH_MEMORY);
  assert.deepEqual(parseDohMemory('{"shown":"welcome","seen":{"welcome":"2026-10-18","bad":3}}'), {
    shown: "welcome",
    seen: { welcome: "2026-10-18" },
  });
});

test("the day is the phone's local date", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(localDay(new Date(2026, 10, 30, 0, 1)), "2026-11-30");
});
