/** Types mirroring the C# Web API's JSON wire contract (src/NoteFusion.* DTOs). */

// --- Auth ---------------------------------------------------------------

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * All that registration returns — deliberately no tokens. The account is not usable
 * until the emailed code is entered, and `verify-email` is what issues the session.
 *
 * The email comes back rather than being reused from the form because the server
 * normalises it (trimmed, lower-cased), and the verify call has to send the string
 * the row is actually keyed on.
 */
export interface RegistrationResponse {
  email: string;
}

export interface MyProfile {
  id: string;
  fullName: string;
  email: string;
  role: string;
  profilePictureUrl: string | null;
  /** False for Google-only accounts, which never set a password. */
  hasPassword: boolean;
  createdAt: string;
}

/**
 * GET/PUT /api/me/email-preferences (C# `EmailPreferencesDto`). `founderNotes` is false once the account
 * unsubscribed from the founder's notes (the email's link or the Notifications switch); mail about the
 * account itself always goes.
 */
export interface EmailPreferences {
  founderNotes: boolean;
}

// --- Transcriptions -----------------------------------------------------

export type TranscriptionStatus = "pending" | "processing" | "done" | "failed";

export interface NoteEvent {
  pitchMidi: number;
  startBeat: number;
  durBeats: number;
  degree: number;
  solfa: string;
  octaveMark: string;
  conf: number;
}

/** A chord quality as the worker reads it. */
export type ChordQuality = "maj" | "min" | "7" | "maj7" | "min7" | "dim" | "sus4";

/**
 * One chord heard under the tune, over a run of beats. `root` and `bass` are pitch
 * classes (0 = C); `bass` only for a slash chord. `symbol` is the letter name spelled
 * in the key ("Dm", "Bb", "G/B"), `solfa` the root's syllable relative to doh.
 * Mirrors the C# `ChordSymbolDto`.
 */
export interface ChordSymbol {
  startBeat: number;
  durBeats: number;
  root: number;
  quality: ChordQuality;
  bass: number | null;
  symbol: string;
  solfa: string;
}

/** The song a linked transcription came from — the acknowledgement line and the sheet's credit. */
export interface TranscriptionSource {
  provider: "youtube" | "spotify" | "apple_music" | "instagram" | "tiktok" | string;
  url: string;
  title: string;
  artist: string;
  thumbnailUrl?: string | null;
  /** True when the store's 30-second preview stood in for the full song; `notice` says so. */
  preview?: boolean | null;
  notice?: string | null;
  /** The section the user chose, in seconds from the start of the song; absent when they took the first part. */
  startSeconds?: number | null;
  endSeconds?: number | null;
  /** The whole song's length in seconds, when the service knew it. */
  durationSeconds?: number | null;
}

/**
 * What a pasted link points at before anything is transcribed, so the app can show the song and let
 * the user pick a section of it. `maxSeconds` is the most of the song this account may have in one go
 * (a free account's minute, Pro's six); `durationSeconds` is null when the length is not known.
 * Mirrors the C# LinkInfoDto.
 */
export interface LinkInfo {
  provider: "youtube" | "spotify" | "apple_music" | "instagram" | "tiktok" | string;
  url: string;
  title: string;
  artist: string;
  thumbnailUrl?: string | null;
  durationSeconds: number | null;
  maxSeconds: number;
}

/**
 * Another key the sung notes fit nearly as well, offered when the doh is unsure. `pitches` are the
 * result's notes written in its scale, index for index. Mirrors the C# KeyAlternativeDto.
 */
export interface KeyAlternative {
  key: string;
  pitches: number[];
  /** The sheet engraved in this key (the web uses it; the app engraves its own). */
  musicXml?: string;
}

/**
 * A hymn in the library the transcribed tune clearly matches (the worker's `hymn_match`). Mirrors the C#
 * HymnMatchDto. `kind` "score": the hymnbook version follows, written in the key that was sung — the
 * published notes, rhythm, time signature and pickup, the take's pace as `tempo`, the first verse as
 * `lyrics` — for the "Use the hymnbook version?" prompt. `kind` "incipit": recognition only; the tune is
 * named and linked, and none of the score fields is set. `credit` is the line the hymn's page shows.
 */
export interface HymnMatch {
  slug: string;
  title: string;
  tune: string;
  url: string;
  source: string;
  licence: string;
  credit: string;
  kind: "score" | "incipit" | string;
  confidence: number;
  key?: string | null;
  timeSignature?: string | null;
  tempo?: number | null;
  pickup?: number | null;
  notes?: NoteEvent[] | null;
  solfaLines?: string[] | null;
  musicXml?: string | null;
  lyrics?: string | null;
}

/** The hymn a saved sheet is the hymnbook version of, with its credit. Mirrors the C# HymnCreditDto. */
export interface HymnCredit {
  slug: string;
  title: string;
  url: string;
  credit: string;
}

export interface TranscriptionResult {
  key: string;
  keyConfidence: number;
  /** Only when the doh is unsure: the other keys it could be, nearest first (at most two). */
  keyAlternatives?: KeyAlternative[] | null;
  /** Only when the tune clearly matches a hymn in the library: the hymn, and its hymnbook version. */
  hymnMatch?: HymnMatch | null;
  tempo: number;
  timeSignature: string;
  musicXml: string;
  midiBase64: string;
  notes: NoteEvent[];
  solfaLines: string[];
  overallConfidence: number;
  /**
   * Where beat 0 falls in the source audio, in seconds. With `backingAudioBase64` it is
   * what lets the notated melody play over the song's own backing in time: the audio
   * time of beat b is beatOriginSec + b * 60 / tempo. Mirrors the C# DTO.
   */
  beatOriginSec?: number;
  /**
   * Optional: entry i is the audio time (s) of notation beat i, increasing, for a song whose tempo moves. Null or
   * absent: beat b is at beatOriginSec + b * 60 / tempo (lib/backingClock). Mirrors the C# DTO.
   */
  beatTimesSec?: number[] | null;
  /**
   * The job has the song's backing: it was separated and a voice was found. The app asks for the job with
   * `?backing=false` and fetches the audio on its own (`transcriptionsApi.backing`). Absent from an older server.
   */
  hasBacking?: boolean;
  /**
   * Separated jobs only: the instrumental (mix minus the isolated vocal) as a small mono MP3. Left out when the job is
   * read with `?backing=false`, as the app reads it; an older server may still send it.
   */
  backingAudioBase64?: string;
  /** Chromatic spelling convention used by the worker; old results default to direction. */
  chromaticSpelling?: "direction" | "ascending" | "descending";
  /**
   * Base64-encoded 16-bit PCM WAV audio preview synthesised server-side from
   * the note list (numpy + soundfile — no system audio libraries required).
   * Empty string when synthesis produced no output.
   * Written to a cache file with expo-file-system and played via expo-av.
   */
  audioPreviewBase64?: string;
  /**
   * False when the worker skipped its pyin refinement stage. No longer reachable
   * by recording a long clip: the worker's pyin budget now equals the duration it
   * reads of a free account's file (180 s, which MAX_RECORD_SEC in RecordScreen mirrors), so the two
   * remaining causes are a failed decode and a clip with no voiced frame at all.
   *
   * Worth surfacing rather than swallowing: with that stage dark, the worker's
   * accuracy corpus records spurious accidentals rising from 1.53 to 3.53 per
   * clip, which is exactly the "accidentals where not needed" complaint. Show
   * the notation with a caveat, not instead of it. Optional and defaulting to
   * refined, so an older API build never displays a false warning.
   */
  pitchRefined?: boolean;
  /** Linked songs only: where the song came from. */
  source?: TranscriptionSource | null;
  /** Linked songs only: the whole song's length, which may exceed what was transcribed. */
  songDurationSec?: number;
  /** True when only the first part of the song was transcribed (free preview, or past the Pro cap). */
  truncated?: boolean;
  /** True when the vocals were isolated from the mix before transcription. */
  separated?: boolean;
  /** Four-part harmony under the melody (soprano, alto, tenor, bass). Pro only; absent otherwise. */
  parts?: Record<"soprano" | "alto" | "tenor" | "bass", TranscriptionPart> | null;
  /** The four parts as one MusicXML score. Pro only. */
  partsMusicXml?: string;
  /** "heard" when the parts were transcribed from a choir recording, "written" when arranged on request. */
  partsSource?: "heard" | "written" | null;
  /** The chords heard: always in chords mode, and for a song with accompaniment; null otherwise. */
  chords?: ChordSymbol[] | null;
  /** "heard" when the chords were read from the audio; null without chords. */
  chordsSource?: "heard" | null;
  /** The words under the solfa; empty until the user types them. Saved items only. */
  lyrics?: string;
  /** The public link's token when the saved sheet is shared; null or absent otherwise. */
  shareToken?: string | null;
  /** Saved items only: the hymn the sheet is the hymnbook version of. */
  hymn?: HymnCredit | null;
}

