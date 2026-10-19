/* Server-sent events, read off a fetch() body: the web app follows a job on the API's event stream
 * (GET /api/transcriptions/jobs/{id}/events, /api/preview/jobs/{id}/events) instead of asking every two seconds.
 * EventSource cannot send the Authorization header, and the API takes no token in a URL, so assets/app.js reads
 * the stream itself and hands the text here. Pure, so it is tested (tests/sse.test.mjs).
 */
(function () {
  "use strict";

  /** How long to wait before opening the stream again after the nth failure in a row (n from 1): 1, 2, 5, 10, then 30 s. */
  var RECONNECT_MS = [1000, 2000, 5000, 10000, 30000];
  function reconnectDelay(failures) {
    var i = Math.max(1, failures | 0) - 1;
    return RECONNECT_MS[Math.min(i, RECONNECT_MS.length - 1)];
  }

  /**
   * An incremental parser for the text/event-stream format: feed() it text as it arrives, in pieces of any size,
   * and it returns the events completed so far as { event, data } ("message" when no event: line named one).
   * Lines end in \n, \r\n or \r (a \r\n split across two pieces is one end); comments (":") and the id/retry
   * fields are skipped; several data: lines are joined with \n; an event is dispatched at the blank line after it.
   */
  function parser() {
    var buffer = "", event = "", data = [], hasData = false, skipLF = false, started = false;

    function field(line, out) {
      if (line === "") {
        if (hasData) out.push({ event: event || "message", data: data.join("\n") });
        event = ""; data = []; hasData = false;
        return;
      }
      if (line.charAt(0) === ":") return;
      var colon = line.indexOf(":");
      var name = colon < 0 ? line : line.slice(0, colon);
      var value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.charAt(0) === " ") value = value.slice(1);
      if (name === "event") event = value;
      else if (name === "data") { data.push(value); hasData = true; }
    }

    function feed(chunk) {
      var out = [];
      var text = buffer + (chunk == null ? "" : String(chunk));
      buffer = "";
      if (!started && text.length) {
        started = true;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      var start = 0;
      for (var i = 0; i < text.length; i++) {
        var c = text.charCodeAt(i);
        if (skipLF) {
          skipLF = false;
          if (c === 10) { start = i + 1; continue; }
        }
        if (c === 10 || c === 13) {
          field(text.slice(start, i), out);
          skipLF = c === 13;
          start = i + 1;
        }
      }
      buffer = text.slice(start);
      return out;
    }

    return { feed: feed };
  }

  /** The data of an event as JSON, or null when it is not. */
  function json(record) {
    try { return record && record.data ? JSON.parse(record.data) : null; } catch (e) { return null; }
  }

  window.NfSse = { parser: parser, json: json, reconnectDelay: reconnectDelay, RECONNECT_MS: RECONNECT_MS };
})();
