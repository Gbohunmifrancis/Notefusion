# Walkthrough video — shot list

The introduction video: what NoteFusion does, and how to get around it. Nineteen beats
in the order a first-time user meets them — install, sign up, find the mic, record, read
the result, re-key, save, find it again.

```bash
node mobile/store/video.mjs
```

Two sets come out of that one command:

| Set | Size | Use |
| --- | --- | --- |
| `out/video/device/NN-name.png` | 1236×2745 (412×915dp at 3×) | The bare screen. Pan and zoom these yourself — nothing is cropped for you. |
| `out/video/frame/NN-name.png` | 1080×1920 | The same screen inside a phone on the brand wash. Already 9:16, drop straight onto the timeline. |

**No words are burnt into either set.** A title baked into a PNG cannot be re-timed,
re-worded or translated, so every on-screen title below is a text layer you add in the
edit. That is also why this file exists.

Every frame is rendered from the app's own markup in `lib/`, at the real Pixel-class
window, so this cannot advertise a screen the app doesn't have. The stave on `13-staff`
is engraved by the same OSMD asset `ScoreView` loads in its WebView.

## Timing

Total **68 s** at the durations below. For a 30 s cut keep `01 · 06 · 09 · 11 · 13 · 14 ·
17 · 19` and trim each to the shorter figure in brackets — 26 s, and it still shows the
one thing no competitor has: change the key, keep the take.

## What is deliberately not here

- **No Upgrade / paywall screen.** `UpgradeScreen`'s feature list currently promises more
  than ships. Selling it on video is a claim we would have to keep.
- **No "Sing louder or hold closer to the mic" banner** on the Record beats. It is good
  behaviour live, but frozen in a still it reads as a fault.
- **No Settings screen.** The theme switch is Home's own moon/sun icon — beat 18 — so a
  Settings detour would only add a step the viewer doesn't need.

---

## 01 · `01-splash.png` — Cold open

- **On screen** Deep blue gradient with its diagonal sheen, the brand mark at 150dp with
  its waves, **Notefusion**, and the tagline *Hear it. See it. Notate it.* Staff ribbon
  along the bottom edge.
- **How you got here** Tapping the icon. Nothing to teach yet.
- **Title** — (let the wordmark carry it)
- **VO** "This is NoteFusion."
- **Duration** 2 s
- **Note** The splash is a fixed blue in both themes; it shows before the stored theme has
  been read off disk, so there is no light/dark variant to cut to.

## 02 · `02-onboarding-record.png` — Promise 1 of 3

- **On screen** The record animation on its soft-blue disc, **Record a melody**, *Capture
  a live tune or hum — a few bars is all it takes. Sing, hum, or play near the mic.*
  Three dots, first one filled. `Skip` top-right, `Next` at the foot.
- **How you got here** The splash hands over on its own.
- **Title** "Sing it"
- **VO** "Hum a few bars — that's the whole input."
- **Duration** 3 s

## 03 · `03-onboarding-transcribe.png` — Promise 2 of 3

- **On screen** **Instant transcription**, *We turn your audio into Tonic Solfa and staff
  notation, perfectly on-key every time.* Second dot filled.
- **How you got here** Tap `Next`.
- **Title** "Get the notation"
- **VO** "It comes back as Tonic Solfa and as a stave."
- **Duration** 3 s

## 04 · `04-onboarding-rekey.png` — Promise 3 of 3

- **On screen** **Save & re-key**, *Build a personal library and change the key anytime —
  your notes never shift, only the labels do.* Third dot filled, and the button has
  become `Get started`.
- **How you got here** Tap `Next` again.
- **Title** "Change the key, keep the take"
- **VO** "Change key whenever you like. The notes stay put — only the labels move."
- **Duration** 3 s

## 05 · `05-register.png` — Sign up

- **On screen** The mark, wordmark, **Create your account**, *Start your musical journey*.
  Four filled fields — name, email, password, confirm — then `Sign up`, an `or` divider,
  `Sign up with Google`, and *Already have an account? Sign in*.
- **How you got here** Tap `Get started`.
- **Title** "One account"
- **VO** "Make an account, or come in with Google."
- **Duration** 3.5 s
- **Note** Shown filled rather than empty on purpose: an empty form is four grey boxes and
  teaches nothing. The name matches the account every later beat is signed in as, so the
  video runs as one session.

## 06 · `06-home.png` — Home, and the map of the app

