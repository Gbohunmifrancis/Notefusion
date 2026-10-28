/* The song link inside pasted text: the one rule the worker (server/app/ingest/links.py) applies,
 * mirrored here so a share sheet's "Listen to … on Spotify: https://…" is read the same way
 * everywhere, a wrong link gets a plain answer at once, and only the link itself is sent.
 * The C# API and the mobile app mirror the same rule — keep them in lock-step.
 *
 * Plain script, no build step. Exposes window.NfSongLink.
 */
(function () {
  "use strict";

  var URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
  // A link to one of the services typed without its scheme ("youtube.com/watch?v=…"), read as https://.
  var BARE_LINK = /(?:^|[\s(\[<"'“‘«])((?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|spotify\.com|spotify\.link|app\.link|apple\.com|instagram\.com|tiktok\.com)\/[^\s<>"]+)/i;
  var TRAILING = /[.,;:!?'")\]}>»”’…]+$/;
  var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  var TIKTOK_ID = /^\d{8,24}$/;
  var SHORT_CODE = /^[A-Za-z0-9_-]{4,32}$/;

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

  function providerOf(url) {
    var u;
    try { u = new URL(url); } catch (e) { return null; }
    var host = u.hostname.toLowerCase(), parts = u.pathname.split("/").filter(Boolean);
    if (host === "youtu.be" || host === "www.youtu.be") return parts[0] && VIDEO_ID.test(parts[0]) ? "youtube" : null;
    if (host === "youtube.com" || /\.youtube\.com$/.test(host)) {
      if (parts.length === 1 && parts[0] === "watch") return VIDEO_ID.test(u.searchParams.get("v") || "") ? "youtube" : null;
      if (["shorts", "live", "embed", "v"].indexOf(parts[0]) >= 0) return parts[1] && VIDEO_ID.test(parts[1]) ? "youtube" : null;
      return null;
    }
    if (host === "open.spotify.com") {
      var at = /^intl-[A-Za-z-]+$/.test(parts[0] || "") ? 1 : 0;
      return parts.length === at + 2 && parts[at] === "track" && /^[A-Za-z0-9]+$/.test(parts[at + 1]) ? "spotify" : null;
    }
    if (host === "spotify.link" || host === "spotify.app.link") return parts[0] ? "spotify" : null;
    if (host === "music.apple.com" || host === "geo.music.apple.com") {
      // /<country>/(song|album)/<slug>/<id>, the slug sometimes missing.
      if (parts.length < 3) return null;
      if (parts[1] === "song") return /^\d+$/.test(parts[parts.length - 1]) ? "apple_music" : null;
      if (parts[1] === "album") return /^\d+$/.test(u.searchParams.get("i") || "") ? "apple_music" : null;
      return null;
    }
    if (host === "instagram.com" || host === "www.instagram.com" || host === "m.instagram.com") {
      // /<kind>/<code>/ or /<user>/<kind>/<code>/
      for (var i = 0; i < Math.min(2, parts.length); i++) {
        if (["reel", "reels", "p", "tv"].indexOf(parts[i]) >= 0 && /^[A-Za-z0-9_-]{5,64}$/.test(parts[i + 1] || "")) return "instagram";
      }
      return null;
    }
    if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return parts.length === 1 && SHORT_CODE.test(parts[0]) ? "tiktok" : null;
    if (host === "tiktok.com" || host === "www.tiktok.com" || host === "m.tiktok.com") {
      if (parts.length === 2 && parts[0] === "t") return SHORT_CODE.test(parts[1]) ? "tiktok" : null;
      if (parts.length === 3 && parts[0].charAt(0) === "@" && parts[1] === "video") return TIKTOK_ID.test(parts[2]) ? "tiktok" : null;
      if (parts.length === 2 && parts[0] === "v" && /\.html$/.test(parts[1])) return TIKTOK_ID.test(parts[1].slice(0, -5)) ? "tiktok" : null;
      return null;
    }
    return null;
  }

  /** { url, provider } for the song link in pasted text, or null when there is none we can read. */
  function extract(text) {
    var url = firstUrl(text);
    var provider = url && providerOf(url);
    return provider ? { url: url, provider: provider } : null;
  }

  /** What to tell someone whose text holds no song link we can read. */
  function hint(text) {
    return firstUrl(text)
      ? "That link isn't a single song. Paste a link to a YouTube, Instagram or TikTok video, a Spotify track or an Apple Music song."
      : "Paste a link to a YouTube, Instagram or TikTok video, a Spotify track or an Apple Music song.";
  }

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

  window.NfSongLink = { extract: extract, hint: hint, wire: wire };
})();