/** What the API hands back for a transposed sheet (saved or not): the moved notes, labelled. */
export interface TransposedSheet {
  key: string;
  notes: NoteEvent[];
  musicXml: string;
  parts?: Record<string, TranscriptionPart> | null;
  partsMusicXml?: string | null;
  /** The chords, moved and respelled for the new key; their solfa reads as before. */
  chords?: ChordSymbol[] | null;
}

/** Alto, tenor and bass written under a tune on request (Pro): the four parts and their one score. */
export interface HarmonisedSheet {
  parts: Record<string, TranscriptionPart> | null;
  partsMusicXml: string | null;
}

/** The part a take is judged against, in beats, and the count-in that preceded it in the recording. */
export interface GradeTarget {
  notes: { pitchMidi: number; startBeat: number; durBeats: number }[];
  tempoBpm: number;
  leadInSec: number;
}

export type GradeStatus = "hit" | "near" | "wrong" | "missed";

/** One note's verdict: the pitch sung while it was due, in cents off. */
export interface GradeNote {
  index: number;
  targetMidi: number;
  sungMidi: number | null;
  cents: number | null;
  status: GradeStatus;
}

/** How a sung take compared to its part. */
export interface GradeResult {
  score: number;
  hits: number;
  near: number;
  wrong: number;
  missed: number;
  /** The take's overall lean in cents; positive is sharp. */
  tuningCents: number;
  offsetSec: number;
  /** The octave the singer took it in, in semitones; a bass on the tune reads −12 and is not wrong. */
  octaveShift: number;
  summary: string;
  notes: GradeNote[];
  /** What the take earned as practice (XP, level, streak, badges); set by the API for a signed-in singer. */
  reward?: PracticeReward | null;
  /** A practice-path milestone this drill just reached (a unit or a grade finished); null for most takes. */
  milestone?: PracticeMilestone | null;
}

// ── Practice (C# Application/Practice/Dtos/PracticeDtos.cs) ─────────────────

/** Where an account stands on the ladder; `xpForNext` is the XP still to earn (0 at the top). */
export interface PracticeLevel {
  index: number;
  name: string;
  minXp: number;
  nextLevelXp: number | null;
  nextName: string | null;
  xpForNext: number;
}

/** Days practised in a row on the singer's own calendar, with the weekly automatic freeze. */
export interface PracticeStreak {
  current: number;
  best: number;
  todayDone: boolean;
  /** A streak is running and today is not done yet. */
  atRisk: boolean;
  /** This ISO week's one freeze is unused. */
  freezeAvailable: boolean;
  /** Yesterday was missed and the freeze bridged it. */
  frozenYesterday: boolean;
}

/** Practice days so far this week (Monday to Sunday) against the goal. */
export interface WeeklyGoal {
  daysDone: number;
  target: number;
  /** yyyy-mm-dd, a Monday. */
  weekStart: string;
}

/** A badge, earned or not; locked ones carry `progress` of `target`. */
export interface PracticeBadge {
  code: string;
  title: string;
  description: string;
  earned: boolean;
  earnedAtUtc: string | null;
  progress: number;
  target: number;
}

export type PracticeDayStatus = "done" | "frozen" | "missed" | "today" | "none";

/** One of the last seven days. */
export interface PracticeDay {
  /** yyyy-mm-dd on the singer's calendar. */
  date: string;
  status: PracticeDayStatus;
  xp: number;
}

/** Drills marked today and the day's limit (5 free, 20 Pro). */
export interface DrillAllowance {
  used: number;
  limit: number;
  /** When the allowance starts again: the singer's next local midnight, ISO UTC. */
  resetsAtUtc: string | null;
}

/**
 * Where the singer is on their track's practice path (C# `PracticePathDto`): the grade ("Grade 2", "Advanced 1"), the
 * unit's title, its number of the grade's (1-based) and the drill's of the unit's (1-based), and units/grades finished.
 */
export interface PracticePath {
  grade: string;
  unit: string;
  unitIndex: number;
  unitCount: number;
  drillIndex: number;
  drillCount: number;
  unitsComplete: number;
  gradesComplete: number;
}

/** A milestone a marked drill just reached (C# `PracticeMilestoneDto`): "Unit 3 of Grade 2 complete", "Grade 2 complete". */
export interface PracticeMilestone {
  kind: "unit" | "grade";
  title: string;
  /** One line of what was learned ("You can now …" for a grade). */
  description: string;
  grade: string;
  unitIndex: number;
  unitCount: number;
}

/** How the next drill was moved by the last take (C# `DrillAdjustment`): after a skip ahead, an easier variant or a step back. */
export type DrillAdjustment = "steady" | "harder" | "easier";

/**
 * How a singer likes to practise (C# `Core.Enums.PracticeTrack`): a style, never an age. It picks the day's drill
 * and how a take is shown; XP, levels, streaks and badges are the same on both.
 */
export type PracticeTrack = "playful" | "focused";

/** GET /api/practice/progress, and the answer to PUT /api/practice/track. */
export interface PracticeProgress {
  /** yyyy-mm-dd on the singer's calendar. */
  today: string;
  xp: number;
  xpToday: number;
  dailyXpCap: number;
  level: PracticeLevel;
  streak: PracticeStreak;
  weeklyGoal: WeeklyGoal;
  badges: PracticeBadge[];
  lastSevenDays: PracticeDay[];
  drills: DrillAllowance;
  /** Null until the singer picks one; the screen asks then. */
  track: PracticeTrack | null;
  /** The singer's place on their track's path. */
  path: PracticePath | null;
  /**
   * The practice modes live for the track, in the hub's order (Focused all six, Playful four); each can be switched
   * off on the server, so show only these. Null from an older server.
   */
  modes: PracticeModeId[] | null;
  /** The seasonal side-path (the Christmas carols, Halloween's Midnight path) while its season is on for the singer, else null. */
  season?: PracticeSeason | null;
  /** The day's three quests and its chest (C# `DailyQuestsDto`). */
  quests?: DailyQuests | null;
}

/**
 * The day's three quests, the same for everyone that day, read off the day's marked takes (C# `DailyQuestsDto`):
 * `chestOpened` once all three are done, worth `chestXp` on top of the day's cap.
 */
export interface DailyQuests {
  quests: DailyQuest[];
  chestOpened: boolean;
  chestXp: number;
}

/** One quest: its code ("drills-2"), what it asks, how far today's takes got, its target and whether it is done. */
export interface DailyQuest {
  code: string;
  title: string;
  progress: number;
  target: number;
  done: boolean;
}

/**
 * A season's path on the progress (C# `PracticeSeasonDto`): the Practice screen's seasonal card. `until` is the last
 * day it runs (yyyy-mm-dd), null when it runs until switched off; `next` is null once every step is passed.
 */
export interface PracticeSeason {
  /** "christmas" or "halloween". */
  season: string;
  /** "Carols for Christmas", "The Midnight path". */
  title: string;
  until: string | null;
  sung: number;
  total: number;
  next: CarolStep | null;
  steps: CarolStep[];
  /** The badge all of them earn ("carol_singer", "night_singer"), listed among the badges while the season is on. */
  badgeCode: string;
}

/** One drill of a season's path as a row (C# `CarolStepDto`; `carol` is the song's title in either season). */
export interface CarolStep {
  /** 1-based. */
  index: number;
  /** The drill id to grade a take with (the singer's track's pace). */
  id: string;
  /** "Sing in thirds". */
  title: string;
  /** "Silent Night". */
  carol: string;
  hymnSlug: string;
  /** "Silent Night, in thirds", for "Next: …". */
  cue: string;
  /** The line under the title: "Doh is Bb · 4 notes", the solfa sung, "one breath". */
  detail: string;
  passed: boolean;
  bestScore: number | null;
}

