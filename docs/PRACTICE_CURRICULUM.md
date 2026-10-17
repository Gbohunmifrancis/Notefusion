# Practice curriculum

How NoteFusion's Practice gets harder as a singer grows, what it is modelled on, and the rules that move a singer
along it. The code is `src/NoteFusion.Application/Practice/` — `DrillSyllabus` (the grades), `DrillCatalogue` (the
patterns), `PracticePath` (the path and its rules), `PracticeRules` (every number). Tests pin all of it
(`tests/NoteFusion.Tests/Practice/`).

Nothing here copies exam material. The tables below summarise what each body's *public syllabus* says a candidate is
asked to do at each grade; every NoteFusion pattern is our own, written in tonic solfa and labelled by our solfa engine.

## 1. What the recognised bodies ask

### ABRSM aural tests (all Practical Grades except Jazz and Singing for Musical Theatre)

Source: ABRSM, *Piano Practical Grades Syllabus 2023 & 2024*, "Aural test requirements", pp. 40–47 — the requirements
are the same for every instrument and for Singing. <https://www.abrsm.org/sites/default/files/2024-06/Piano%202023%20&%202024%20Prac%20syllabus%2020230807.pdf>

| Grade | Singing task | Range | Keys | Length | Also tested |
|---|---|---|---|---|---|
| Initial | Sing back two phrases as echoes | tonic–mediant | major | 1 bar, 4/4 | clap a rhythm |
| 1 | Sing back three phrases as echoes, in time | tonic–mediant | major | 2 bars | where a pitch change is |
| 2 | Echoes, as Grade 1 | tonic–dominant | major | 2 bars | pitch or rhythm change |
| 3 | Echoes, as Grade 1 | an octave | major or minor | 2 bars | change in up to 4 bars; major/minor |
| 4 | Sing back a melody heard twice; **sing 5 notes from score** | octave; score test within a 3rd of the tonic, no interval over a 3rd | up to 3♯/3♭; score test C, F, G | — | |
| 5 | Sing back a melody; **sing 6 notes from score** | score test a 5th above to a 4th below the tonic; 3rds, plus the rising 4th dominant–tonic | score test up to 2♯/2♭ | — | |
| 6 | Sing the upper part of a two-part phrase; **sing a melody from score** with accompaniment | an octave | up to 3♯/3♭, major or minor | — | perfect/imperfect cadences |
| 7 | Sing the lower part of a two-part phrase; sing the upper part of a two-part phrase from score | an octave | up to 4♯/4♭ | — | interrupted cadence, chords, modulation to dominant/subdominant/relative minor |
| 8 | Sing the lowest part of a three-part phrase; sing the lower part of a two-part phrase from score | an octave | up to 4♯/4♭ | — | plagal cadence, chords, two modulations |

### ABRSM Singing: sight-singing (cumulative)

Source: ABRSM, *Singing Practical Grades* qualification specification (syllabus from 2018), sight-singing parameters
table, p. 13. <https://www.abrsm.org/sites/default/files/2023-10/Singing%20Practical%20Grades%20Qualification%20Specification_0.pdf>
Grades 1–5 have no words (any vowel or sol-fa); 6–8 have optional English words. Half a minute to prepare.

| Grade | Length | Keys added | Time | Range | Intervals added | Rhythm and other features added |
|---|---|---|---|---|---|---|
| 1 | 4 bars | C, G, F major | 4/4 | about a 6th (C4–D5 treble) | major/minor 2nds only, stepwise, diatonic, no repeated notes | simple minim and crotchet rhythms; f, p, hairpins |
| 2 | 4 bars | D major | 3/4 | about a 6th | rising major/minor 3rds within the tonic chord | dotted minim, dotted crotchet, quaver |
| 3 | 8 bars | B♭ major, A minor | | about an octave (C4–D5) | rising and falling 3rds, cadential rising 4ths, repeated notes | quaver groups, rests, slowing at the end |
| 4 | 8 bars | A, E♭ major; E, D minor | 6/8 | B♭3–D5 | rising 4ths, rising and falling octaves | semiquaver patterns, dotted rhythms |
| 5 | 8 bars | E major; B, G minor | | | perfect 5ths, falling 4ths | semibreve, ties, phrase marks |
| 6 | 8–10 bars | A♭ major, C minor | | B♭3–E♭5 | major/minor 6ths, occasional chromatic notes | slurs, accents |
| 7 | 8–10 bars | F♯ minor | | | occasional minor 7ths, chromatic semitones | **triplets**, staccato, a tempo |
| 8 | 8–12 bars | C♯, F minor | | | diminished 7ths | ff |

