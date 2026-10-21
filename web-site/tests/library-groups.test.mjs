// node --test web-site/tests/*.test.mjs
// library-groups.js is a plain browser script that sets window.NfLibraryGroups.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {}; // the vm realm has its own Array, so results are copied back into this one to compare
vm.runInNewContext(readFileSync(new URL("../assets/library-groups.js", import.meta.url), "utf8"), { window, Date, Math, isNaN });
const { group, groupOf } = window.NfLibraryGroups;

/** Runs `fn` with the process in time zone `tz` (Node re-reads TZ when it changes). */
function inZone(tz, fn) {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}
const sheet = (id, createdAtUtc) => ({ id, createdAtUtc });
/** The groups as plain data: [[title, ids…], …]. */
const shape = (groups) => Array.from(groups, (g) => [g.title, ...Array.from(g.items, (it) => it.id)]);

// Tue 20 Oct 2026, 11:00 in Lagos.
const NOW = new Date("2026-10-20T10:00:00Z");

test("today, the six days before it, and everything older", () => {
  inZone("Africa/Lagos", () => {
    assert.equal(groupOf("2026-10-20T08:40:00Z", NOW), "today");
    assert.equal(groupOf("2026-10-19T23:30:00Z", NOW), "today"); // 00:30 on the 20th in Lagos
    assert.equal(groupOf("2026-10-19T22:30:00Z", NOW), "week"); // 23:30 on the 19th
    assert.equal(groupOf("2026-10-14T00:30:00Z", NOW), "week"); // Wed 14th: six days before
    assert.equal(groupOf("2026-10-13T22:59:00Z", NOW), "earlier"); // Tue 13th: a week before
    assert.equal(groupOf("2025-12-20T10:00:00Z", NOW), "earlier");
  });
});

test("the day is the reader's own", () => {
  // 04:00 on the 20th in Lagos, but 23:00 on the 19th in New York.
  assert.equal(inZone("Africa/Lagos", () => groupOf("2026-10-20T03:00:00Z", NOW)), "today");
  assert.equal(inZone("America/New_York", () => groupOf("2026-10-20T03:00:00Z", NOW)), "week");
});

test("a 25-hour day when the clocks go back is still one day", () => {
  inZone("Europe/London", () => {
    const now = new Date("2026-10-26T00:30:00Z"); // 00:30 on Mon 26th, the day after BST ends
    assert.equal(groupOf("2026-10-25T00:30:00Z", now), "week");
    assert.equal(groupOf("2026-10-19T23:30:00Z", now), "week"); // 00:30 BST on Tue 20th: six days before
    assert.equal(groupOf("2026-10-19T22:30:00Z", now), "earlier"); // 23:30 BST on Mon 19th: seven
  });
});

test("no readable date is Earlier; a clock ahead of ours is Today", () => {
  inZone("Africa/Lagos", () => {
    assert.equal(groupOf(null, NOW), "earlier");
    assert.equal(groupOf("not a date", NOW), "earlier");
    assert.equal(groupOf("2026-10-21T09:00:00Z", NOW), "today");
  });
});

test("only the groups that have sheets, in order, each keeping the list's order", () => {
  inZone("Africa/Lagos", () => {
    const items = [
      sheet("s1", "2026-10-20T08:40:00Z"),
      sheet("s2", "2026-10-18T09:40:00Z"),
      sheet("s3", "2026-10-18T16:10:00Z"),
      sheet("s4", "2026-10-09T10:00:00Z"),
      sheet("s5", "2026-10-02T10:00:00Z"),
    ];
    assert.deepEqual(shape(group(items, NOW)), [["Today", "s1"], ["This week", "s2", "s3"], ["Earlier", "s4", "s5"]]);
    assert.deepEqual(shape(group(items.slice(3), NOW)), [["Earlier", "s4", "s5"]]);
    assert.deepEqual(Array.from(group(items.slice(1, 3), NOW), (g) => g.key), ["week"]);
    assert.equal(group([], NOW).length, 0);
  });
});