/**
 * GET /api/practice/carols (Christmas) or /api/practice/seasons/{season} while that season is on (C# `CarolsPathDto`);
 * 404 PRACTICE_SEASON_OFF otherwise.
 */
export interface CarolsPath {
  season: PracticeSeason;
  drills: CarolDrill[];
}

/**
 * One carol drill in full (C# `CarolDrillDto`): its row, the drill (graded at /drills/grade like any), beats before its
 * first bar line, and for some the tune the piano plays under the sung part (`backing`, quietly; only the part is
 * marked) or a sing-along's words (`syllables`, one a note, "" where a note carries on; `words`, the verse's lines).
 */
export interface CarolDrill {
  step: CarolStep;
  drill: Drill;
  pickupBeats: number;
  backing: NoteEvent[] | null;
  syllables: string[] | null;
  words: string[] | null;
}

// ── Practice modes (C# Application/Practice/Dtos/PracticeModeDtos.cs) ───────

/** A practice mode's wire id ("More ways to practise"). */
export type PracticeModeId = "warm-up" | "pitch-match" | "scales" | "runs" | "intervals" | "harmony" | "rhythm";

/** How a mode's take is marked: note by note, a run's shape and landing note, or clap by clap. */
export type ExerciseGrader = "notes" | "run" | "rhythm";

/** GET /api/practice/warm-up: the guided routine (about three minutes), never marked and earning nothing. */
export interface WarmUp {
  totalSeconds: number;
  steps: WarmUpStep[];
}

/** One warm-up step: a breathing pattern, a guide the synth plays, or the range finder. */
export interface WarmUpStep {
  id: string;
  kind: "breath" | "guide" | "range";
  title: string;
  instruction: string;
  seconds: number;
  breath: BreathPattern | null;
  guide: WarmUpGuide | null;
}

/** In, hold and out, in counts at `countsPerMinute`, `cycles` times. */
export interface BreathPattern {
  inCounts: number;
  holdCounts: number;
  outCounts: number;
  countsPerMinute: number;
  cycles: number;
}

/** The notes the synth plays for a guided step: the pattern, then `stepSemitones` higher each round; `glide` slides (a siren). */
export interface WarmUpGuide {
  key: string;
  dohHeader: string;
  tempoBpm: number;
  notes: NoteEvent[];
  rounds: number;
  stepSemitones: number;
  glide: boolean;
}

/**
 * GET/POST /api/practice/range (C# `VoiceRangeDto`): the singer's comfortable range, each end null until measured; once
 * both are, the span, the range in solfa with doh on C, and the choir part it sits best in (a guide, not a label).
 * `heard` is the note the take just sent held (POST only).
 */
export interface VoiceRange {
  lowMidi: number | null;
  highMidi: number | null;
  /** e.g. "G3". */
  low: string | null;
  /** e.g. "D5". */
  high: string | null;
  spanSemitones: number | null;
  /** e.g. "An octave and a fifth". */
  span: string | null;
  /** "Doh is C". */
  dohHeader: string;
  /** e.g. "s,". */
  lowSolfa: string | null;
  /** e.g. "r'". */
  highSolfa: string | null;
  voicePart: "soprano" | "alto" | "tenor" | "bass" | null;
  heard: HeldNote | null;
  /** Drills and exercises placed in keys the range holds (once both ends are measured); on by default. */
  practiceInRange: boolean;
  /** Learn my part starts on `voicePart` (the phone writes it as the remembered part); off by default. */
  learnPartFromRange: boolean;
}

/** A note held in a range take: the note, how long it was held, and how far off it the voice sat. */
export interface HeldNote {
  midi: number;
  name: string;
  seconds: number;
  cents: number;
}

/** GET /api/practice/modes/{mode}: a mode's exercises on the singer's track, placed in today's key, with the day's allowance. */
export interface PracticeMode {
  mode: PracticeModeId;
  /** yyyy-mm-dd on the singer's calendar. */
  date: string;
  track: PracticeTrack | null;
  allowance: DrillAllowance;
  exercises: PracticeExercise[];
}

/**
 * One exercise. Send `id` with the take. `notes` are sung and marked; `backing` is played and never marked (pitch
 * match's tone before each held note, the tune under a harmony line); `claps` are a rhythm's. Times in beats at
 * `tempoBpm`. A run lists its `speeds`, each with its own exercise id, tempo and grader.
 */
export interface PracticeExercise {
  id: string;
  mode: PracticeModeId;
  /** Names the exercise across keys and speeds. */
  code: string;
  title: string;
  prompt: string;
  /** A run's unit ("Runs down to doh"), an interval's size, a harmony's "A third above"/"A third below". */
  group: string | null;
  /** e.g. "Eb major"; null for a rhythm. */
  key: string | null;
  dohHeader: string | null;
  tempoBpm: number;
  timeSignature: string;
  notes: NoteEvent[];
  backing: NoteEvent[];
  claps: RhythmClap[];
  /** The worker keeps no more of the take than this. */
  maxTakeSeconds: number;
  grader: ExerciseGrader;
  /** The singer's best mark at this exercise (this speed, for a run); null before any. */
  bestScore: number | null;
  speedPercent: number | null;
  speeds: RunSpeed[] | null;
}

/** A clap of a rhythm, in beats. */
export interface RhythmClap {
  startBeat: number;
  durBeats: number;
}

/** A run at one speed: its exercise id, tempo, quickest note there (seconds), and how it is marked there. */
export interface RunSpeed {
  percent: number;
  exerciseId: string;
  tempoBpm: number;
  shortestNoteSeconds: number;
  grader: ExerciseGrader;
  bestScore: number | null;
}

// ── Quick games (GET /api/practice/games/{game}, POST /api/practice/games/grade) ─────────────────────────────────

/** The quick games beside the sung practice: tapped, not sung, about a minute each. */
export type PracticeGameId = "which-note" | "staff" | "hymn" | "which-scale";

/** A note a game plays, in quarter-note beats. */
export interface GameNote {
  pitchMidi: number;
  startBeat: number;
  durBeats: number;
}

/** A hymn offered as a choice: its slug (an answer's form), title and first line (null for a tune page). */
export interface GameHymn {
  slug: string;
  title: string;
  firstLine: string | null;
}

/** A scale offered as a choice (Which scale?): its code (an answer's form), its name and its solfa up and back down. */
export interface GameScale {
  code: string;
  title: string;
  solfa: string;
}

/**
 * One round, with its answer so a tap is told at once (the server marks the answers that count). Which note: play
 * `dohMidi` then `noteMidi`. Staff to solfa: draw `noteName` ("F#4") on a treble stave with `fifths` in the signature.
 * Name that hymn: play `notes` at `tempoBpm`; `hymns` names each choice; `key` labels its solfa when revealed. An arcade
 * stage's Which note? sounds each note for `noteSeconds` (the web's endless games; null otherwise). Which scale?: play
 * `notes` at `tempoBpm`, a scale up and back down; `scales` names each choice.
 */
export interface PracticeGameRound {
  index: number;
  answer: string;
  choices: string[];
  doh: string | null;
  key: string | null;
  fifths: number | null;
  dohMidi: number | null;
  noteMidi: number | null;
  noteName: string | null;
  tempoBpm: number | null;
  timeSignature: string | null;
  notes: GameNote[] | null;
  hymns: GameHymn[] | null;
  noteSeconds?: number | null;
  scales?: GameScale[] | null;
}

/**
 * A fresh deal; `timeLimitSeconds` is set for a race (Staff to solfa). `gamesToday` of `gamesPerDay` earned XP today.
 * An arcade stage (`?level=`, the web's endless games) carries its `level`, and its Staff to solfa `secondsPerRound`.
 */
export interface PracticeGame {
  game: PracticeGameId;
  dealId: string;
  track: PracticeTrack | null;
  timeLimitSeconds: number | null;
  gamesToday: number;
  gamesPerDay: number;
  rounds: PracticeGameRound[];
  level?: number | null;
  secondsPerRound?: number | null;
}

