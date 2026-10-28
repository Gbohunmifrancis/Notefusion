/* The link inside pasted text, so a share sheet's "Listen to … on Spotify: https://…" is cut down to
 * its link and only the link is sent: the rule the worker's extract_url (server/app/ingest/links.py)
 * applies, as the C# API's SongLinks and the phone's lib/songLink do. Whether a link is a song we can
 * read is the worker's alone: any link is sent, and one it cannot use comes back as the API's plain
 * TRANS_INVALID_LINK sentence.
 *
 * Plain script, no build step. Exposes window.NfSongLink.
 */
(function () {
  "use strict";

  var URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
  // A link to one of the services typed without its scheme ("youtube.com/watch?v=…"), read as https://.
  var BARE_LINK = /(?:^|[\s(\[<"'“‘«])((?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|spotify\.com|spotify\.link|app\.link|apple\.com|instagram\.com|tiktok\.com)\/[^\s<>"]+)/i;
  var TRAILING = /[.,;:!?'")\]}>»”’…]+$/;

  /**
   * The first http(s) link in the text, or else the first link to a service typed without "https://", with
   * sentence punctuation trimmed off its end; or null.
   */
  function firstUrl(text) {
    var s = String(text || ""), m = URL_IN_TEXT.exec(s), bare = m ? null : BARE_LINK.exec(s);
    var url = m ? m[0] : bare ? "https://" + bare[1] : null;
    url = url && url.replace(TRAILING, "");
    // A bare scheme ("https://.") is not a link, as the worker also rules.
    return url && url.length > "https://".length ? url : null;
  }

  /** { url } for the link in pasted text, or null when it holds none. The server says whether it is a song. */
  function extract(text) {
    var url = firstUrl(text);
    return url ? { url: url } : null;
  }

  /** What to tell someone whose text holds no link at all. */
  function hint() {
    return "Paste a link to a YouTube, Instagram or TikTok video, a Spotify track or an Apple Music song.";
  }

  /**
   * A lookup refused only for now (YouTube, Instagram or TikTok not answering at this moment): the job reads the
   * link again itself and a failed one costs nothing, so Transcribe stays, with NOT_NOW said instead of the refusal.
   * A refusal for good (no video, private, live, too long) or a link that is not a song still stops it.
   */
  function notNow(code) {
    return code === "TRANS_LINK_REFUSED" || code === "TRANS_LINK_POST_REFUSED";
  }
  var NOT_NOW = "We couldn't read this song's details just now. Transcribe still tries it, from the start.";
  /** The longest Transcribe waits on a lookup still going before it sends the link from the start. */
  var GRACE_MS = 6000;

  /**
   * Pasted share text is cut down to its link as it lands, with a plain hint when there is none,
   * and an optional Paste button reads the clipboard (shown only where the browser allows that).
   * ``say`` puts the hint on screen; an empty string clears it. ``onChange``, when given, is told
   * every time the value may have changed (typing, a paste once tidied, the Paste button).
   */
  function wire(input, pasteButton, say, onChange) {
    function changed() { if (onChange) onChange(); }
    function tidy() {
      var raw = input.value.trim();
      if (!raw) { say(""); changed(); return; }
      var found = extract(raw);
      if (found) { input.value = found.url; say(""); } else say(hint(raw));
      changed();
    }
    input.addEventListener("input", function () { say(""); changed(); });
    input.addEventListener("paste", function () { setTimeout(tidy, 0); });
    if (!pasteButton || !navigator.clipboard || !navigator.clipboard.readText) return;
    pasteButton.hidden = false;
    pasteButton.addEventListener("click", function () {
      navigator.clipboard.readText().then(function (text) {
        input.value = String(text || "").trim();
        if (input.value) tidy(); else say("There's nothing to paste yet. Copy the song's link first.");
        input.focus();
      }, function () {
        say("Your browser didn't let us read what you copied. Press and hold (or right-click) the box and choose Paste.");
        input.focus();
      });
    });
  }

  window.NfSongLink = { extract: extract, hint: hint, wire: wire, notNow: notNow, NOT_NOW: NOT_NOW, GRACE_MS: GRACE_MS };
})();
