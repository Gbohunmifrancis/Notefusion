# NoteFusion — Illustration Generation Brief (Icons8 AI)

Source of truth for every illustration asset in `mobile/`. Derived from the actual
design tokens in `mobile/src/design/theme.ts` and a screen-by-screen audit.

Target feel: **mature, serious, technical-editorial** — the visual register of a
professional audio tool (Ableton, Linear, Stripe docs), not a consumer toy.
Deliberately *not*: rounded-blob mascots, corporate-memphis figures with oversized
limbs, cartoon faces, confetti, emoji-adjacent shapes.

---

## 0. Art direction decision

**Style: luminous monoline vector.**

Thin-stroke geometric line art (1.5–2 px at 1× / 3–4 px at 2×), strokes filled with a
purple→gold linear gradient, on a fully transparent background, with sparse flat fills
and a soft outer glow. Occasional frosted-glass planes (low-opacity white fills with
hairline white borders) to echo the app's existing glassmorphism.

Why this over the alternatives: the app's entire visual language is already
*glass surfaces + gradient strokes + coloured glow on pitch black*. Monoline vector
extends that language instead of competing with it, stays legible at 40 px and 320 px,
survives being placed over the ambient glow orbs already rendered behind most screens,
and does not date the way 3D-render or isometric styles do. It also keeps stroke weight
consistent across 17 assets, which is what actually makes a set read as "designed"
rather than "assembled."

---

## 1. Master style prompt

Prepend this to **every** asset prompt below.

```
Professional monoline vector illustration for a premium music-transcription mobile app.
Thin uniform geometric line work, 2px stroke weight, rounded stroke caps and joins.
Strokes rendered in a linear gradient from electric purple #A855F7 to warm gold #F59E0B,
running diagonally top-left to bottom-right. Fully transparent background — no black
plate, no card, no drop shadow rectangle. Sparse flat fills only, at 8-15% opacity in
white or purple. Optional frosted glass planes: 6% white fill with a 1px 12% white
hairline border. Soft outer bloom of purple #A855F7 at low opacity around key strokes,
as if the lines are emitting light. Precise, restrained, technical-editorial mood.
Isometric or straight-on orthographic perspective, never dramatic three-quarter.
Generous negative space. Symmetrical and balanced composition. No text, no letters,
no numerals, no watermark. No human faces. Centered subject with even padding on all
four sides.
```

## 2. Master negative prompt

```
cartoon, cartoonish, mascot, corporate memphis, flat blob people, oversized limbs,
faceless figures, doodle, hand-drawn, sketchy, childish, playful, whimsical, cute,
kawaii, confetti, sparkle bursts, sticker, emoji, clipart, stock illustration,
skeuomorphic, glossy 3D plastic, bevel, embossed, drop shadow, photorealistic,
photograph, gradient mesh background, solid background, white background, black plate,
busy, cluttered, noisy texture, grain, rainbow palette, teal, orange, red-orange,
neon green, baked-in text, lettering, typography, logo wordmark, UI chrome,
phone frame, device mockup, browser window
```

## 3. Locked palette

Do not let the generator introduce colours outside this list.

| Token | Hex | Role |
|---|---|---|
| Electric Purple | `#A855F7` | Gradient start, primary stroke |
| Deep Violet | `#7C3AED` | Pressed / darker stroke shade |
| Warm Gold | `#F59E0B` | Gradient end, accent |
| Amber | `#D97706` | Gold's darker partner |
| Electric Pink | `#D946EF` | Brand "Note" half, onboarding slide 1 |
| Success Green | `#22C55E` | High confidence, saved states |
| Danger Red | `#EF4444` | Errors, low confidence |
| Crisp White | `#FFFFFF` | Highlights, glass borders |
| Soft Ash | `#A1A1AA` | Secondary strokes |
| Dim Zinc | `#52525B` | Ghosted / empty-state strokes |

Canvas is always **`#000000` pitch black in situ** — but export on transparency, the
app supplies the black.

## 4. Musical accuracy — non-negotiable

This is a transcription app for musicians. Generic "music note" clipart will read as
amateur to the exact audience the app is for. Every musical element must be correct:

