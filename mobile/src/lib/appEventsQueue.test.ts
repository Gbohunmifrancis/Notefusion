import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DETAIL_MAX,
  MAX_KEPT,
  NAME_MAX,
  dropsBatch,
  eventName,
  formatDetail,
  makeEvent,
  mergeQueue,
  nativeToInput,
  newEventId,
  readKept,
  retryDelay,
  withoutSent,
} from "./appEventsQueue.ts";

const ID = /^[A-Za-z0-9_-]{8,40}$/;

test("details are flat key=value pairs, empty values left out, booleans as 1/0", () => {
  assert.equal(formatDetail({ from: "tile", sec: 42, pro: true, via: null, gone: undefined, blank: "" }), "from=tile;sec=42;pro=1");
  assert.equal(formatDetail(undefined), null);
  assert.equal(formatDetail({ only: null }), null);
});

test("a value cannot smuggle in another pair", () => {
  assert.equal(formatDetail({ reason: "a;b=c" }), "reason=a b c");
  assert.equal(formatDetail({ "bad key=": "x" }), "badkey=x");
});

test("details are cut to the server's column", () => {
  const long = formatDetail({ note: "x".repeat(400) })!;
  assert.equal(long.length, DETAIL_MAX);
});

test("a native event keeps its time and name", () => {
  const at = Date.UTC(2026, 9, 22, 18, 0, 0);
  const { id, ...rest } = nativeToInput({ name: "listen_take_end", detail: "reason=cap", at });
  assert.deepEqual(rest, { name: "listen_take_end", detail: "reason=cap", occurredAt: "2026-10-22T18:00:00.000Z" });
  assert.match(id!, ID);
  assert.equal(nativeToInput({ name: "listen_button_hidden", detail: "", at }).detail, null);
});

test("the kept list drops the oldest past its bound", () => {
  const make = (i: number) => ({ id: `id${i}xxxxxx`, name: `e${i}`, detail: null, occurredAt: new Date(i).toISOString() });
  const kept = Array.from({ length: MAX_KEPT - 1 }, (_, i) => make(i));
  const merged = mergeQueue(kept, [make(1000), make(1001)]);
  assert.equal(merged.length, MAX_KEPT);
  assert.equal(merged[0].name, "e1");
  assert.equal(merged[merged.length - 1].name, "e1001");
});

test("names are made to fit the server's pattern", () => {
  assert.equal(eventName("listen_take_end"), "listen_take_end");
  assert.equal(eventName("Score Exported!"), "score_exported_");
  assert.equal(eventName("3rd-try"), "e_3rd_try");
  assert.equal(eventName("_x"), "e__x");
  assert.equal(eventName("x".repeat(80)).length, NAME_MAX);
  for (const n of ["Hello World", "9", "", "a.b-c", "ÄÖ"]) assert.match(eventName(n), /^[a-z][a-z0-9_]*$/);
});

test("every event gets an id the server takes, and no two alike", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 2000; i++) ids.add(newEventId());
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, ID);
  // Even a random source that always says 0, and a time of 0.
  assert.match(newEventId(0, () => 0), ID);
  assert.match(newEventId(Date.UTC(2100, 0, 1), () => 0.999999), ID);
});

test("an event is stamped with its time, a fitting name and its details", () => {
  const e = makeEvent("Result Opened", { source: "saved" }, Date.UTC(2026, 9, 22));
  assert.equal(e.name, "result_opened");
  assert.equal(e.detail, "source=saved");
  assert.equal(e.occurredAt, "2026-10-22T00:00:00.000Z");
  assert.match(e.id!, ID);
});

test("what an older build kept is read back with ids, and junk is dropped", () => {
  const kept = readKept([
    { name: "a", detail: "x=1", occurredAt: "2026-10-01T00:00:00.000Z" },
    { id: "keepthisid", name: "b", occurredAt: "2026-10-02T00:00:00.000Z" },
    null,
    { name: 3 },
    "nope",
  ]);
  assert.equal(kept.length, 2);
  assert.match(kept[0].id!, ID);
  assert.equal(kept[1].id, "keepthisid");
  assert.equal(kept[1].detail, null);
  assert.deepEqual(readKept({ not: "a list" }), []);
});

test("only the events sent leave the list, even when it was trimmed or added to meanwhile", () => {
  const make = (i: number) => ({ id: `ev${i}aaaaaa`, name: `e${i}`, detail: null, occurredAt: new Date(i).toISOString() });
  const batch = [make(0), make(1), make(2)];
  // While the batch was on its way the oldest was trimmed and two more were logged.
  const now = [make(1), make(2), make(3), make(4)];
  assert.deepEqual(withoutSent(now, batch).map((e) => e.name), ["e3", "e4"]);
});

test("a batch is let go only when the server refuses it as it stands", () => {
  assert.equal(dropsBatch(400), true);
  assert.equal(dropsBatch(413), true);
  for (const status of [0, 401, 403, 404, 408, 429, 500, 502, 503]) assert.equal(dropsBatch(status), false, String(status));
});

test("a failed send is tried again after 4 s, 15 s and a minute, then waits for the app to move", () => {
  assert.equal(retryDelay(0), null);
  assert.equal(retryDelay(1), 4_000);
  assert.equal(retryDelay(2), 15_000);
  assert.equal(retryDelay(3), 60_000);
  assert.equal(retryDelay(4), null);
});