/**
 * A deal's answers marked by the server. `counted`: it earned XP and is a day of practice; when not, `notCounted` says
 * why ("daily": the day's games that earn XP are used; "few": too few rounds answered) and `reward` is null. An arcade
 * stage says the `nextLevel` to deal.
 */
export interface PracticeGameGrade {
  game: PracticeGameId;
  dealId: string;
  score: number;
  right: number;
  answered: number;
  rounds: number;
  marks: boolean[];
  counted: boolean;
  notCounted: "daily" | "few" | null;
  reward: PracticeReward | null;
  nextLevel?: number | null;
}

/**
 * POST /api/practice/modes/grade (C# `PracticeModeGradeDto`): the take marked by the server and recorded as practice.
 * `score`/`summary` whatever marked it; the grader's own answer is in `marks` ("notes"), `run` or `rhythm`.
 */
export interface PracticeModeGrade {
  mode: PracticeModeId;
  exerciseId: string;
  grader: ExerciseGrader;
  score: number;
  summary: string;
  speedPercent: number | null;
  marks: GradeResult | null;
  run: RunGrade | null;
  rhythm: RhythmGrade | null;
  reward: PracticeReward;
}

/** A full-speed run's mark: the run's notes followed in order, and the landing note judged as any held note. */
export interface RunGrade {
  score: number;
  followed: number;
  runNotes: number;
  landing: GradeStatus;
  landingCents: number | null;
  landingMidi: number;
  offsetSec: number;
  octaveShift: number;
  summary: string;
  notes: RunNoteMark[];
  /** The take's pitch line from beat one (seconds, MIDI with the octave taken out), to draw over the run. */
  trace: TracePoint[];
}

export interface RunNoteMark {
  index: number;
  targetMidi: number;
  followed: boolean;
  status: "hit" | "wrong" | "missed";
}

export interface TracePoint {
  t: number;
  midi: number;
}

/** A rhythm's mark: claps in time (`hits`, ±70 ms), close (`near`, ±140 ms), missed, and extra (each costs half a clap). */
export interface RhythmGrade {
  score: number;
  hits: number;
  near: number;
  missed: number;
  extra: number;
  offsetSec: number;
  /** The tempo clapped over the tempo given: above 1 is quicker. */
  tempoRatio: number;
  summary: string;
  claps: ClapMark[];
}

/** One clap: its beat, how early (negative) or late it came in ms, and in time / close / missed. */
export interface ClapMark {
  index: number;
  beat: number;
  errorMs: number | null;
  status: "hit" | "near" | "missed";
}

/** What a marked take earned, returned with its grade. */
export interface PracticeReward {
  xpGained: number;
  xp: number;
  levelUp: boolean;
  level: PracticeLevel;
  streak: number;
  newBadges: PracticeBadge[];
}

/**
 * GET /api/practice/drills/next (old name /drills/today): the next drill on the singer's practice path, the same until
 * a take of it is marked. Where it sits: `grade`, `unit`, `unitIndex`/`unitCount` and `drillIndex`/`drillCount`
 * (1-based), `difficulty` (its unit in its own grade, 1–5) and `adjustment`.
 */
export interface Drill {
  id: string;
  title: string;
  level: number;
  levelName: string;
  /** e.g. "Eb major", "B minor". */
  key: string;
  /** e.g. "Doh is Eb". */
  dohHeader: string;
  tempoBpm: number;
  timeSignature: string;
  /**
   * The count-in of apps before the five-second cap (two bars of 4/4), kept for them. This app counts in with
   * lib/practice `leadInPlan` and sends its seconds with the take.
   */
  leadInBeats: number;
  /** The worker keeps no more of the take than this (room for the longer, older count-in). */
  maxTakeSeconds: number;
  notes: NoteEvent[];
  /** yyyy-mm-dd on the singer's calendar. */
  date: string;
  allowance: DrillAllowance;
  /** The track this drill was picked for (null with none chosen): each track has its own path. */
  track: PracticeTrack | null;
  /** "Grade 2", "Advanced 1". */
  grade: string;
  /** The unit's title, e.g. "The doh chord". */
  unit: string;
  unitIndex: number;
  unitCount: number;
  drillIndex: number;
  drillCount: number;
  difficulty: number;
  adjustment: DrillAdjustment;
}

/**
 * GET/PUT /api/practice/reminders (C# `PracticeRemindersDto`): the account's practice reminders, pushed to its
 * phones by the server. On by default once the singer has practised or chosen a track.
 */
export interface PracticeReminders {
  enabled: boolean;
  /** The local hour of the day's reminder, 8–21 (19 by default). */
  hour: number;
  /** The app's notification sound switch, synced: off sends the reminders silently. */
  sound: boolean;
}

/** A public link to a saved sheet. */
export interface ShareLink {
  token: string;
  url: string;
}

/** One voice of the four-part harmony, in the same note shape as the melody. */
export interface TranscriptionPart {
  notes: NoteEvent[];
  solfaLines: string[];
}

/**
 * Where the worker is: `queued` waits for a free worker (progress 0); the other three are
 * the steps of the job itself. Any word this build does not know is read as `transcribing`
 * (`lib/jobProgress.normalizeStage`).
 */
export type TranscriptionStage = "queued" | "fetching" | "separating" | "transcribing";

export interface TranscriptionJob {
  jobId: string;
  status: TranscriptionStatus;
  progress: number;
  /** Which step the job is on while it runs; null once finished. */
  stage?: TranscriptionStage | null;
  /** How many jobs are ahead while this one waits in the queue; null once it runs. */
  queuePosition?: number | null;
  /** Known as soon as the link resolves, before `result` exists. */
  source?: TranscriptionSource | null;
  result?: TranscriptionResult | null;
  /**
   * Human-readable failure reason from the Python worker
   * (e.g. "No confident notes detected in the recording").
   * Non-null only when status === 'failed'.
   * Previously this field was absent from the C# DTO so Python error
   * messages were silently dropped and the mobile showed a hardcoded string.
   */
  error?: string | null;
  /**
   * A stable code beside `error`: "JOB_LOST" when the transcription service lost the job or never answered (every
   * path that says so, and for as long as anyone asks), so the phone sends the recording again without reading
   * words. Null for a failure about the recording.
   */
  errorCode?: string | null;
  /** The library sheet a finished job was filed as (every finished transcription is, at once); null until then. */
  savedId?: string | null;
  /** That sheet's title: the hymn it recognised, else "Recording · Sun 17:10". */
  savedTitle?: string | null;
}

// --- Library ------------------------------------------------------------

export interface SavedTranscription {
  id: string;
  title: string;
  key: string;
  tempoBpm: number;
  timeSignature: string;
  overallConfidence: number;
  createdAtUtc: string;
  notes?: NoteEvent[] | null;
  /**
   * MusicXML for export. Detail reads only (GET /api/library/{id}) — the list
   * route omits it so a library page doesn't download every score.
   */
  musicXml?: string | null;
  /** The words under the solfa, as typed. */
  lyrics?: string;
  /** Four-part harmony, labelled for the stored key. Detail reads only. */
  parts?: Record<string, TranscriptionPart> | null;
  partsMusicXml?: string | null;
  /** Set while the sheet is behind a public link. */
  shareToken?: string | null;
  /** The folder the sheet is filed in ("Sunday choir"), or null. */
  folder?: string | null;
  /** The chords heard under the tune, named for the stored key. Detail reads only. */
  chords?: ChordSymbol[] | null;
  /** The opening notes (up to eight), labelled, on every read: a list row's "d r m f │ s". */
  preview?: NoteEvent[] | null;
  /** The sheet is in its owner's choir library ("Share with my choir"). */
  sharedWithChoir?: boolean;
  /** The hymn this sheet is the hymnbook version of, with the credit its page shows; null otherwise. */
  hymn?: HymnCredit | null;
  /**
   * Filed by the server the moment its job finished (not saved by hand). With no `openedAtUtc` the Library marks it
   * unopened: a blue dot and "Saved automatically · 18:42".
   */
  savedAutomatically?: boolean;
  /** When its owner first opened or renamed it; null until then (`libraryApi.markOpened`). */
  openedAtUtc?: string | null;
  /**
   * The song's backing is kept with the sheet (`libraryApi.backing`): only the owner's own uploads whose song was
   * separated, never a pasted link's. Absent from an older server.
   */
  hasBacking?: boolean;
  /** The sheet came from a pasted link (YouTube, Spotify, Apple Music): its backing is never kept. */
  fromLink?: boolean;
  /** Where beat 0 falls in the song, kept from the job's result when the sheet was filed. */
  beatOriginSec?: number | null;
  /** The song's own beat times, kept from the job's result (see `TranscriptionResult.beatTimesSec`). */
  beatTimesSec?: number[] | null;
  /**
   * Semitones "Transpose for my choir" has moved the sheet from the key it was heard in (0 = that key). The backing
   * plays only at 0; "Back to <key>" transposes by −transposedBy.
   */
  transposedBy?: number;
}

