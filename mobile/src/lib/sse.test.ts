import { test } from "node:test";
import assert from "node:assert/strict";
import { SseParser } from "./sse.ts";

test("named events with JSON data come back whole", () => {
  const p = new SseParser();
  assert.deepEqual(p.feed('event: ready\ndata: {}\n\nevent: job\ndata: {"progress":0.4}\n\n'), [
    { event: "ready", data: "{}" },
    { event: "job", data: '{"progress":0.4}' },
  ]);
});

test("an event without a name is a message; data lines join with newlines", () => {
  const p = new SseParser();
  assert.deepEqual(p.feed("data: one\ndata: two\n\n"), [{ event: "message", data: "one\ntwo" }]);
});

test("comments (the server's ping) and events with no data produce nothing", () => {
  const p = new SseParser();
  assert.deepEqual(p.feed(": ping\n\n"), []);
  assert.deepEqual(p.feed("event: lonely\n\n"), []);
  // The name of an event that was never dispatched does not leak into the next one.
  assert.deepEqual(p.feed("data: x\n\n"), [{ event: "message", data: "x" }]);
});

test("a chunk may stop anywhere, mid-line or mid-field", () => {
  const p = new SseParser();
  assert.deepEqual(p.feed("eve"), []);
  assert.deepEqual(p.feed("nt: ended\nda"), []);
  assert.deepEqual(p.feed('ta: {"jobId":"j1"}\n'), []);
  assert.deepEqual(p.feed("\n"), [{ event: "ended", data: '{"jobId":"j1"}' }]);
});

test("CRLF, a CR split from its LF across chunks, and a lone CR all end a line", () => {
  const p = new SseParser();
  assert.deepEqual(p.feed("event: job\r\ndata: a\r"), []);
  assert.deepEqual(p.feed("\n\r\n"), [{ event: "job", data: "a" }]);
  // The second CR ends the chunk, so it waits to see whether an LF follows; the next line settles it.
  assert.deepEqual(p.feed("data: b\r\r"), []);
  assert.deepEqual(p.feed("data: c\n\n"), [
    { event: "message", data: "b" },
    { event: "message", data: "c" },
  ]);
});

test("one space after the colon is dropped, any more are kept; a bare field has an empty value", () => {
  const p = new SseParser();
  assert.deepEqual(p.feed("data:tight\n\n"), [{ event: "message", data: "tight" }]);
  assert.deepEqual(p.feed("data:   wide\n\n"), [{ event: "message", data: "  wide" }]);
  assert.deepEqual(p.feed("data\n\n"), [{ event: "message", data: "" }]);
});

test("a byte-order mark at the start is ignored; unknown fields are skipped", () => {
  const p = new SseParser();
  assert.deepEqual(p.feed("﻿id: 7\nretry: 5000\nevent: ready\ndata: {}\n\n"), [{ event: "ready", data: "{}" }]);
});

test("many events in one chunk, and none repeated by the next chunk", () => {
  const p = new SseParser();
  const first = p.feed("data: 1\n\ndata: 2\n\ndata: 3");
  assert.deepEqual(first.map((e) => e.data), ["1", "2"]);
  assert.deepEqual(p.feed("\n\n").map((e) => e.data), ["3"]);
  assert.deepEqual(p.feed(""), []);
});