ABRSM's *Singing for Musical Theatre* tests (syllabus 2025 edition, p. 148) follow the same order with a few shifts:
C4–D5 to Grade 3 and B♭3–D5 from Grade 4; minor keys from Grade 2; ties and **simple syncopation** at Grade 3;
6ths, minor 7ths and occasional chromatic notes at Grade 6; triplets at 7; octaves and a change of time signature at 8.
<https://www.abrsm.org/sites/default/files/2025-01/SfMT%20Practical%20Grades%20Syllabus%20G1-8%202025%20(20250130).pdf>

### Trinity College London: singing sight reading (cumulative)

Source: Trinity, *Singing Syllabus* (from 2023), "Parameters for sight reading tests", pp. 71–72. The test is an
interval sung from a given note, a rhythm clapped, then a short accompanied melody containing that interval.
Trinity's aural test asks no singing. <https://www.trinitycollege.com/resource?id=7929>

| Grade | Interval test | Bars | Keys added | Max range | Time | Note values added | ♩ = | Modulation / accidentals |
|---|---|---|---|---|---|---|---|---|
| Initial | major 2nd | 4 | C major | 3rd | 2 | crotchet | 72 | |
| 1 | minor 3rd | 4 | | 5th | 2 | minim | 76 | |
| 2 | major 3rd | 4 | F, G major | 5th | 3, 4 | dotted minim | 78 | |
| 3 | perfect 5th | 4 | | 5th | 3, 4 | quavers | 80 | |
| 4 | perfect 4th | 4 | D, A, E minor | 6th | 2, 3, 4 | dotted crotchet–quaver | 82 | sharpened 7ths |
| 5 | minor 2nd, octave | 4 | | octave | 2, 3, 4 | triplet | 84 | |
| 6 | major/minor 6th | 8 | B♭, D major; G, B minor | 9th | 3, 4, 6 | straight 6/8 | 84 | to the dominant; flat, natural, sharp |
| 7 | major/minor 7th | 8 | | 9th | 3, 4, 6 | dotted 6/8 | 84 | to the subdominant |
| 8 | all major, minor and perfect | 8 | A, E♭ major; F♯, C minor | 10th | 3, 4, 6, 9 | semiquavers | 84 | to the relative key |

### The Kodály sequence

