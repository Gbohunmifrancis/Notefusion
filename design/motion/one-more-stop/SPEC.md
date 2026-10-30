# One more stop — NoteFusion Practice, 9:16, 20 s

A 20-second vertical film for TikTok, Reels, Shorts and WhatsApp status. Singers climb the practice path with Doh:
one drill sung, the path climbing stop after stop, the streak and XP growing, a level-up on the drop, and the
NoteFusion mark. Built from the app's own art, piano and colours; no stock, no AI video.

Built with the aygramm.ai workflow ("Make any brand move"), on the tools already here instead of HyperFrames: one HTML
page drawn as a pure function of time (`film.html`, `render(t)`), frames captured by headless Chromium, the score
written in code from the app's own piano (`score.py`), both reading the same cue times (`timeline.json`).

## Numbers

| Word | Number |
|------|--------|
| Size | 1080 × 1920, 30 fps, 600 frames; safe area 96 px left/right, 220 px top, 300 px bottom |
| Tempo | 120 BPM: a beat is 0.5 s, a bar 2 s; 10 bars. Every scene change is on a bar |
| Drop | 12.00 s (bar 7), the level-up |
| Canvas | Night `#07090E`; two slow glows (green `#3DDC97` 18 %, blue `#2F7BFF` 16 %), 900 px, drifting on a 20 s loop |
| Accent | Game green `#3DDC97` on its lip `#22A06E`; blue `#4C8DFF`; orange `#FF9F43` for the flame only. One accent word per line |
| Type | Geist 800, headline 104 px / −3 % tracking; labels 40 px 700; chips 64 px 800; numbers tabular |
| Stops | 168 px circles on a 14 px lip, 300 px apart on a winding path (x = ±170 px about the centre) |
| Eases | In `cubic-bezier(.2,.8,.2,1)` (out-expo-ish), 0.45 s; out `(.6,0,.8,.2)`, 0.3 s; pops overshoot 1.18 → 1.0 in 0.28 s; nothing appears without one |
| Text | Holds still while it is read: in 0.4 s, held at least 1.2 s, out 0.3 s |
| Motion | Something always moves: the glows drift, the path breathes ±4 px, idle Doh blinks |
| 3D | One hero object: the level emblem, spun as a coin (3 turns, out-expo, 1.1 s) with a 6 px motion blur at speed |

## Shots (one line each: start, hero move, what is read, hand-off)

1. **0.00 Hook.** Frame 0 reads "Sing your way up." over the path; START pulses (scale 1 → 1.06, 1 s); Doh waves beside it. A finger dot glides in from the right at 1.2 → hands off by tapping START at 2.00.
2. **2.00 Tap.** START grows into the drill card (0.45 s); "d r m f s" chips grey → each turns green on its beat (2.50, 3.00, 3.50, 4.00, 4.50) as the piano sings it; Doh sings. → the score.
3. **5.00 Score.** "92" counts up in 0.5 s; three stars pop at 5.50. → the card shrinks back into its stop at 6.00, now a done stop with a star.
4. **6.00 Climb.** The path scrolls down one stop a beat (8 stops by 10.00); each stop flips locked → done as it passes, a mode name flashing on four of them (Scales, Intervals, Rhythm, Which note?); the flame counts 1 → 7; XP fills to 90 %; the unit chest opens at 9.00. → the XP bar.
5. **10.00 Build.** The path dims; the XP bar comes to the middle and fills 90 → 100 % by 11.50; "Level up…" holds; a riser. → the bar collapses into a point at 11.85.
6. **12.00 Drop.** The 3D Ray emblem spins in from that point as a coin; confetti from the app's own pieces; "Level 2 · Ray" holds. → the emblem rises.
7. **14.00 Streak.** The emblem moves up and shrinks; the seven-in-a-row badge pops in beside it; "7-day streak"; Doh cheers. → the emblem flips.
8. **16.00 Mark.** The emblem flips over into the NoteFusion mark; "Practise free." and "notefusion.studio". → holds.
9. **18.00 End.** The end card holds to 20.00; the music resolves on C.

## Sound

The score is in C at 120 BPM from the app's recorded piano: a pad and the C chord (bar 1), Doh's tune d r m f s on
the chips' beats (bars 2–3), a climbing pentatonic note per stop over C–Am–F–G with hats and a light kick (bars 4–5),
a snare roll and riser into a beat of silence (bar 6), the full beat on the drop (four-on-the-floor, claps on 2 and 4,
sub bass, chord stabs, the tune an octave up) and the resolve (bars 9–10). Every visible action has its sound, its
peak on the frame: the tap, each chip, each stop, the stars, the chest, the coin's whoosh, the shimmer of the mark.
Mastered to −14 LUFS, true peak ≤ −1 dBTP, measured again after encoding.

## Rebuild

    cd design/motion/one-more-stop
    python3 score.py              # build/score.wav: the score and every sound, mastered to -14 LUFS
    node render.cjs --stills      # build/contact.jpg: the key moments on one sheet; check it before rendering
    node render.cjs               # build/one-more-stop.mp4: 1080x1920, 30 fps, -14 LUFS, true peak <= -1 dBTP

Needs Node with Playwright's Chromium, ffmpeg and Python 3 with numpy. `build/` is not committed.