// --- Choirs -------------------------------------------------------------
// Mirrors src/NoteFusion.Application/Choirs/Dtos/ChoirDtos.cs.

export type ChoirRole = "director" | "member";

/** The caller's choir (`GET /api/choirs/mine`; 404 `CHOIR_NOT_FOUND` when in none). */
export interface Choir {
  id: string;
  name: string;
  role: ChoirRole;
  /** The choir's plan is running: its singers are Pro and its library is open. */
  isActive: boolean;
  currentPeriodEndUtc: string;
  planCode: string | null;
  planName: string | null;
  /** The director's first name. */
  directorName: string;
  /** The code singers join with; the director's alone, null for a singer. */
  inviteCode: string | null;
  /** Singers in the choir, the director not counted. */
  seatsUsed: number;
  seatsTotal: number;
  /** Songs left this month in the choir's shared pool. */
  songCreditsRemaining: number;
  songCreditsTotal: number;
}

/** A singer, as the director's member list shows them. */
export interface ChoirMember {
  userId: string;
  name: string;
  joinedAtUtc: string;
}

/** One row of the choir's shared library. */
export interface ChoirSheet {
  id: string;
  title: string;
  key: string;
  /** First name of the singer who shared it. */
  sharedBy: string;
  /** The caller shared it. */
  mine: boolean;
  /** The caller may take it out: their own, or any for the director. */
  canUnshare: boolean;
  createdAtUtc: string;
  preview: NoteEvent[];
}

/** A sheet opened read-only through the choir library (the shared-sheet body). Mirrors `SharedSheetDto`. */
export interface SharedSheet {
  title: string;
  sharedBy: string;
  key: string;
  tempoBpm: number;
  timeSignature: string;
  lyrics: string;
  notes: NoteEvent[];
  musicXml: string;
  parts: Record<string, TranscriptionPart> | null;
  partsMusicXml: string | null;
  chords?: ChordSymbol[] | null;
  /** The hymn this sheet is the hymnbook version of; null otherwise. */
  hymn?: HymnCredit | null;
}

// --- Billing ------------------------------------------------------------
// Mirrors src/NoteFusion.Application/Billing/Dtos/BillingDtos.cs. Enums serialize
// as camelCase strings (JsonStringEnumConverter + CamelCase policy in Program.cs).

/**
 * `"lifetime"` is a one-off purchase, not a period — a plan carrying it has no renewal
 * and must never be priced "per month". Which of these a user is offered is decided
 * server-side from the country on their account, so the app renders whatever it is sent
 * rather than choosing.
 */
/**
 * `single` is the one-song purchase: one more transcription for a free account, bought once,
 * with no period and no membership (C# `BillingInterval.Single`).
 */
export type BillingInterval = "monthly" | "yearly" | "lifetime" | "single";

export type PaymentProvider = "paystack" | "flutterwave" | "bachs" | "squad";

export type SubscriptionStatus = "active" | "pastDue" | "canceled" | "expired";

/** A plan shown on the paywall. Amount is in the currency's minor units (cents). */
export interface Plan {
  id: string;
  code: string;
  name: string;
  amountMinor: number;
  currency: string;
  interval: BillingInterval;
  /** Singers a choir plan seats besides the director; null for every other plan. */
  choirSeats?: number | null;
}

/** Anonymous, location-resolved pricing used by the public website. */
export interface PublicPricing {
  countryCode: string | null;
  plans: Plan[];
  /** The region's one-song purchase, apart from `plans`. */
  single?: Plan | null;
  /** The region's choir plans, cheapest first, apart from `plans`. */
  choir?: Plan[] | null;
}

/**
 * Body of `POST /api/billing/checkout`. `client` is optional; only `"web"`
 * means anything (the browser returns to the website after paying instead of
 * the app), so the app leaves it out.
 */
export interface CheckoutRequest {
  planId: string;
  client?: string;
}

/**
 * A hosted-checkout session. The app opens {@link checkoutUrl} in an external
 * browser (Spotify-style) and never collects card details; the result arrives
 * server-side by webhook, so the app polls my-subscription to learn when Pro unlocks.
 */
export interface CheckoutSession {
  reference: string;
  checkoutUrl: string;
  provider: PaymentProvider;
}

/** The one-tap answer to "What stopped you?" after a checkout came back unpaid (C# `CheckoutExitReason`). */
export type CheckoutExitReason =
  | "currency"
  | "cardDeclined"
  | "slow"
  | "tooExpensive"
  | "justLooking"
  | "somethingElse";

/** Body of `POST /api/billing/checkouts/{reference}/exit`: seconds the page was open, then the answer. */
export interface CheckoutExitRequest {
  secondsOpen: number;
  reason?: CheckoutExitReason;
  /** The "Something else" words, at most 280 characters once trimmed. */
  note?: string;
}

/** The reply to a checkout's exit (C# `CheckoutExitDto`). */
export interface CheckoutExit {
  /** Show "What stopped you?": the checkout's first unpaid return, no transfer under way, no answer yet. */
  ask: boolean;
  /** The checkout's currency, as charged ("USD", "NGN"). */
  currency: string;
  /** The checkout's amount in minor units. */
  amountMinor: number;
  /** How long "Try again" hands back the same checkout, in minutes. */
  keptMinutes: number;
}

/** The caller's subscription state — the app gates Pro features on this. */
export interface Subscription {
  isActive: boolean;
  planCode: string | null;
  status: SubscriptionStatus | null;
  currentPeriodEndUtc: string | null;
  /**
   * Free-tier transcriptions left: this week's free ones plus the bought ones. Server-
   * authoritative and counted from successful generations, so it does not go back up when a
   * transcription is deleted. Meaningless while `isActive` — Pro is unmetered.
   */
  trialGenerationsRemaining: number;
  /** The week's free allowance plus every transcription bought, so the UI can say "2 of 4". */
  trialGenerationsTotal: number;
  /**
   * Bought outright — there is no renewal date to show and nothing to cancel.
   * `currentPeriodEndUtc` carries a far-future sentinel in this case, so anything
   * that prints a date has to check this first or it shows the year 9999.
   */
  isLifetime: boolean;
  /** Granted by an operator — no payment was taken. */
  isGift?: boolean;
  /** Linked songs left this month on Pro, or free previews left otherwise. */
  songCreditsRemaining?: number;
  /** The allowance `songCreditsRemaining` is measured against. */
  songCreditsTotal?: number;
  /** The plan's display name ("NoteFusion Pro (Monthly)"); null without a subscription. */
  planName?: string | null;
  /** A free account that has not yet used its one four-part harmony. Always false on Pro. */
  freeHarmonyAvailable?: boolean;
  /**
   * Bought transcriptions (one-song purchases) not yet used; they never expire. Already
   * counted in `trialGenerationsRemaining`. On a free account each one can be a whole
   * linked song.
   */
  boughtTranscriptionsRemaining?: number;
  /** Transcriptions ever bought; rises by one when a one-song payment lands. */
  boughtTranscriptionsTotal?: number;
  /**
   * The choir this account is Pro through while its plan runs, or null. Without Pro of its
   * own, the plan and period above are the choir's.
   */
  choirName?: string | null;
  /** "director" or "member" alongside `choirName`. */
  choirRole?: ChoirRole | null;
  /** The choir's period end, running or lapsed; null without a choir. */
  choirPeriodEndUtc?: string | null;
  /**
   * This week's free hummed or recorded transcriptions not yet used or running; bought ones
   * not included. Already counted in `trialGenerationsRemaining`.
   */
  freeTranscriptionsRemaining?: number;
  /** Free hummed or recorded transcriptions a week (3). */
  freeTranscriptionsPerWeek?: number;
  /** When this week's free ones come back: the next Friday 18:00 West Africa Time, UTC. */
  freeResetsAtUtc?: string | null;
  /**
   * Who takes the money: "googlePlay" (Google renews it; manage and cancel in Google Play), "web" (bought on
   * the website; nothing renews by itself), or null (a gift, a choir singer, no membership).
   */
  billedThrough?: "googlePlay" | "web" | null;
  /** Google Play will charge again when the period ends (false once cancelled in Google Play). */
  autoRenews?: boolean;
  /** A Google Play renewal not yet paid: "grace" (Pro stays on while Google retries) or "hold" (Pro paused). */
  paymentIssue?: "grace" | "hold" | null;
  /** The Google Play product a Play membership is ("pro" or "choir"), for the link to it in Google Play. */
  storeProductId?: string | null;
}