A teaching order, not an exam: sources differ in detail and teachers adapt it. Melodic order: the falling minor 3rd
**s–m** first, then **l**, then **d** and **r** (the do-pentatonic), then the extended pentatonic (**low l, low s,
high d'**), la-based pentatonic, then **f** and **t**, the major scale, la-based minor, then new keys and modes.
Rhythm: crotchet (*ta*) and quaver pairs (*ti-ti*) first, then the crotchet rest, minim, triple time, dotted minim,
semiquavers, dotted crotchet–quaver, and **syncopation** last. Sources: Wikipedia, "Kodály method"
<https://en.wikipedia.org/wiki/Kod%C3%A1ly_method>; a teacher's published sequence, Dynamic Music Room
<https://dynamicmusicroom.com/kodaly-for-older-beginners/>.

### Curwen and the Tonic Sol-fa College

Source: John Curwen, *The Standard Course of Lessons and Exercises in the Tonic Sol-fa Method* (rewritten 1900),
"Requirements for the examinations of the Tonic Sol-fa College", pp. 380–381, and its six Steps.
<https://archive.org/details/standardcourseof00curwuoft>. The College's graded certificates from 1869; "from the
elementary certificate upwards the power to sing at sight is demanded" (Grove, 1884,
<https://en.wikisource.org/wiki/A_Dictionary_of_Music_and_Musicians/Tonic_Sol-fa_College,_The>).

The Standard Course's order: Step 1 **d m s**; Step 2 **t r** (the soh chord); Step 3 **f l** (the whole scale);
Step 4 transition of one remove (**fe**, **ta**); Step 5 the minor (lah) mode; Step 6 two and three removes, then the
chromatic scale.

| Certificate | Modulator (pointing) | Sight-singing | Time | Ear |
|---|---|---|---|---|
| Junior (≈ 3 months' class) | sol-fa a voluntary at M. 60 with leaps to any scale tone; no transition, no minor | 8 notes or a chant tune, major scale only, nothing shorter than a pulse | a Junior time test on one note | name d m s sung to *laa* |
| Elementary | a voluntary with transition of one remove | pitch the key from C, then sing to *laa* a test: major scale, no transition, nothing shorter than a pulse | two Elementary time tests | name any three scale tones in step order |
| Intermediate | voluntaries with one remove (to *laa*), and two and three removes and the minor (sol-fa) | a test with one remove, half-pulses allowed; and a minor-mode test | an Intermediate time test | write down two phrases of 4 and 6 tones |
| Advanced | — | sing at sight, to words, with transitions to the 2nd–4th removes | triplets, write down a four-measure test | write the tune and chords of a hymn tune |

### RCM (Royal Conservatory), voice ear tests (optional)

Source: *Voice Syllabus*, 2019 edition. <https://rcmusic-kentico-cdn.s3.amazonaws.com/rcm/media/main/documents/examinations/syllabi/s48_voice-syllabus-2019_online_f_r.pdf>
Intervals sung, ascending and descending: Preparatory m3, M3; Level 1 adds P5; Level 2 P4; Level 3 the octave;
Level 4 m6, M6; Level 5 m2, M2; Level 6 m7, M7; Level 7 the tritone; Levels 8–10 any interval within the octave.
Sight-singing: Preparatory–Level 2 five notes tonic to dominant (C; C, F; C, G, F), Level 3 a full octave (C, G, D, F).

## 2. NoteFusion's graded syllabus

The blend: **Curwen's and Kodály's order of notes** (steps around doh, the doh chord, the scale, leaps, low soh and
lah, the minor, then fe, ta and de), **ABRSM's keys, cumulatively, grade for grade**, and ABRSM's and Trinity's
widening intervals, ranges and rhythms. "Grade N" names the *musical vocabulary* of that grade's sight-singing tests —
the hardest material of the grade's last unit — not exam readiness: our drills are 3–16 notes, far shorter than an
exam's 4–12 bars, and are sung after hearing them. Advanced 1 and 2 (Focused only) go past Grade 8's density and
length; they are named after the Tonic Sol-fa College's Advanced certificate.

Every grade's numbers live in `DrillSyllabus.All`; every pattern is tested against its grade's row.

| Grade (tier) | Focus | Notes | Range | Widest leap | Keys (doh) | Rhythm added | Chromatic | ♩ = (units 1–5) |
|---|---|---|---|---|---|---|---|---|
| Grade 1 (0) | Steps around doh | 3–7 | a 4th | a step | C, F, G | held notes | — | 72–80 |
| Grade 2 (1) | The doh chord | 3–7 | a 6th | a 5th, in the doh chord only | + D | quavers | — | 76–84 |
| Grade 3 (2) | Scales | 4–8 | an octave | a 4th (a 5th in the chord) | + B♭ | dotted minim | — | 80–88 |
| Grade 4 (3) | Leaps | 4–8 | an octave | a 5th; octaves | + A, E♭ | dotted crotchet | — | 80–88 |
| Grade 5 (4) | Below doh, and wider | 4–9 | a 9th | a 6th; octaves | + E | ties over the bar | — | 84–92 |
| Grade 6 (5) | Lah: the minor | 3–10 | a 9th | a 6th (minor 6th) | + A♭; minor: A, E, D, B, G, C | syncopation | minor's se | 84–92 |
| Grade 7 (6) | Te: chromatic notes | 3–10 | a minor 10th | a 6th | + F♯ minor | — | fe, de, ta | 88–96 |
| Grade 8 (7) | Choir-ready | 5–12 | a 10th | a minor 7th | + C♯, F minor | crotchet triplets | all | 88–96 |
| Advanced 1 (8) | Wide leaps | 5–12 | a 10th+ (A3–D5) | a major 7th, dim. 7th, tritone | all | all | all | 84–92 |
| Advanced 2 (9) | Sight-singing | 8–16 | A3–D5 | a major 7th | all | all | all | 88–96 |

Every drill is placed so all its notes lie between A3 and D5 (a man sings an octave down; the grader accepts it).
No drill note is shorter than 0.3 s at its tempo: quavers at most 96 BPM, crotchet triplets, never semiquavers or
quaver triplets (see §5).

### The units of each grade (easiest first)

Each grade has five units; a pattern's unit is its `Step`. A unit's patterns share a theme and a tempo (each unit 2
BPM quicker than the last), and the last unit's lines are always longer than the first's.

| Grade | Units |
|---|---|
| Grade 1 | Doh, ray, me · Up and home · Fah and repeated notes · Held notes and te below · Longer lines |
| Grade 2 | Soh and me · Up the chord and back · Chord and steps · Quaver pairs · Longer chord lines |
| Grade 3 | Five-note scales · The whole scale · Thirds · Fourths and quavers · Long scale lines |
| Grade 4 | Leaps of a fifth · Leaps of a fourth · The octave · Dotted rhythms · Leaps in longer lines |
| Grade 5 | Low soh · Down to low lah · Low soh to soh · Sixths and ties · Wide lines, tied |
| Grade 6 | Low lah in the doh key · Lah is home · Se, the leading note · Minor sixths and syncopation · Longer minor lines |
| Grade 7 | Fe, de and ta · Chromatic turns · Neighbour notes · Chromatic lines · Turning to soh and fah |
| Grade 8 | Long hymn lines · Minor and chromatic lines · Sevenths and dotted hymns · Triplets · Modulating phrases |
| Advanced 1 | Sixths · Minor sevenths · Major sevenths and the minor · Diminished sevenths and tritones · Wide leaps in rhythm |
| Advanced 2 | Hymn lines · Minor and chromatic lines · Turning to new keys · Syncopation and triplets · Long phrases |

154 patterns: 15 or 16 a grade on the ladder, 16 and 17 in the Advanced grades, at least 3 a unit.

### Levels and grades

The eight levels (Doh 0 … Choir-ready 3000 XP) are unchanged: they come from XP, which every marked take earns
whatever it was. The **path** is separate: where a singer is on it comes from the takes they *passed*. A level
decides only where a path starts (the grade a singer enters at the first take on a track):

| Level | XP | Starts at (no track / Playful) | Starts at (Focused) | Roughly |
|---|---|---|---|---|
| Doh | 0 | Grade 1 | Grade 3 | ABRSM Grade 1 sight-singing, Trinity Initial–1, Kodály d r m, Curwen Junior |
| Ray | 100 | Grade 2 | Grade 4 | ABRSM Grade 2, Trinity 1–2, Kodály s–m–l, Curwen Step 1 |
| Me | 250 | Grade 3 | Grade 5 | ABRSM Grade 3, Trinity 3, Curwen Steps 2–3 (Elementary) |
| Fah | 500 | Grade 4 | Grade 6 | ABRSM Grade 4, Trinity 3–5 |
| Soh | 900 | Grade 5 | Grade 7 | ABRSM Grade 5, Trinity 5–6, RCM Level 4 |
| Lah | 1400 | Grade 6 | Grade 8 | ABRSM Grade 6, Curwen Step 5 (Intermediate's minor) |
| Te | 2000 | Grade 7 | Advanced 1 | ABRSM Grade 6–7, Trinity 6–7, Curwen Step 4 |
| Choir-ready | 3000 | Grade 8 (Playful: Grade 7) | Advanced 2 | ABRSM Grade 7–8, Curwen Intermediate–Advanced |

A full ladder is 8 grades × 5 units × 4 drills = 160 passes, 2,400–3,200 XP at 15–20 XP a passed take (more with
retries) — about the 3,000 XP of Choir-ready, so the two climb together for a singer who passes most drills.

## 3. The path

Practice is a lesson path — grades → units → drills — not a drill of the day. After every marked take the server
offers the next drill at once (`GET /api/practice/drills/next`; `/drills/today` is kept as an alias for shipped
apps and answers the same).

**Moving on** (`PracticePath.Advance`; numbers in `PracticeRules`):

- A take marked **80 or more** (`PassScore` = `GoodScore`) passes the drill: on to the unit's next drill.
- Under 80, the **same drill comes back once**; under 80 again, an **easier variant** (a pattern of the unit before,
  or the grade before's last unit, at its slower tempo), and another for each further miss, until one is passed.
- In one day's session: **two takes of 90+ in a row skip** the unit's next drill (never a new unit's first), and
  **two under 50 in a row step back** to the unit's previous drill (at a unit's first drill, an easier variant).
- Passing a unit's last drill finishes the unit and starts the next. Past the path's end, its last unit is sung again
  ("Review"), in new orders and keys.

**Deterministic, server-side.** Where a singer is, on each track, is read off their `PracticeSession` drill rows in
order, every time; no client reports anything. A unit's patterns are ordered by a hash of the user, the unit and the
lap, and the drill at a position is that order's pattern there, in a key picked by a hash of the user, the unit and
the position — so a refresh, another device or a reinstall shows the same next drill. Only a take of the drill the
path offered at the time moves it: singing a drill again for practice earns XP but leaves the path where it is.

**Milestones** are derived, not stored: the take that finished a unit is the one whose grade response carries
`milestone` (`kind: "unit"`, "Unit 3 of Grade 2 complete", what it taught), and the take that finished a grade's last
unit carries the grade's (`kind: "grade"`, "Grade 2 complete", "You can now …"). Each unit and each grade is a
milestone once, whichever track finished it. Deriving them (like XP) means no new table and no migration; the cost is
that a future change to the units re-reads history, which is the same trade XP already makes.

**Tracks** keep their own place on their own path:

- **No track**: Grades 1–8, every pattern, 4 drills a unit.
- **Playful**: Grades 1–7, only each grade's first three units and only its gentle patterns (major, at most 5 notes,
  crotchets and held notes, no chromatic notes before Grade 7), 3 drills a unit, 12 BPM slower. The same pass, retry,
  skip and step-back rules apply, but every step lands on that gentler slice — a smaller step than the full path's —
  and its easier variants come from the gentle units too.
- **Focused**: starts two grades ahead of the singer's level and goes on to Advanced 1 and 2.

**Allowance.** 10 marked drills a day free (it was 5, which stopped a session halfway through its first unit; 10 is a
unit, a retry or two and the start of the next), 20 on Pro. The 150 XP daily cap still bounds levelling. When the
drills run out the clients say so warmly with when they come back ("That's all 10 of today's drills. Well sung! More
from midnight."): `allowance.resetsAtUtc` is the singer's next local midnight. No new upgrade prompt.

**On the wire** (`DrillDto`): `grade`, `unit`, `unitIndex`/`unitCount`, `drillIndex`/`drillCount` (1-based),
`difficulty` (the pattern's unit in its own grade, 1–5) and `adjustment` (`"harder"` after a skip, `"easier"` for an
easier variant or a step back, else `"steady"`). `PracticeProgressDto.path` carries the same place plus units and
grades finished. The clients show "Grade 2 · Unit 3 · 4 of 6" with a thin bar under the drill's title, and after a
marked take a primary **Next drill** ("Next one!" on Playful; "Try it again" when the path brings the same drill
back) with **Sing it again** beside it.

## 4. What is not modelled

- **Bridge notes.** A hymn book writes a modulation with a bridge tone carrying both keys' names; our solfa engine
  labels every note in one key, so modulating drills use fe and ta in the home key (Curwen's "imperfect method").
- **Rhythm notation.** The clients show the syllables; a drill's rhythm is heard (the count-in and "Hear it") and
  graded, not printed in tonic sol-fa's time marks.
- **Time signatures** other than 4/4, cadence and chord recognition, and two-part singing are not drilled.
- The Kodály order varies between teachers; the table above is one published sequence and Wikipedia's summary.

## 5. Can the grader judge these rhythms?

The worker (`server/app/pipeline/grade.py`) aligns the whole take once, then judges each note on the median pitch
sung while it was due, skipping its first 15% and last 10%. pyin's frames are 23 ms, so a 0.3 s note is judged on
about ten frames. `server/tests/test_grade.py` sings syncopated, tied-and-triplet and dotted drills at 96 BPM (the
fastest drill tempo) with every note up to 60 ms early or late: every note is marked right, and a wrong quaver is
still caught. Probing further, every note stayed right up to ±120 ms of jitter and the score first slipped (to 94)
at ±150 ms. Semiquavers (0.16 s at 96 BPM) and quaver triplets were left out for that reason.