- Staves are **five lines, four spaces**. Never three or six lines.
- Clefs are properly formed treble (G) or bass (F) clefs. No decorative squiggles.
- Note heads sit **on a line or in a space**, never floating between.
- Stems attach on the correct side and point the correct direction relative to the
  middle line.
- Beams are straight, parallel, and connect only eighth-notes or shorter.
- Tonic solfa uses the seven movable-do syllables: **doh re mi fa soh la ti**. If a
  syllable must appear as a shape, use only its first letter form — but prefer to omit
  text entirely and let the app render it.
- Waveforms are symmetrical about a centre axis, not one-sided bars.
- Piano keyboards have the correct 2-then-3 black-key grouping.

---

## 5. Asset manifest

17 assets. File naming: `mobile/assets/illustrations/<name>.svg` (plus `@2x`/`@3x` PNG
fallbacks where SVG is impractical). Sizes are the *rendered* size in the app.

### Group A — Brand & launch

**A1 · `app-icon`** — 1024×1024, opaque `#000000` background (the one exception to
transparency), for `app.json` `icon` + Android adaptive foreground.
```
A single abstract mark combining a stylised treble clef spiral with an audio waveform
that unfurls from the clef's tail, the waveform bars stepping upward. Clef stroke in
electric purple #A855F7 transitioning to warm gold #F59E0B along its length. Strong
purple bloom behind the mark. Geometric, tightly cropped, high contrast, instantly
readable at 48px. Centered, generous margin.
```

**A2 · `splash-mark`** — 240×240, transparent. Sits behind the animated NoteFusion
wordmark on `SplashScreen`, inside the existing pulsing pink/purple orbs.
```
A minimal concentric mark: three nested rings of increasing radius, the innermost solid,
the outer two dashed with even dash gaps, suggesting sound radiating outward. A single
small filled note head sits at the exact centre. Innermost ring electric pink #D946EF,
middle ring electric purple #A855F7, outer ring warm gold #F59E0B at 40% opacity.
Very restrained, almost architectural. Perfect radial symmetry.
```

**A3 · `auth-mark`** — 80×80, transparent. Replaces the `♪` text glyph currently inside
the gradient rounded-square on `LoginScreen`; also used as the new `RegisterScreen`
header (which currently has no illustration at all).
```
A compact glyph: an eighth note whose stem extends upward and bends into a short
horizontal waveform of four peaks. Contained within an implied rounded-square boundary
without drawing the boundary. Pink-to-purple gradient stroke, #D946EF to #A855F7.
Extremely simple, three or four strokes total, legible at 32px.
```

### Group B — Onboarding heroes

These are the highest-value assets. They replace the three 180×180 gradient bubbles with
Ionicons inside them on `OnboardingScreen` — currently the weakest, most generic moment
in the app. **Render at 280×280, transparent.** All three must share identical stroke
weight, identical perspective, and identical visual density so they read as a triptych
when swiped between.

**B1 · `onboarding-capture`** — slide 1, "Record a melody". Accent `#D946EF`.
```
A microphone rendered as precise geometry: a capsule-shaped grille body with a fine
vertical mesh pattern, mounted on a slim yoke and a low circular base. Concentric arcs
radiate from the grille toward the upper right, three arcs of decreasing opacity,
representing incoming sound. A single small filled note head floats within the outermost
arc. Microphone strokes in electric pink #D946EF to electric purple #A855F7 gradient.
Arcs in purple at descending opacity. Straight-on orthographic view. Calm and precise,
studio-equipment mood rather than podcast-mic mood.
```

**B2 · `onboarding-transcribe`** — slide 2, "Instant transcription". Accent `#A855F7`.
```
A transformation composition, left to right: on the left, a symmetrical audio waveform
of eight bars about a centre axis; in the middle, a narrow vertical frosted glass panel
with a 6% white fill and hairline white border; on the right, a correct five-line musical
staff bearing a properly formed treble clef and four beamed eighth notes whose head
positions mirror the heights of the waveform bars on the left. The waveform bars
visually dissolve into the staff notes as they cross the glass panel. Waveform in
electric purple #A855F7, staff and notes in warm gold #F59E0B. The mirroring between
waveform heights and note pitches must be visually obvious.
```