// --- App release --------------------------------------------------------

/**
 * What the stores carry, from `GET /api/app/version`. Mirrors `AppVersionDto`.
 *
 * Compare against `Application.nativeBuildVersion` — the **builds**, never the version
 * strings, because `"1.10.0" < "1.9.0"` lexically. Both build numbers are 0 on a server
 * that has not been told about a release, which means "announce nothing, block nobody".
 */
export interface AppVersionInfo {
  latestVersion: string;
  latestBuild: number;
  /** Below this, the app must not be usable. See `lib/appUpdate.ts`. */
  minimumBuild: number;
  releaseNotes: string;
  androidStoreUrl: string;
  iosStoreUrl: string;
  announcement?: { message: string; severity: string } | null;
}

/**
 * `GET /api/app/season` (C# `SeasonDto`), anonymous: the season every surface dresses for now, as the caller sees it
 * (an admin also sees a season in preview). At most one is true (Christmas, should an admin preview both); builds that
 * predate Halloween read only `christmas`. Cached by the API for a minute.
 */
export interface AppSeason {
  christmas: boolean;
  halloween: boolean;
}

// --- API errors ---------------------------------------------------------

/** The ApiError envelope every 4xx/5xx carries (ApiError code/message/details). */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

// --- Admin --------------------------------------------------------------
// Mirrors src/NoteFusion.Application/Admin/Dtos/*.cs plus the two admin-only
// records in Analytics/Dtos/AnalyticsDtos.cs. Behind the Admin policy, so nothing
// here is reachable by an ordinary account.
//
// One trap runs through the whole section. Every status, provider and direction
// field below is a plain C# `string` holding the enum member's *name*
// (`t.Status.ToString()`), not a serialized enum — so the values arrive
// PascalCase and the camelCase policy never touches them. Contrast
// {@link PaymentProvider} above, which is a real enum on the client-facing
// billing DTOs and therefore arrives as `"paystack"`. Comparing an admin row's
// `provider` against that union matches nothing, silently. Same reason
// {@link AuthUser.role} is `"Admin"` and not `"admin"`.

/** A page of results plus the total, so a list can say "showing 1–25 of 340". */
export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export type AdminPaymentStatus =
  | "Pending"
  | "Processing"
  | "Verified"
  | "Completed"
  | "Failed";

export type AdminWebhookStatus = "Received" | "Processed" | "Failed";

export type AdminProvider = "Paystack" | "Flutterwave" | "Bachs" | "Squad" | "GooglePlay";

export type AdminLedgerDirection = "Credit" | "Debit";

/**
 * One payment attempt across every account — the row of the reconciliation table.
 *
 * `Verified` is the status to read carefully: the money moved but the ledger entry
 * and subscription have not been written, so that row is a customer who has paid
 * and does not have Pro.
 */