- **On screen** Avatar top-left; moon and bell top-right. *Good morning, Francis* / *What
  will you transcribe today?* The mic stage card — **Tap to start recording** / *or import
  audio file*. Then **Recent**, `See all`, and three saved takes. Tab bar: Home ·
  the centre mic · Library.
- **How you got here** Signing up lands here.
- **Title** "Home"
- **VO** "Home. Three places to be: here, the mic, and your library."
- **Duration** 4 s [3 s]
- **Note** Fits the window with room to spare — no pan needed. Hold on the tab bar long
  enough to read it; it is the app's whole navigation.

## 07 · `07-drawer.png` — The one tap nobody guesses ★

- **On screen** Home dimmed behind a 320dp panel: **Francis Okoye** / *View profile*, then
  **Your plan** with a `FREE` badge, **Your library**, **Settings and privacy**, **Help &
  support**, and **Sign out** in red.
- **How you got here** **Tap the avatar in Home's top-left corner.**
- **Title** "Tap your avatar"
- **VO** "Your plan, your profile and your settings live behind the avatar — top left."
- **Duration** 4 s
- **Note** The beat this video exists for. The tab bar used to have five items; profile and
  subscription moved in here, so anyone hunting the tab bar for their plan will not find
  it. Animate a tap indicator on the avatar over beat 06 going into this frame.

## 08 · `08-record-ready.png` — Before the take

- **On screen** **Listening** as the title, the trial pill *4 of 5 free transcriptions
  left*, the Melody / Polyphonic toggle with Melody chosen, the **Key Signature** chip row
  with `Auto` selected, the mic disc, **Tap to record**, `00:00`, *Sing, hum, or play near
  the mic for accurate Solfa extraction.* and an `Import audio file` pill.
