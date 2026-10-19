// node --test web-site/tests/*.test.mjs
// sse.js is a plain browser script that sets window.NfSse: the event-stream parser assets/app.js follows a job with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/sse.js", import.meta.url), "utf8"), { window, JSON, Math, String });
const S = window.NfSse;
// The vm realm has its own Array and Object, so results are copied into this one to compare.
const plain = (v) => JSON.parse(JSON.stringify(v));
const all = (pieces) => {
  const p = S.parser();
  return plain(pieces.flatMap((piece) => p.feed(piece)));
};

test("the API's three events, as it writes them", () => {
  const stream = 'event: ready\ndata: {}\n\nevent: job\ndata: {"jobId":"a","status":"processing","progress":0.42,"stage":"transcribing"}\n\n: ping\n\nevent: ended\ndata: {"jobId":"a"}\n\n';
  const events = all([stream]);
  assert.deepEqual(events.map((e) => e.event), ["ready", "job", "ended"]);
  assert.equal(S.json(events[1]).progress, 0.42);
  assert.equal(S.json(events[2]).jobId, "a");
});

test("a piece may end anywhere: mid-field, mid-line, between \\r and \\n", () => {
  const stream = 'event: job\r\ndata: {"jobId":"a","progress":0.5}\r\n\r\nevent: ended\r\ndata: {"jobId":"a"}\r\n\r\n';
  const whole = all([stream]);
  assert.equal(whole.length, 2);
  for (let cut = 1; cut < stream.length; cut++) {
    assert.deepEqual(all([stream.slice(0, cut), stream.slice(cut)]), whole, `cut at ${cut}`);
  }
  assert.deepEqual(all(stream.split("")), whole, "one character at a time");
});

test("\\n, \\r\\n and a lone \\r all end a line", () => {
  assert.deepEqual(all(["data: a\n\n", "data: b\r\n\r\n", "data: c\r\r"]).map((e) => e.data), ["a", "b", "c"]);
});

test("several data lines are one event's data, joined with \\n", () => {
  assert.deepEqual(all(["data: one\ndata:two\ndata\n\n"]), [{ event: "message", data: "one\ntwo\n" }]);
});

test("no event line means a message; only one space after the colon is dropped", () => {
  assert.deepEqual(all(["data:  spaced\n\n"]), [{ event: "message", data: " spaced" }]);
});

test("comments, id and retry are skipped, and a blank line with no data dispatches nothing", () => {
  assert.deepEqual(all([": ping\n\n", "id: 7\nretry: 5000\n\n", "event: job\n\n", ":x\n\n"]), []);
});

test("the event name does not leak into the next event", () => {
  assert.deepEqual(all(["event: job\ndata: 1\n\ndata: 2\n\n"]).map((e) => e.event), ["job", "message"]);
});

test("an event cut off by the end of the stream is not dispatched", () => {
  assert.deepEqual(all(["event: ended\ndata: {}\n"]), []);
});

test("a byte-order mark at the very start is ignored", () => {
  assert.deepEqual(all(["﻿event: ready\ndata: {}\n\n"]).map((e) => e.event), ["ready"]);
});

test("data that is not JSON reads as null", () => {
  assert.equal(S.json({ event: "job", data: "nope" }), null);
  assert.equal(S.json({ event: "job", data: "" }), null);
});

test("reconnecting waits 1, 2, 5, 10, then 30 seconds", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(S.reconnectDelay), [1000, 2000, 5000, 10000, 30000, 30000, 30000]);
  assert.equal(S.reconnectDelay(0), 1000);
});