export interface AdminPaymentRow {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  reference: string;
  providerReference: string | null;
  provider: AdminProvider;
  status: AdminPaymentStatus;
  /** Minor units of `currency` — cents for USD, kobo for NGN. Never a float. */
  amountMinor: number;
  currency: string;
  planName: string | null;
  failureReason: string | null;
  /** Still `Processing` past the grace window — what the background sweep picks up. */
  isStuck: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/**
 * One payment in full. `initiateRaw`/`verifyRaw` are the provider's own words —
 * the evidence in a dispute — and this is the only route that returns them.
 */
export interface AdminPaymentDetail {
  payment: AdminPaymentRow;
  idempotencyKey: string;
  checkoutUrl: string | null;
  initiateRaw: string | null;
  verifyRaw: string | null;
  ledger: AdminLedgerEntry[];
  webhookEvents: AdminWebhookEventRow[];
}

/**
 * One row of the webhook inbox. A `Failed` row does not mean the customer lost
 * their subscription — reconciling the payment recovers that independently — it
 * means nobody has looked at why the callback would not drain.
 */
export interface AdminWebhookEventRow {
  id: string;
  provider: AdminProvider;
  providerEventId: string;
  eventType: string;
  paymentReference: string | null;
  /** Null when the payload carried no reference of ours, or named a dead one. */
  paymentTransactionId: string | null;
  status: AdminWebhookStatus;
  processAttempts: number;
  lastError: string | null;
  receivedAtUtc: string;
  lastAttemptAtUtc: string | null;
  processedAtUtc: string | null;
}

/** One inbox row plus the request body it stored — what explains a parked event. */
export interface AdminWebhookEventDetail {
  event: AdminWebhookEventRow;
  payload: string;
}

/** One immutable ledger movement inside a single account's history. */
export interface AdminLedgerEntry {
  id: string;
  direction: AdminLedgerDirection;
  reason: string;
  amountMinor: number;
  currency: string;
  description: string;
  createdAtUtc: string;
}

/** The same movement in the cross-account list, which has to name its owner. */
export interface AdminLedgerRow {
  id: string;
  userId: string;
  userEmail: string;
  paymentTransactionId: string;
  paymentReference: string | null;
  direction: AdminLedgerDirection;
  reason: string;
  amountMinor: number;
  currency: string;
  description: string;
  createdAtUtc: string;
}

/**
 * The reconciliation snapshot: what state the money is in, and what the workers
 * are about to do about it. One request because the numbers only mean something
 * read against each other — a stuck count needs the window that defines "stuck".
 */
export interface PaymentOpsSummary {
  pendingCount: number;
  processingCount: number;
  /**
   * Paid, but the ledger entry and subscription are missing. The most important
   * number here: every one is a customer who cannot use what they bought, and it
   * is **not** self-healing — the sweep only touches rows still in `Processing`.
   */
  verifiedCount: number;
  completedCount: number;
  failedCount: number;
  /** `Processing` rows older than `graceWindowMinutes` — what the sweep will take. */
  stuckCount: number;
  /** An instant, not an age: an age computed server-side goes stale in transit. */
  oldestStuckSinceUtc: string | null;
  webhooksAwaitingCount: number;
  webhooksProcessedCount: number;
  webhooksFailedCount: number;
  oldestAwaitingWebhookAtUtc: string | null;
  /** Money in. Gifts are absent by design: no payment, no ledger entry. */
  creditedMinor: number;
  /** Money out. */
  refundedMinor: number;
  /** Credits minus debits, summed from the entries rather than stored anywhere. */
  netMinor: number;
  currency: string;
  graceWindowMinutes: number;
  sweepIntervalMinutes: number;
  mrrMinor: number;
  activeSubscribersCount: number;
  expiringInSevenDaysCount: number;
  /** Completed today (West Africa Time), one total per currency, never added across them. */
  paidToday: CurrencyAmount[] | null;
  paidTodayCount: number;
}

/**
 * What an operator-triggered reconciliation actually did. The command is
 * idempotent and answers "nothing to do" with success, so `changed` is the
 * difference between "the provider confirmed it" and "this was already settled".
 */
export interface AdminReconcileResult {
  paymentTransactionId: string;
  previousStatus: AdminPaymentStatus;
  status: AdminPaymentStatus;
  changed: boolean;
  /** A sentence written for the operator, ready to show as-is. */
  outcome: string;
}

export interface ClearStalePaymentsResult {
  clearedPendingCount: number;
  clearedProcessingCount: number;
  fulfilledCount: number;
}

export interface WorkerHeartbeat {
  workerName: string;
  lastRunUtc: string;
  durationMs: number;
  status: string;
  detail: string | null;
}

/** One tier of the health page, or the whole page's rolled-up verdict. */
export interface HealthPanel {
  name: string;
  status: string;
  latencyMs: number | null;
  detail: string | null;
}

export interface SystemHealth {
  status: string;
  checkedAtUtc: string;
  database: HealthPanel;
  transcriptionWorker: HealthPanel;
  webhookBacklog: HealthPanel;
  activity: { jobsLast24Hours: number; jobsLast7Days: number };
  subscriptions: {
    activeCount: number;
    giftedCount: number;
    expiringWithinSevenDays: number;
    pastDueCount: number;
  };
  /** Tiers this stack cannot prove anything about, named rather than faked. */
  notMonitored: string[];
  workerHeartbeats: WorkerHeartbeat[] | null;
  /** The backups as the backup service recorded them; null when the database is unreachable. */
  backups: BackupStatus | null;
  /** Mail sent in each capped window against its limit; null when the database is unreachable. */
  emailUsage: EmailWindowUsage[] | null;
  /** Phones the API can reach and the admins' payment alerts; null when the database is unreachable. */
  push: PushHealth | null;
}

export interface BackupRun {
  finishedAtUtc: string;
  ok: boolean;
  sizeBytes: number | null;
  verified: boolean;
  detail: string | null;
}

export interface BackupStatus {
  status: string;
  summary: string;
  lastDump: BackupRun | null;
  lastVerifiedDump: BackupRun | null;
  lastBaseBackup: BackupRun | null;
  walArchivedAtUtc: string | null;
  lastWalReport: BackupRun | null;
  lastFiles: BackupRun | null;
  lastCheck: BackupRun | null;
  lastMirror: BackupRun | null;
  lastDrill: BackupRun | null;
  drillUrl: string | null;
  problems: string[];
}

/** One capped mail window ("day", "week", "month"): sent, the cap, and where optional mail stops. */
export interface EmailWindowUsage {
  window: string;
  sent: number;
  limit: number;
  optionalCeiling: number;
}

/** The phone admin's Push panel (C# `PushHealthDto`). */
export interface PushHealth {
  phonesRegistered: number;
  android: number;
  ios: number;
  adminAlertPhones: number;
  lastPaymentAlertAtUtc: string | null;
  lastPaymentAlertDevices: number;
  lastPaymentAlertAccepted: number;
  refusedLast24h: number;
  /** Pushes of every kind whose fate Expo's receipts gave in the last 24 h (since the API started, if sooner). */
  receiptsLast24h: number;
  /** Of those, the ones Expo, Google or Apple refused. */
  notDeliveredLast24h: number;
  /** The latest refusal as a sentence to act on ("Upload the FCM V1 service account key…"), or null. */
  lastProblem: string | null;
  lastProblemAtUtc: string | null;
}

/** One admin phone's payment alerts (C# `PaymentAlertSettingsDto`; `GET`/`PUT /api/admin/alerts/device`). */
export interface PaymentAlertSettings {
  registered: boolean;
  on: boolean;
  sound: "chime" | "phone" | "none";
  vibrate: boolean;
  quietAtNight: boolean;
  hideNames: boolean;
  problems: boolean;
  mutedUntilUtc: string | null;
}

/** C# `AdminCodeSentDto`: a code went to `sentTo` (masked); name it back with `codeId`. */
export interface AdminCodeSent {
  codeId: string;
  sentTo: string;
  expiresAtUtc: string;
}

/** C# `AdminPhoneSessionDto`: the open pass this phone sends as `X-Admin-Session`. */
export interface AdminPhoneSession {
  session: string;
  expiresAtUtc: string;
}

/** C# `AdminPhoneSetUpDto`: this phone's key (the secret shown once) and an open pass. */
export interface AdminPhoneSetUp {
  keyId: string;
  secret: string;
  session: string;
  expiresAtUtc: string;
}

export interface TestPaymentAlert {
  sent: boolean;
  /** Google or Apple took it too (its receipt said so in time); false when only Expo has so far. */
  confirmed: boolean;
}

export interface CurrencyAmount {
  currency: string;
  amountMinor: number;
}

// ── The console's analytics, read by the phone admin (C# Analytics/Dtos) ─────

export interface DailyCount {
  date: string;
  count: number;
}

export interface CategoryCount {
  label: string;
  count: number;
}

export interface UserMetrics {
  totalUsers: number;
  newUsers: number;
  newUsersPrevious: number;
  activeUsers: number;
  activeUsersPrevious: number;
  googleVerifiedUsers: number;
  passwordOnlyUsers: number;
  lockedOutUsers: number;
  deactivatedUsers: number;
  activeToday: number;
}

export interface TranscriptionMetrics {
  totalSaved: number;
  totalSavedPrevious: number;
  succeededCount: number;
  failedCount: number;
  inFlightCount: number;
  successRate: number | null;
  averageConfidence: number | null;
  storedBytes: number;
  totalTranscribed: number;
  totalTranscribedPrevious: number;
  hymnMatchesOffered: number;
  hymnVersionsSaved: number;
}

export interface ActivityItem {
  kind: string;
  title: string;
  subtitle: string | null;
  occurredAtUtc: string;
  userId: string | null;
  email: string | null;
  country: string | null;
  detail: string | null;
}

export interface RetentionCohort {
  cohortStart: string;
  cohortSize: number;
  returnedCount: number;
  retentionRate: number | null;
}

export interface WebFunnel {
  previews: number;
  previewsPrevious: number;
  previewDevices: number;
  previewsSucceeded: number;
  webSignups: number;
  webSignupsPrevious: number;
  signupsFromPreview: number;
  webSignupsWhoSaved: number;
  sharesCreated: number;
  shareViews: number;
  webProConversions: number;
  previewsPerDay: DailyCount[];
}

export interface WebActionItem {
  userId: string;
  fullName: string;
  email: string;
  action: string;
  path: string;
  occurredAtUtc: string;
}

export interface WebTraffic {
  pageviews: number;
  pageviewsPrevious: number;
  visitors: number;
  visitorsPrevious: number;
  sessions: number;
  clicks: number;
  signupClicks: number;
  actions: number;
  activeWebUsers: number;
  pageviewsPerDay: DailyCount[];
  topPages: CategoryCount[];
  topReferrers: CategoryCount[];
  topClicks: CategoryCount[];
  devices: CategoryCount[];
  topActions: CategoryCount[];
  recentActions: WebActionItem[];
}

export interface Membership {
  activeMembers: number;
  paidMembers: number;
  giftedMembers: number;
  lifetimeMembers: number;
  newMembers: number;
  lapsedMembers: number;
  revenue: CurrencyAmount[];
  monthlyRunRate: CurrencyAmount[];
  membersByPlan: CategoryCount[];
  songsUsedThisMonth: number;
  membersOutOfSongs: number;
  activeChoirs: number;
  choirSingers: number;
}

/** `GET /api/admin/analytics/overview` (C# `AnalyticsOverviewDto`). */
export interface AnalyticsOverview {
  fromUtc: string;
  toUtc: string;
  reportingOffsetMinutes: number;
  users: UserMetrics;
  transcriptions: TranscriptionMetrics;
  signupsPerDay: DailyCount[];
  transcriptionsPerDay: DailyCount[];
  signupMethods: CategoryCount[];
  devicePlatforms: CategoryCount[];
  topKeys: CategoryCount[];
  retention: RetentionCohort[];
  recentActivity: ActivityItem[];
  signupSources: CategoryCount[];
  webFunnel: WebFunnel;
  webTraffic: WebTraffic;
  membership: Membership;
}

export interface LiveUser {
  id: string;
  fullName: string;
  email: string;
  country: string | null;
  seenAtUtc: string;
}

export interface LiveJob {
  jobId: string;
  userId: string | null;
  fullName: string | null;
  email: string | null;
  kind: string;
  preview: boolean;
  finished: boolean;
  startedAtUtc: string;
}

export interface LivePayment {
  id: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  amountMinor: number;
  currency: string;
  planName: string;
  paidAtUtc: string;
}

/** `GET /api/admin/analytics/live` (C# `LiveActivityDto`): who is online, transcribing and paying now. */
export interface LiveActivity {
  serverTimeUtc: string;
  online: LiveUser[];
  transcribing: LiveJob[];
  payments: LivePayment[];
}

export interface EndingMembership {
  userId: string;
  fullName: string;
  email: string;
  kind: string;
  plan: string;
  paid: boolean;
  endsAtUtc: string;
}

export interface Renewals {
  graceDays: number;
  endingIn7Days: number;
  endingIn30Days: number;
  endingIn30DaysByKind: CategoryCount[];
  endingSoon: EndingMembership[];
  dueInWindow: number;
  renewedEarly: number;
  renewedLate: number;
  lapsed: number;
  deciding: number;
  renewalRate: number | null;
}

export interface PriceSetFunnel {
  set: string;
  signedUp: number;
  transcribed: number;
  reachedFreeLimit: number;
  startedCheckout: number;
  paid: number;
  paidRate: number | null;
  medianDaysToPay: number | null;
}

export interface KindHealth {
  kind: string;
  started: number;
  succeeded: number;
  failed: number;
  running: number;
  failureRate: number | null;
}

export interface TranscriptionHealth {
  byKind: KindHealth[];
  linkAttempts: number;
  linkRefused: number;
  linkFailed: number;
  linkProblems: CategoryCount[];
}

export interface AppBuildRow {
  build: number;
  phones: number;
  recent: number;
  android: number;
  ios: number;
  serverReminders: number;
}

export interface AppVersions {
  latestBuild: number;
  phones: number;
  recent: number;
  onLatestBuild: number;
  serverReminders: number;
  builds: AppBuildRow[];
}

/** `GET /api/admin/analytics/growth` (C# `GrowthDto`). */
export interface Growth {
  fromUtc: string;
  toUtc: string;
  reportingOffsetMinutes: number;
  renewals: Renewals;
  freeToPaid: PriceSetFunnel[];
  transcriptions: TranscriptionHealth;
  appVersions: AppVersions;
}

/** `GET /api/admin/features` (C# `FeatureFlagDto`). `autoOffAt` is the last day it is on, yyyy-mm-dd, WAT. */
export interface FeatureFlag {
  key: string;
  name: string;
  enabled: boolean;
  on: boolean;
  adminPreview: boolean;
  autoOffAt: string | null;
  autoOffAtUtc: string | null;
  switchedItselfOff: boolean;
  suggestedAutoOffAt: string;
  updatedAtUtc: string | null;
  updatedByEmail: string | null;
}

/** `PUT /api/admin/features/{key}`: any of the four; what is left out stays as it is. */
export interface FeatureFlagChange {
  enabled?: boolean;
  adminPreview?: boolean;
  autoOff?: boolean;
  autoOffAt?: string;
}

/** One row of the admin user table — enough for a support conversation, no more. */
export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  profilePictureUrl: string | null;
  role: string;
  isActive: boolean;
  hasGoogle: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  transcriptionCount: number;
  /** Computed server-side; a client that recomputes it eventually disagrees. */
  hasProAccess: boolean;
  /** Only meaningful while `hasProAccess` — false is not "they paid". */
  isGiftedPro: boolean;
  /** Sheets in the library now; `transcriptionCount` counts every transcription that produced a result. */
  savedTranscriptionCount: number;
  failedTranscriptionCount: number;
  /** The last signed-in request (or, before presence was recorded, the last sign-in). */
  lastSeenAtUtc: string | null;
  isOnline: boolean;
  /** An admin or an account flagged internal: listed only with `includeInternal`. */
  isInternal: boolean;
  country: string | null;
  /** Leads or sings in a choir whose plan is running. */
  inChoir: boolean;
}