- **How you got here** Tap the centre mic in the tab bar (or Home's stage card).
- **Title** "Pick a key, or let it find one"
- **VO** "Leave the key on Auto, or name it up front. Then tap once."
- **Duration** 3.5 s
- **Note** Both pickers are live here — full strength. They fade on the next beat because
  a take locks them, which is the difference to show.

## 09 · `09-record-live.png` — Recording

- **On screen** The button has gone red with a stop square, two ripple rings mid-pulse,
  the waveform up, the green level meter at about three-quarters. **Listening…**, `00:12`,
  *Tap the button again when you're done.*, and `Stop & Transcribe`. The mode and key
  pickers are faded — locked for the take.
- **How you got here** Tap the mic.
- **Title** "It's listening"
- **VO** "Sing. The meter tells you it can hear you."
- **Duration** 4 s [3.5 s]

## 10 · `10-record-working.png` — Working

- **On screen** `62%` / *analysing* inside the disc, **Transcribing Solfa & Staff…**,
  `62%`, *You can leave this screen — we'll notify you when it's ready.*, a progress bar
  and a spinner in place of the button label.
- **How you got here** Tap `Stop & Transcribe`.
- **Title** "You can walk away"
- **VO** "Stop when you're done. You don't have to wait here — it'll notify you."
- **Duration** 3 s

## 11 · `11-solfa.png` — The result

- **On screen** `Preview` header. Summary card: **G major** under *Key · tap to change*,
  **84 BPM**, **3/4**, then the `88% · High confidence` badge and *1 note below 50%
  confidence — review it →*. Below it the **TONIC SOLFA** card with the Solfa / Staff
  toggle, the solfa lines with the first one large, and the ♪ watermark.
- **How you got here** The job finishes and opens itself.
- **Title** "Tonic Solfa"
- **VO** "Here it is in Tonic Solfa — and it tells you which note it was least sure of."
- **Duration** 5 s [4 s]
- **Note** Don't crop the low-confidence row out. Honest uncertainty is a feature, and the
  sample take carries exactly one note under 50% so that this row is on screen.

## 12 · `12-play.png` — Hear it back

- **On screen** Panned to the **PLAY BACK** card: the pause button, the scrubber at about
  a third, `0:06` / `0:18`, and the syllable chips with the fifth one lit.
- **How you got here** Scroll down and tap play.
- **Title** "Play it back"
- **VO** "Play it back and the syllables light up in time."
- **Duration** 4 s
- **Pan** 91dp — measured from the card's own box, not guessed.

## 13 · `13-staff.png` — The same take, engraved

- **On screen** The toggle flipped to **Staff**, the header now reading **STAFF
  NOTATION**, and the engraved stave: treble clef, one sharp for G major, 3/4, six bars
  across four systems, the solfa syllable under every note, and the one low-confidence
  head in red among the green.
- **How you got here** Tap `Staff` on the toggle in the card header.
- **Title** "Or read it on a stave"
- **VO** "Same take, one tap, engraved."
- **Duration** 4.5 s [3.5 s]
- **Pan** 268dp. Real engraving from the app's own renderer — if a bar break looks odd in
  the video it looks the same on a phone.

## 14 · `14-rekey.png` — Re-key, the thing to remember ★

- **On screen** The key picker open inside the summary card: *Change the Doh — your notes
  stay put, only the labels move.* over a row of key chips with **C major** selected — and
  the solfa card beneath now reading in C.
- **How you got here** Tap the **Key** stat in the summary card; it says *tap to change*.
- **Title** "Re-key without re-recording"
- **VO** "Wrong key for your choir? Tap the key and pick another. Nothing gets
  re-recorded — only the labels change."
- **Duration** 5 s [4 s]
- **Note** Cut 11 → 14 back to back if you can spare the frames. Seeing the same lines
  re-labelled is the clearest thing in the whole video.

## 15 · `15-save.png` — Name it

- **On screen** Panned to the save block: **Save to Library**, *Give this transcription a
  name so you can find it later.*, a **Title** field holding *Choir rehearsal — soprano
  line*, the `Save to Library` button, and the `Re-key` / `Edit` / `Save` row.
- **How you got here** Keep scrolling past the export block.
- **Title** "Name it"
- **VO** "Give it a name."
- **Duration** 3.5 s
- **Pan** 460dp

## 16 · `16-saved.png` — Saved

- **On screen** **Saved to Library** / *You can find it in the Library tab.* in a tinted
  row with a check, the Title field above the now-disabled `Rename` button.
- **How you got here** Tap `Save to Library`.
- **Title** —
- **VO** "Saved."
- **Duration** 2.5 s
- **Pan** 472dp

## 17 · `17-library.png` — Find it again

- **On screen** **Library**, a `Search notes...` bar, the **All** / **Tonic Solfa** /
  **Staff Notation** filters with All chosen, and eight takes — each with its title, date
  and time, and a type badge.
- **How you got here** Tap **Library** in the tab bar.
- **Title** "Everything you've done"
- **VO** "Every take is in your library — searchable, and filterable by notation."
- **Duration** 4 s [2.5 s]

## 18 · `18-home-dark.png` — Dark mode

- **On screen** Home again, dark palette, and a sun where the moon was.
- **How you got here** Tap the **moon** in Home's header. Tap the sun to come back.
- **Title** "Light or dark"
- **VO** "One tap for dark."
- **Duration** 2.5 s
- **Note** Cross-dissolve 06 → 18; they are the same layout, so the theme is the only
  thing that moves. This is why no Settings screen is needed.

## 19 · `19-outro.png` — Close

- **On screen** The mark, **Notefusion**, the tagline, then three pills — *Record a few
  bars* · *Get Solfa and a stave* · *Re-key without re-recording* — over **5 free
  transcriptions to start** and **notefusion.studio**.
- **Title** "notefusion.studio"
- **VO** "Record a few bars. Get Solfa and a stave. Re-key without re-recording. Five free
  transcriptions to start — NoteFusion."
- **Duration** 4 s [3.5 s]
- **Note** Every claim on this card is something the app does today, and the free count
  tracks `FreeTier.TrialGenerations`. If that constant changes, this frame is wrong —
  re-render rather than re-title.

---

## Editing notes

- **Where the pans came from.** Beats 12, 13, 15 and 16 are taller than a phone window.
  The renderer loads each page at rest, measures the subject's box, and pans by the number
  that puts its top just under the status bar — then re-checks that the subject is really
  on screen and fails the build if it isn't. Don't nudge them by eye in the editor; change
  `focus` and re-render.
- **Tap indicators.** Beats 07, 13, 14 and 18 turn on a tap the viewer cannot infer from
  the frame. Put the indicator on the previous frame and cut on the tap.
- **Motion.** The frames are stills of animated screens frozen at a real point in the
  animation — the pulsing orb, the ripple rings, the Lottie slides, the spinner. A slow
  push-in on the device set reads as motion without pretending to be a screen recording.
- **Don't retype the copy.** Every string above is the app's own, quoted from `lib/`. If a
  title layer paraphrases a screen the video stops matching the product.