**B3 · `onboarding-rekey`** — slide 3, "Save & re-key". Accent `#F59E0B`.
```
A five-line staff with a treble clef and a short run of five note heads, and beneath the
staff a horizontal slider track with a circular handle positioned at its centre. A
curved arrow loops from the slider handle back up to the key signature area of the
staff. Two faint ghosted duplicates of the note run sit slightly above and slightly
below the primary run at 20% opacity, indicating the labels shifting while the pitches
stay fixed. Staff and notes in warm gold #F59E0B to amber #D97706 gradient. Slider and
arrow in electric purple #A855F7. The ghost duplicates must be clearly secondary.
```

### Group C — Home & Record

**C1 · `home-listen-hero`** — 120×120, transparent. Anchors the "Tap to Listen &
Transcribe" card on `HomeScreen`, replacing the bare `radio` Ionicon in a circle.
```
A radar-style listening motif: a filled centre dot with four concentric expanding rings,
each ring a broken arc rather than a closed circle, gaps rotating progressively so the
composition feels alive. Two tiny filled note heads sit on the second and fourth rings.
Centre dot and inner rings in warm gold #F59E0B, outer rings fading into electric purple
#A855F7 at descending opacity. Perfect radial symmetry, dense at the centre, airy at the
edge.
```

**C2 · `record-analysing`** — 160×160, transparent. Shown during the `uploading`/
`processing` phase on `RecordScreen`, where there is currently only a percentage number.
```
A spectral analysis motif: a vertical column of eleven horizontal bars of varying
lengths, left-aligned to a common axis, arranged in a smooth envelope shape from short
to long to short. A thin horizontal scan line crosses the stack, and where it intersects
each bar a small circular node appears. Bars in electric purple #A855F7 with the two
longest in warm gold #F59E0B. Scan line in crisp white #FFFFFF at 60% opacity. Clinical,
instrumentation-panel mood.
```

**C3 · `record-ready-backdrop`** — 280×280, transparent, sits behind the central record
button on `RecordScreen` at low opacity.
```
An extremely faint background texture: a grid of small plus-shaped tick marks arranged
on a circular polar layout, denser toward the outer edge, absent in the central 40%
where the record button will sit. Uniform electric purple #A855F7 at 12% opacity. No
gradient, no glow. Purely a subtle depth cue, must never compete with foreground UI.
```

### Group D — Empty & success states

**D1 · `empty-library`** — 160×160, transparent. Replaces the `folder-open-outline`
Ionicon in the gradient bubble on `LibraryScreen`'s empty state.
```
An open archival drawer or shallow tray drawn in isometric projection, empty, with three
thin divider slots visible inside. A single small note head rests at the very bottom of
the tray, and one faint dashed outline of a card floats just above the opening as if
about to be filed. Tray strokes in dim zinc #52525B. The note head and dashed card in
electric purple #A855F7 at 50% opacity. Quiet and neutral in mood — an invitation, not a
failure. Restrained, no sad expressions of any kind.
```

**D2 · `empty-recent`** — 96×96, transparent. `HomeScreen` empty recent-transcriptions
card.
```
A five-line staff with a treble clef but no notes on it, and a single dashed circular
outline hovering in the first bar where a note would go. Staff in dim zinc #52525B,
dashed circle in electric purple #A855F7. Minimal, four or five strokes. Reads instantly
as "nothing here yet."
```

**D3 · `result-success`** — 140×140, transparent. Header illustration for
`ResultScreen`'s "Transcription Complete" state.
```
A five-line staff bearing a correctly formed treble clef and a complete phrase of six
beamed notes, with a circular badge overlapping the lower-right corner of the staff
containing a clean geometric checkmark. Staff and notes in electric purple #A855F7 to
warm gold #F59E0B gradient. Badge ring and checkmark in success green #22C55E. Composed
and confident, celebratory only through completeness — absolutely no confetti, bursts,
or radiating celebration lines.
```

**D4 · `saved-confirm`** — 80×80, transparent. `ResultScreen` saved-state row and any
save confirmation.
```
A bookmark ribbon shape in outline with a small note head centred inside it, and a fine
horizontal baseline beneath suggesting a shelf. Ribbon in warm gold #F59E0B to amber
#D97706 gradient. Note head and baseline in warm gold at 60% opacity. Compact, three
strokes, legible at 32px.
```