export interface AdminSubscription {
  id: string;
  planCode: string | null;
  planName: string | null;
  status: string;
  isActive: boolean;
  isGift: boolean;
  isLifetime: boolean;
  provider: string | null;
  currentPeriodStartUtc: string;
  /** Null for lifetime — the column holds a year-9999 sentinel a client would print. */
  currentPeriodEndUtc: string | null;
  canceledAtUtc: string | null;
  createdAtUtc: string;
}

/** One payment attempt inside a single account's page, which needs no owner. */
export interface AdminPayment {
  id: string;
  reference: string;
  providerReference: string | null;
  provider: AdminProvider;
  status: AdminPaymentStatus;
  amountMinor: number;
  currency: string;
  planName: string | null;
  failureReason: string | null;
  createdAtUtc: string;
}

/** One line of the audit trail. Emails come from stored snapshots, not a join. */
export interface AuditLogRow {
  id: string;
  actorUserId: string;
  actorEmail: string;
  /** The enum member's name, e.g. "GiftPro". */
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  ipAddress: string | null;
  summary: string;
  note: string | null;
  occurredAtUtc: string;
}

/** Everything the console shows about one account. The most personal payload. */
export interface AdminUserDetail {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  profilePictureUrl: string | null;
  role: string;
  isActive: boolean;
  hasGoogle: boolean;
  hasPassword: boolean;
  country: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** When a failed-login lockout lifts. Usually the real cause of "I can't log in". */
  lockoutEndAt: string | null;
  transcriptionCount: number;
  /** Free ones this account was charged this week (since Friday 18:00 WAT); bought ones apart. */
  trialGenerationsUsed: number;
  trialGenerationsTotal: number;
  subscription: AdminSubscription | null;
  payments: AdminPayment[];
  ledger: AdminLedgerEntry[];
  recentActions: AuditLogRow[];
  recentTranscriptions: AdminTranscriptionSummary[] | null;
  savedTranscriptionCount: number;
  failedTranscriptionCount: number;
  isInternal: boolean;
  lastSeenAtUtc: string | null;
  /** Bought transcriptions (one song at a time) spent and bought in all; per account only. */
  boughtTranscriptionsUsed: number;
  boughtTranscriptionsTotal: number;
  songPreviewsUsed: number;
  /** Jobs that spent an allowance: a free one, a bought one, a Pro song or the link preview. */
  chargedTranscriptionCount: number;
  /** The inbox the address delivers to (dots and +tags folded); accounts on one inbox share the free three. */
  canonicalEmail: string | null;
  /** Other accounts on the same inbox. */
  sharedMailboxAccounts: number;
}

export interface AdminTranscriptionSummary {
  id: string;
  title: string;
  key: string;
  tempoBpm: number;
  overallConfidence: number;
  status: string;
  createdAtUtc: string;
}

export interface AdminTranscriptionRow {
  id: string;
  userId: string;
  userEmail: string;
  title: string;
  key: string;
  tempoBpm: number;
  timeSignature: string;
  overallConfidence: number;
  status: string;
  createdAtUtc: string;
}

export interface SystemAnnouncement {
  id: string;
  message: string;
  severity: "info" | "warning" | "critical";
  isActive: boolean;
  expiresAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/** One thing the app did, for the admin console (mirrors `AppEventInput`). */
export interface AppEventInput {
  /** The phone's own id for it, 8–40 of [A-Za-z0-9_-]: the server keeps one per id per account, so sending again is safe. */
  id?: string;
  /** Lower-case words and underscores, at most 60 (`listen_take_end`). */
  name: string;
  /** Flat `key=value;…` pairs, at most 300 characters; nothing about the person. */
  detail?: string | null;
  /** When it happened, ISO 8601 UTC by the phone's clock (the server keeps it within a sensible range). */
  occurredAt: string;
}

/** Body of `POST /api/app/events` (mirrors `AppEventsRequest`). */
export interface AppEventsRequest {
  /** The installed native build (`nativeBuildVersion`), 0 when unknown. */
  build: number;
  events: AppEventInput[];
}

/** What `POST /api/app/events` kept (mirrors `AppEventsResult`). */
export interface AppEventsResult {
  accepted: number;
}

// ── Live support (C# Application/Support) ─────────────────────────────────────────────────────────────────────────

/** C# `SupportMessageDto`. */
export interface SupportMessage {
  id: string;
  fromAdmin: boolean;
  adminName: string | null;
  body: string;
  createdAtUtc: string;
}

/** C# `SupportThreadDto`: `conversationId` is null until the first message. */
export interface SupportThread {
  conversationId: string | null;
  closed: boolean;
  messages: SupportMessage[];
}
