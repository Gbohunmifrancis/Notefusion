# Play Store listing assets

Everything Google Play asks for as an image, built from the app's own stylesheets
and the app's own Solfa engine. Two commands, in this order:

```bash
node mobile/store/render.mjs
```

```bash
python mobile/store/graphics.py
```

`render.mjs` must run first — `graphics.py` composites a piece it captures.

The walkthrough video frames come out of a third command and are documented in
[SHOTLIST.md](SHOTLIST.md):

```bash
node mobile/store/video.mjs
```

## What to upload

| Play field | File | Spec it meets |
|---|---|---|
| App icon | `out/icon-512.png` | 512×512, 32-bit PNG, under 1024 KB |
| Feature graphic | `out/feature-graphic.png` | 1024×500, 24-bit PNG, no alpha |
| Phone screenshots | `out/screenshots/01-home.png` … `06-library.png` | 1080×1920, six of them, in that order |

Play needs at least two screenshots to publish and shows up to eight. The
filenames are numbered because the listing displays them in the order you upload
them, and the order is the pitch: what the app makes, then how little it asks of
you to make it.

## What not to upload

`out/device/` holds the same six screens bare, at 1236×2745. They are the source
the frames scale down, and Play rejects them: an image's long edge may not exceed
twice its short edge, and 2745 is more than 2×1236. `out/parts/` holds the one
element crop the feature graphic composites. Both are gitignored, along with
`.build/`, which is the HTML the browser loads — and `out/video/` and
`.build-video/`, which belong to the walkthrough rather than the listing.

## How the screens are made

There is no device and no signed build in this loop. `lib/screens.mjs`,
`lib/record.mjs` and `lib/result.mjs` rebuild the screens as HTML at 412×915 CSS
px — a Pixel 6/7/8 window, so one CSS px is one React Native dp and every number
in those files is the number from the stylesheet it came from. Poppins and
Ionicons load from `mobile/node_modules`, so the type is the app's type.

Four React Native behaviours are emulated on purpose, because without them the
pages lie: `flex-shrink: 0` globally (RN never shrinks a child below its
content, so a screen that is too tall overflows here exactly as it would on a
device), `box-sizing: border-box`, every `div` defaulting to a column flex
container the way every RN `View` does, and `position: relative` on every `div`,
which is a `View`'s real default. That last one is what makes an overlay behave:
CSS paints a positioned sibling over an in-flow one regardless of document order,
where RN paints siblings in document order — without it the splash's gradient
covered its own wordmark.

One thing is *not* faithful. `typography.mono` asks Android for `monospace` and
gets Roboto Mono; there is no monospace TTF in `node_modules`, so the solfa lines
fall through to Chromium's default — Consolas on Windows, slightly narrower.

The framed tile scales the live page in the browser with a CSS `transform`
rather than downscaling a finished PNG, so every glyph is re-rasterised at the
size it ends up at instead of being resampled.

## The notation is real

`lib/music.mjs` is the app's Solfa engine ported verbatim from `src/lib/solfa.ts`.
The only authored data is twelve MIDI pitches in `lib/sample.mjs`; every syllable,
octave mark and confidence colour on screen is derived from them. The stave is
engraved by `mobile/assets/engraver/index.html` — the same OSMD asset `ScoreView`
loads in its WebView — from MusicXML built out of those same twelve notes, and
`result({ view: "staff" })` throws rather than fall back to drawing one. Nothing
is drawn by hand from an idea of what the output looks like, so the screenshots
cannot promise notation the app would not produce.

Two consequences worth keeping:

- The melody sits inside one doh-octave for **both** G major and C major, which
  is what makes `05-rekey.png` legible — the same twelve notes, relabelled, no
  octave marks piling up.
- `conf` index 7 is below 0.5 on purpose, so the "1 note below 50% confidence"
  row appears. The PRD requires low confidence to be visible; a screenshot that
  hides it is selling a different product.

`USER.trialTotal` tracks `FreeTier.TrialGenerations`, and the feature graphic's
"5 free transcriptions" line is the same number. If that constant moves, both are
false claims on a public listing.

## The build checks itself

`render.mjs` fails loudly rather than shipping a bad tile. It reports, per screen:

- Anything clipped on a screen with no `ScrollView` — Record must fit, or it is
  broken on a device too.
- A solfa line that wrapped or overflowed its column.
- A caption that wrapped to two lines. All six are one line, which keeps the blue
  rule at the same height on every tile; two lines would move it and read as
  sloppy when they are swiped side by side.

When anything trips, the generated HTML is kept in `.build/` so it can be opened
and poked at. A clean run deletes it.

The measuring itself lives in `lib/checks.mjs` because `video.mjs` runs the same
pass — plus one of its own: a beat that pans onto a subject re-measures afterwards
and fails if the subject is not actually on screen.

`graphics.py` asserts that every string it draws lands inside a 60px safe box,
because Play crops the feature graphic differently on different surfaces and a
silent overflow ships as clipped copy.

## Concept art is not a screenshot

`mobile/assets/Notefusion-home.png` and its siblings are concept art. They show a
Tools grid, a "Backup your library" banner and a Transcribe tab that the app does
not have. Uploading them would be a misleading listing under Play policy. The
screenshots here show only screens that exist.

## Still needed by hand

Play also wants copy this directory does not generate: the app name, short
description (80 chars), full description (4000), and a privacy-policy URL. The
tablet and TV screenshot slots are optional and empty.
