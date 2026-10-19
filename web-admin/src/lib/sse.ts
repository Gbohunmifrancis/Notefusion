/**
 * Server-sent events, read a chunk at a time: the live notices' feed (`liveFeed.ts`) arrives through fetch's body
 * reader and each decoded chunk is fed here. The same parser as the phone's (`mobile/src/lib/sse.ts`).
 *
 * The parts of the format the API uses: `event:` and `data:` lines, a blank line ending an event, lines
 * starting `:` as comments (the server's keep-alive ping), and `\n`, `\r\n` or `\r` line ends. A chunk may
 * stop anywhere, even between a `\r` and its `\n`.
 */

export interface SseEvent {
  /** The `event:` name, or "message" when the event had none. */
  event: string;
  /** The `data:` lines, joined with "\n". */
  data: string;
}

export class SseParser {
  private buffer = "";
  private started = false;
  private eventType = "";
  private data: string[] = [];

  /** Feeds the next slice of the stream; returns the events it completed, in order. */
  feed(chunk: string): SseEvent[] {
    if (!chunk) return [];
    this.buffer += chunk;
    if (!this.started) {
      // A byte-order mark at the very start is not part of the first line.
      if (this.buffer.length === 0) return [];
      if (this.buffer.charCodeAt(0) === 0xfeff) this.buffer = this.buffer.slice(1);
      this.started = true;
    }
    const out: SseEvent[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (c !== "\n" && c !== "\r") continue;
      // A "\r" that ends the chunk may be the first half of "\r\n": wait for the next chunk to say.
      if (c === "\r" && i + 1 === this.buffer.length) break;
      const line = this.buffer.slice(start, i);
      if (c === "\r" && this.buffer[i + 1] === "\n") i++;
      start = i + 1;
      this.line(line, out);
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  private line(line: string, out: SseEvent[]): void {
    if (line === "") {
      // An event without data is not dispatched (as in the browser's EventSource); its name is dropped too.
      if (this.data.length > 0) out.push({ event: this.eventType || "message", data: this.data.join("\n") });
      this.eventType = "";
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.eventType = value;
    else if (field === "data") this.data.push(value);
    // id and retry are not used: the client keeps its own reconnect rules (liveFeed.ts).
  }
}