### Group E — Errors & guidance

Consistent construction across all three: the subject drawn in outline, with a single
diagonal element or slash rendered in danger red `#EF4444`. Never alarming, never a
skull, warning triangle, or exclamation burst.

**E1 · `error-mic-permission`** — 120×120, transparent. `RecordScreen` permission-denied
card.
```
The same capsule microphone geometry as the onboarding capture illustration, but drawn
entirely in dim zinc #52525B with no radiating sound arcs, and a single clean diagonal
line crossing it from lower-left to upper-right in danger red #EF4444. A small open
padlock shape sits at the lower right in soft ash #A1A1AA. Factual and calm, not
alarming.
```

**E2 · `error-low-confidence`** — 120×120, transparent. Surfaces the PRD's honest-
confidence requirement when a transcription is uncertain.
```
A five-line staff bearing a treble clef and four notes, where two of the note heads are
drawn as solid filled circles and the other two are drawn as dashed uncertain outlines.
A small circular gauge sits beside the staff with its indicator needle resting in the
lower third of its arc. Staff and solid notes in soft ash #A1A1AA. Dashed uncertain
notes and the gauge needle in warm gold #F59E0B. Communicates partial certainty rather
than outright failure.
```

**E3 · `error-network`** — 120×120, transparent. Upload and polling failures.
```
A symmetrical audio waveform about a centre axis, but broken by a vertical gap in its
exact middle, with the two halves offset slightly from the shared axis. A small circular
node floats in the gap, unconnected to either half. Waveform in soft ash #A1A1AA,
disconnected node and the gap edges in danger red #EF4444. Clean, diagrammatic, quiet.
```

### Group F — Decorative

**F1 · `solfa-watermark`** — 200×200, transparent. Replaces the oversized `♪` text
character currently used as a watermark inside the Tonic Solfa hero card on
`ResultScreen`.
```
A very large single eighth note rendered in outline only, with an unusually thin 1px
stroke, cropped by the composition edge so only about two thirds of it is visible.
Uniform electric purple #A855F7 at 8% opacity, no gradient, no glow. Purely a texture
element — must be barely perceptible and never compete with the solfa text rendered on
top of it.
```

**F2 · `avatar-default`** — 96×96, transparent. `ProfileScreen` fallback when a user
has no name to derive initials from.
```
An abstract head-and-shoulders silhouette constructed entirely from three concentric
arc segments rather than a solid filled shape, with a small note head positioned where a
face would be, replacing any facial features. Arcs in electric purple #A855F7 to warm
gold #F59E0B gradient. Strictly non-representational — no eyes, no mouth, no hair, no
skin tone. Reads as a person without depicting one.
```

---

## 6. Delivery spec

- **Format**: SVG preferred. Where Icons8 AI outputs raster only, request PNG at 3×
  the rendered size with a fully transparent alpha channel, then export `@1x`/`@2x`/`@3x`.
- **Trim**: no baked padding beyond ~8% breathing room; the app controls spacing.
- **No baked text.** Every string in this app is rendered by React Native and will be
  localised. An illustration with letters in it becomes untranslatable.
- **Consistency check before accepting a set**: place all 17 side by side on a
  `#000000` canvas at their true rendered sizes. Stroke weight must appear uniform,
  perspective must not vary, and no single asset should be noticeably denser than the
  others. Regenerate outliers rather than accepting a mismatched set.
- **Destination**: `mobile/assets/illustrations/`. This directory does not exist yet —
  neither does `mobile/assets/`.

## 7. Wiring notes

Adopting these assets also requires, outside of Icons8:

- Create `mobile/assets/illustrations/`.
- Register `icon`, `splash`, and `android.adaptiveIcon.foregroundImage` in
  `mobile/app.json` — none are currently declared, so the app ships Expo's default icon.
- Add `react-native-svg` if delivering SVG (not currently a dependency).
- Fix the purple-on-purple hero card in `mobile/src/screens/HomeScreen.tsx`: the card
  uses `colors.ink` and the icon circle inside it uses `colors.accent`, both of which
  resolve to `#A855F7` in the current dark theme. No illustration will resolve that.
