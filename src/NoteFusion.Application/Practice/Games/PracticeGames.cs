using System.Globalization;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Games;

/// <summary>
/// A deal rebuilt from its id: the game, the track it was dealt for, its rounds with their answers, and the arcade level
/// it was dealt at (null for a one-off game, the older apps' kind).
/// </summary>
public sealed record GameDeal(string Game, string DealId, bool Playful, IReadOnlyList<PracticeGameRoundDto> Rounds, int? Level = null)
{
    /// <summary>A one-off Staff to solfa is a race, answered for a time; every other deal round by round to the end.</summary>
    public bool IsRace => Game == PracticeGames.Staff && Level is null;

    /// <summary>A level's Staff to solfa gives each note this long (an unanswered note is sent as "" and marked wrong).</summary>
    public double? SecondsPerRound => Game == PracticeGames.Staff && Level is { } level ? PracticeGames.StaffSecondsPerNote(level) : null;
}

/// <summary>A deal's answers as the server marks them (<see cref="PracticeGames.Mark"/>).</summary>
public sealed record GameMark(int Score, int Right, int Answered, IReadOnlyList<bool> Marks, bool EnoughAnswered);

/// <summary>
/// The quick games beside the sung practice, tapped not sung, about a minute each, no microphone: Which note? (doh, then
/// a note, tapped on the Curwen modulator), Staff to solfa (a note on the stave, tapped as its syllable, as many as a
/// minute allows), Name that hymn (a hymn's opening, its name picked from three) and Which scale? (a scale played up and
/// back down, its name picked from the scales of the Scales mode).
/// </summary>
/// <remarks>
/// <para>
/// <b>Dealt and marked by the server.</b> A deal is rebuilt from its id (<c>game:track:seed</c>, the seed the server's
/// own), so the rounds a tap is marked against are always the server's, as a mode's exercise is rebuilt from its id. The
/// app is handed every round's answer so it can say at once whether a tap was right, which a game needs; what counts is
/// the server's mark of the answers sent back, and a deal is marked once.
/// </para>
/// <para>
/// <b>The arcade: levels without end.</b> A deal may be dealt at a level (<c>game:track:seed:L7</c>): a short stage
/// (<see cref="StageRounds"/>), harder at every level and with no top. Which note? adds notes to hear (the scale, then
/// above and below it, then fe, ta, se, de and ma) and from <see cref="WhichNoteFullLevel"/> plays them ever shorter;
/// Staff to solfa adds keys up to six sharps and flats and ledger lines, and gives each note less time; Name that hymn
/// offers more names to pick from and plays less of each opening; Which scale? adds scales (major and minor first, the
/// world's last) and more names to pick from, then plays them ever quicker. A stage passed (<see cref="LevelUpScore"/>) deals the
/// next level; a poor one (under <see cref="LevelDownScore"/>) the one below, never under the track's first
/// (<see cref="StartLevel"/>). The app plays stage after stage until the singer stops.
/// </para>
/// <para>
/// <b>What it earns.</b> Less than a sung drill (<see cref="PracticeRules.GameXp"/>), on
/// <see cref="PracticeRules.GamesPerDay"/> games a day, under the same daily XP cap; a game that counts is a day of
/// practice for the streak. Games spend none of the day's marked drills (no worker marks them) and never move the path.
/// </para>
/// </remarks>
public static class PracticeGames
{
    public const string WhichNote = "which-note";
    public const string Staff = "staff";
    public const string Hymn = "hymn";
    public const string WhichScale = "which-scale";

    /// <summary>Every game, in the order the Practice screen lists them.</summary>
    public static readonly IReadOnlyList<string> All = [WhichNote, Staff, Hymn, WhichScale];

    public const int WhichScaleRounds = 8;

    public const int WhichNoteRounds = 10;
    public const int HymnRounds = 8;
    public const int HymnChoices = 3;

    /// <summary>Notes dealt for a race: more than anyone answers in <see cref="StaffSeconds"/>.</summary>
    public const int StaffRounds = 40;
    public const int StaffSeconds = 60;

    /// <summary>A race's key changes after this many notes.</summary>
    public const int StaffNotesPerKey = 10;

    /// <summary>The fewest notes a race must answer to count.</summary>
    public const int StaffMinAnswered = 5;

    private static readonly string[] Syllables = ["d", "r", "m", "f", "s", "l", "t"];
    private static readonly int[] MajorSteps = [0, 2, 4, 5, 7, 9, 11, 12];
    private static readonly int[] NaturalSemitones = [0, 2, 4, 5, 7, 9, 11];
    private static readonly char[] Letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    private static readonly int[] SharpOrder = [3, 0, 4, 1, 5, 2, 6];
    private static readonly int[] FlatOrder = [6, 2, 5, 1, 4, 0, 3];

    /// <summary>A major key: its doh spelled as the signature spells it, the doh's letter (C = 0), the signature, and the doh Which note? plays.</summary>
    private sealed record GameKey(string Doh, int Letter, int Fifths, int EarDohMidi);

    private static readonly GameKey[] Keys =
    [
        new("C", 0, 0, 60), new("G", 4, 1, 55), new("D", 1, 2, 62), new("A", 5, 3, 57),
        new("F", 3, -1, 65), new("Bb", 6, -2, 58), new("Eb", 2, -3, 63)
    ];

    /// <summary>The arcade's Staff to solfa keys, in the order its levels bring them: three, then pairs out to six sharps and flats.</summary>
    private static readonly GameKey[] StaffLevelKeys =
    [
        Keys[0], Keys[1], Keys[4], Keys[2], Keys[5], Keys[3], Keys[6],
        new("E", 2, 4, 64), new("Ab", 5, -4, 56), new("B", 6, 5, 59), new("Db", 1, -5, 61), new("F#", 3, 6, 54), new("Gb", 4, -6, 54)
    ];

    /// <summary>Playful's staff keys: none, one sharp, one flat.</summary>
    private static readonly GameKey[] PlayfulStaffKeys = [Keys[0], Keys[1], Keys[4]];

    /// <summary>The treble stave's diatonic positions a race asks (octave × 7 + letter): E4 to G5, Playful on the stave only (to F5).</summary>
    private const int LowestPosition = 4 * 7 + 2;
    private const int HighestPosition = 5 * 7 + 4;
    private const int PlayfulHighestPosition = 5 * 7 + 3;

    // ── The arcade's levels ─────────────────────────────────────────────────

    /// <summary>A stage passed at this score deals the next level.</summary>
    public const int LevelUpScore = 80;

    /// <summary>A stage under this score deals the level below (never under the track's first).</summary>
    public const int LevelDownScore = 50;

    /// <summary>The highest level a deal is made at: far past any level a singer reaches, to keep ids sane.</summary>
    public const int MaxLevel = 999;

    /// <summary>From this level Which note? has every note it asks, and plays them ever shorter instead.</summary>
    public const int WhichNoteFullLevel = 10;

    /// <summary>A stage's rounds: each game's is about a minute.</summary>
    public static int StageRounds(string game) => game switch
    {
        WhichNote => 8,
        Staff => 10,
        WhichScale => 6,
        _ => 6
    };

    /// <summary>The level a track starts each game at: Playful at the gentle first, Focused where its one-off games are.</summary>
    public static int StartLevel(PracticeTrack? track) => track == PracticeTrack.Playful ? 1 : 3;

    /// <summary>
    /// The level after a stage marked <paramref name="score"/> at <paramref name="level"/>: a poor stage steps down, but
    /// never under the track's first level (nor up to it, from a level already under it).
    /// </summary>
    public static int NextLevel(int level, int score, bool playful)
        => score >= LevelUpScore ? Math.Min(MaxLevel, level + 1)
            : score < LevelDownScore ? Math.Max(Math.Min(level, StartLevel(playful ? PracticeTrack.Playful : PracticeTrack.Focused)), level - 1)
            : level;

    /// <summary>Seconds a level's Staff to solfa gives each note: six at the first, half a second less a level, never under 1.5.</summary>
    public static double StaffSecondsPerNote(int level) => Math.Max(1.5, 6.0 - 0.5 * (Math.Max(1, level) - 1));

    public static bool Exists(string game) => All.Contains(game);

    /// <summary>A new deal's id for <paramref name="game"/> on <paramref name="track"/> (no track deals as Focused), at an arcade level when one is given.</summary>
    public static string NewDealId(string game, PracticeTrack? track, uint seed, int? level = null)
        => $"{game}:{(track == PracticeTrack.Playful ? "p" : "f")}:{seed.ToString("x8", CultureInfo.InvariantCulture)}"
           + (level is { } l ? $":L{l.ToString(CultureInfo.InvariantCulture)}" : "");

    /// <summary>The deal an id names, rebuilt; null for an id the server never deals.</summary>
    public static GameDeal? Deal(string? dealId)
    {
        var parts = (dealId ?? string.Empty).Split(':');
        if (parts.Length is not (3 or 4) || !Exists(parts[0]) || parts[1] is not ("p" or "f") || parts[2].Length != 8
            || !uint.TryParse(parts[2], NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var seed))
            return null;
        int? level = null;
        if (parts.Length == 4)
        {
            if (!parts[3].StartsWith('L') || !int.TryParse(parts[3][1..], NumberStyles.None, CultureInfo.InvariantCulture, out var l)
                || l < 1 || l > MaxLevel)
                return null;
            level = l;
        }
        var playful = parts[1] == "p";
        if (NewDealId(parts[0], playful ? PracticeTrack.Playful : PracticeTrack.Focused, seed, level) != dealId)
            return null;

        var rng = new Rng(seed);
        var rounds = (parts[0], level) switch
        {
            (WhichNote, null) => WhichNoteRoundsFor(rng, playful),
            (Staff, null) => StaffRoundsFor(rng, playful),
            (WhichScale, null) => ScaleRounds(rng, playful ? WhichScalePlayfulLevel : WhichScaleFocusedLevel, WhichScaleRounds),
            (_, null) => HymnRoundsFor(rng),
            (WhichNote, { } at) => WhichNoteLevelRounds(rng, at),
            (Staff, { } at) => StaffLevelRounds(rng, at),
            (WhichScale, { } at) => ScaleRounds(rng, at, StageRounds(WhichScale)),
            (_, { } at) => HymnLevelRounds(rng, at)
        };
        return new GameDeal(parts[0], dealId!, playful, rounds, level);
    }

    /// <summary>
    /// Marks <paramref name="answers"/> (one per round from the first, null for a round not answered) against the deal.
    /// A game of rounds is scored over every round; a race over the rounds answered, and counts once
    /// <see cref="StaffMinAnswered"/> are. Null when there are more answers than rounds.
    /// </summary>
    public static GameMark? Mark(GameDeal deal, IReadOnlyList<string?> answers)
    {
        if (answers.Count > deal.Rounds.Count)
            return null;
        var marks = new List<bool>();
        var answered = 0;
        for (var i = 0; i < answers.Count; i++)
        {
            if (answers[i] is not { } answer)
            {
                marks.Add(false);
                continue;
            }
            answered++;
            marks.Add(string.Equals(answer.Trim(), deal.Rounds[i].Answer, StringComparison.Ordinal));
        }

        var right = marks.Count(m => m);
        var over = deal.IsRace ? answered : deal.Rounds.Count;
        var score = over == 0 ? 0 : (int)Math.Round(100.0 * right / over, MidpointRounding.AwayFromZero);
        var enough = deal.IsRace ? answered >= StaffMinAnswered : answered == deal.Rounds.Count;
        return new GameMark(score, right, answered, marks, enough);
    }

    // ── Which note? ─────────────────────────────────────────────────────────

    private static List<PracticeGameRoundDto> WhichNoteRoundsFor(Rng rng, bool playful)
    {
        // Playful hears the doh chord's notes (me, soh, top doh); Focused every step up to the top doh. Doh itself is on
        // the ladder but never asked: it is the note played first.
        int[] degrees = playful ? [2, 4, 7] : [1, 2, 3, 4, 5, 6, 7];
        var choices = (playful ? new[] { 0, 2, 4, 7 } : [0, 1, 2, 3, 4, 5, 6, 7]).Select(SyllableOf).ToList();
        var rounds = new List<PracticeGameRoundDto>();
        var last = -1;
        for (var i = 0; i < WhichNoteRounds; i++)
        {
            var key = Keys[rng.Below(Keys.Length)];
            int degree;
            do degree = degrees[rng.Below(degrees.Length)];
            while (degree == last);
            last = degree;
            rounds.Add(new PracticeGameRoundDto(
                i, SyllableOf(degree), choices, key.Doh, $"{key.Doh} major", key.Fifths, key.EarDohMidi,
                key.EarDohMidi + MajorSteps[degree], null, null, null, null, null));
        }
        return rounds;
    }

    private static string SyllableOf(int degree) => degree == 7 ? "d'" : Syllables[degree];

    /// <summary>A note Which note? asks: its syllable and how far above the doh it sounds.</summary>
    private sealed record EarNote(string Syllable, int Semitones);

    private static readonly EarNote[] EarScale =
    [
        new("s,", -5), new("l,", -3), new("t,", -1), new("d", 0), new("de", 1), new("r", 2), new("ma", 3), new("m", 4),
        new("f", 5), new("fe", 6), new("s", 7), new("se", 8), new("l", 9), new("ta", 10), new("t", 11), new("d'", 12),
        new("r'", 14), new("m'", 16)
    ];

    /// <summary>The notes each level brings to Which note?, cumulatively (doh itself is played, never asked).</summary>
    private static readonly string[][] EarLevels =
    [
        ["m", "s", "d'"],
        ["r", "f"],
        ["l", "t"],
        ["r'", "m'"],
        ["t,", "l,", "s,"],
        ["fe"],
        ["ta"],
        ["se"],
        ["de"],
        ["ma"]
    ];

    /// <summary>The notes asked at a level, and the newest of them (asked more often, so the level says what it brought).</summary>
    public static (IReadOnlyList<string> Asked, IReadOnlyList<string> Newest) EarNotesAt(int level)
    {
        var upTo = Math.Clamp(level, 1, EarLevels.Length);
        return (EarLevels.Take(upTo).SelectMany(x => x).ToList(), EarLevels[upTo - 1]);
    }

    /// <summary>How long Which note? sounds the doh and the note at a level: a second, then 10% shorter each level past the full set, never under 0.35 s.</summary>
    public static double EarNoteSeconds(int level)
        => level <= WhichNoteFullLevel ? 1.0 : Math.Max(0.35, Math.Round(Math.Pow(0.9, level - WhichNoteFullLevel), 2));

    private static List<PracticeGameRoundDto> WhichNoteLevelRounds(Rng rng, int level)
    {
        var (asked, newest) = EarNotesAt(level);
        // The ladder shows the doh and every note asked, low to high.
        var choices = EarScale.Where(n => n.Syllable == "d" || asked.Contains(n.Syllable)).Select(n => n.Syllable).ToList();
        var seconds = EarNoteSeconds(level);
        var rounds = new List<PracticeGameRoundDto>();
        string? last = null;
        for (var i = 0; i < StageRounds(WhichNote); i++)
        {
            var key = Keys[rng.Below(Keys.Length)];
            string syllable;
            do syllable = rng.Below(10) < 3 ? newest[rng.Below(newest.Count)] : asked[rng.Below(asked.Count)];
            while (syllable == last && asked.Count > 1);
            last = syllable;
            var note = EarScale.First(n => n.Syllable == syllable);
            rounds.Add(new PracticeGameRoundDto(
                i, syllable, choices, key.Doh, $"{key.Doh} major", key.Fifths, key.EarDohMidi, key.EarDohMidi + note.Semitones,
                null, null, null, null, null, seconds));
        }
        return rounds;
    }

    // ── Staff to solfa ──────────────────────────────────────────────────────

    private static List<PracticeGameRoundDto> StaffRoundsFor(Rng rng, bool playful)
    {
        var keys = playful ? PlayfulStaffKeys : Keys;
        var highest = playful ? PlayfulHighestPosition : HighestPosition;
        var rounds = new List<PracticeGameRoundDto>();
        GameKey? key = null;
        var lastPosition = -1;
        for (var i = 0; i < StaffRounds; i++)
        {
            if (i % StaffNotesPerKey == 0)
            {
                var previous = key;
                do key = keys[rng.Below(keys.Length)];
                while (key == previous);
            }
            int position;
            do position = LowestPosition + rng.Below(highest - LowestPosition + 1);
            while (position == lastPosition);
            lastPosition = position;

            rounds.Add(StaffRound(i, key!, position));
        }
        return rounds;
    }

    /// <summary>The keys and the stave positions a level of the arcade's Staff to solfa asks.</summary>
    public static (int Keys, int Lowest, int Highest) StaffLevel(int level) => Math.Max(1, level) switch
    {
        1 => (3, LowestPosition, PlayfulHighestPosition),
        2 => (5, LowestPosition, HighestPosition),
        3 => (7, LowestPosition, HighestPosition),
        4 => (9, 4 * 7 + 1, 5 * 7 + 5),
        5 => (11, 4 * 7 + 0, 6 * 7 + 0),
        _ => (13, 4 * 7 + 0, 6 * 7 + 0)
    };

    private static List<PracticeGameRoundDto> StaffLevelRounds(Rng rng, int level)
    {
        var (keyCount, lowest, highest) = StaffLevel(level);
        var key = StaffLevelKeys[rng.Below(keyCount)];
        var rounds = new List<PracticeGameRoundDto>();
        var lastPosition = -1;
        for (var i = 0; i < StageRounds(Staff); i++)
        {
            int position;
            do position = lowest + rng.Below(highest - lowest + 1);
            while (position == lastPosition);
            lastPosition = position;
            rounds.Add(StaffRound(i, key, position));
        }
        return rounds;
    }

    private static PracticeGameRoundDto StaffRound(int index, GameKey key, int position)
    {
        var letter = position % 7;
        var octave = position / 7;
        var accidental = AccidentalIn(key, letter);
        var name = $"{Letters[letter]}{(accidental > 0 ? "#" : accidental < 0 ? "b" : "")}{octave}";
        var midi = 12 * (octave + 1) + NaturalSemitones[letter] + accidental;
        var syllable = Syllables[((letter - key.Letter) % 7 + 7) % 7];
        return new PracticeGameRoundDto(index, syllable, Syllables, key.Doh, $"{key.Doh} major", key.Fifths, null, midi, name, null, null, null, null);
    }

    /// <summary>+1 where the key signature sharpens <paramref name="letter"/>, −1 where it flattens it.</summary>
    private static int AccidentalIn(GameKey key, int letter)
        => key.Fifths > 0 && SharpOrder.Take(key.Fifths).Contains(letter) ? 1
            : key.Fifths < 0 && FlatOrder.Take(-key.Fifths).Contains(letter) ? -1
            : 0;

    // ── Name that hymn ──────────────────────────────────────────────────────

    private static List<PracticeGameRoundDto> HymnRoundsFor(Rng rng)
    {
        var all = HymnOpenings.All;
        var order = Shuffled(rng, Enumerable.Range(0, all.Count).ToList());
        var rounds = new List<PracticeGameRoundDto>();
        for (var i = 0; i < HymnRounds; i++)
        {
            var hymn = all[order[i]];
            var others = Shuffled(rng, Enumerable.Range(0, all.Count).Where(j => j != order[i]).ToList()).Take(HymnChoices - 1);
            var offered = Shuffled(rng, others.Append(order[i]).ToList()).Select(j => all[j]).ToList();
            rounds.Add(new PracticeGameRoundDto(
                i, hymn.Slug, offered.Select(h => h.Slug).ToList(), null, hymn.Key, null, null, null, null,
                hymn.TempoBpm, hymn.TimeSignature,
                hymn.Notes.Select(n => new GameNoteDto(n.PitchMidi, n.StartBeat, n.DurBeats)).ToList(),
                offered.Select(h => new GameHymnDto(h.Slug, h.Title, h.FirstLine)).ToList()));
        }
        return rounds;
    }

    /// <summary>Name that hymn at a level: names to pick from (three, then up to six) and opening notes played (all, then two fewer a level, never under four).</summary>
    public static (int Choices, int? Notes) HymnLevel(int level)
    {
        var l = Math.Max(1, level);
        var choices = l switch { <= 2 => 3, <= 4 => 4, <= 6 => 5, _ => 6 };
        return (choices, l <= 2 ? null : Math.Max(4, 12 - 2 * (l - 3)));
    }

    private static List<PracticeGameRoundDto> HymnLevelRounds(Rng rng, int level)
    {
        var (choices, keep) = HymnLevel(level);
        var all = HymnOpenings.All;
        var order = Shuffled(rng, Enumerable.Range(0, all.Count).ToList());
        var rounds = new List<PracticeGameRoundDto>();
        for (var i = 0; i < StageRounds(Hymn); i++)
        {
            var hymn = all[order[i]];
            var others = Shuffled(rng, Enumerable.Range(0, all.Count).Where(j => j != order[i]).ToList()).Take(choices - 1);
            var offered = Shuffled(rng, others.Append(order[i]).ToList()).Select(j => all[j]).ToList();
            var notes = hymn.Notes.Take(keep ?? hymn.Notes.Count).Select(n => new GameNoteDto(n.PitchMidi, n.StartBeat, n.DurBeats)).ToList();
            rounds.Add(new PracticeGameRoundDto(
                i, hymn.Slug, offered.Select(h => h.Slug).ToList(), null, hymn.Key, null, null, null, null,
                hymn.TempoBpm, hymn.TimeSignature, notes, offered.Select(h => new GameHymnDto(h.Slug, h.Title, h.FirstLine)).ToList()));
        }
        return rounds;
    }

    // ── Which scale? ────────────────────────────────────────────────────────

    /// <summary>The scales each level brings to Which scale?, cumulatively, by their codes in the Scales mode.</summary>
    private static readonly string[][] ScaleLevels =
    [
        ["major", "natural-minor"],
        ["harmonic-minor"],
        ["major-pentatonic", "minor-pentatonic"],
        ["blues"],
        ["melodic-minor"],
        ["dorian", "mixolydian"],
        ["phrygian", "lydian"],
        ["hijaz", "whole-tone"],
        ["japanese-in", "double-harmonic"],
        ["hungarian-minor", "locrian"]
    ];

    /// <summary>From this level Which scale? asks every scale, and plays them ever quicker instead.</summary>
    public static int WhichScaleFullLevel => ScaleLevels.Length;

    /// <summary>The one-off game's scales: Playful's as the arcade's third level, Focused's as its seventh.</summary>
    private const int WhichScalePlayfulLevel = 3;
    private const int WhichScaleFocusedLevel = 7;

    /// <summary>
    /// Which scale? at a level: the scales asked and the newest of them (asked more often), how many names are offered
    /// (three, then four, then five), and the beat: 96, then 8 quicker a level past the full set, up to 200.
    /// </summary>
    public static (IReadOnlyList<string> Asked, IReadOnlyList<string> Newest, int Choices, int TempoBpm) ScaleLevel(int level)
    {
        var l = Math.Max(1, level);
        var upTo = Math.Min(l, ScaleLevels.Length);
        var asked = ScaleLevels.Take(upTo).SelectMany(x => x).ToList();
        var choices = Math.Min(asked.Count, l <= 4 ? 3 : l <= WhichScaleFullLevel ? 4 : 5);
        var tempo = Math.Min(200, 96 + 8 * Math.Max(0, l - WhichScaleFullLevel));
        return (asked, ScaleLevels[upTo - 1], choices, tempo);
    }

    private static List<PracticeGameRoundDto> ScaleRounds(Rng rng, int level, int count)
    {
        var (asked, newest, choiceCount, tempo) = ScaleLevel(level);
        var rounds = new List<PracticeGameRoundDto>();
        string? last = null;
        for (var i = 0; i < count; i++)
        {
            string code;
            do code = rng.Below(10) < 3 ? newest[rng.Below(newest.Count)] : asked[rng.Below(asked.Count)];
            while (code == last && asked.Count > 1);
            last = code;
            var scale = ModeCatalogue.Scales.First(s => s.Code == code);
            var dohs = ModeCatalogue.Placements(scale);
            var exercise = ModeCatalogue.BuildScale(scale, dohs[rng.Below(dohs.Count)]);
            var at = Enumerable.Range(0, asked.Count).First(j => asked[j] == code);
            var others = Shuffled(rng, Enumerable.Range(0, asked.Count).Where(j => j != at).ToList()).Take(choiceCount - 1);
            var offered = Shuffled(rng, others.Append(at).ToList())
                .Select(j => ModeCatalogue.Scales.First(s => s.Code == asked[j]))
                .ToList();
            rounds.Add(new PracticeGameRoundDto(
                i, code, offered.Select(s => s.Code).ToList(), null, exercise.KeyName, null, null, null, null, tempo, ModeCatalogue.TimeSignature,
                exercise.Notes.Select(n => new GameNoteDto(n.PitchMidi, n.StartBeat, n.DurBeats)).ToList(), null, null,
                offered.Select(s => new GameScaleDto(s.Code, s.Title, s.Solfa)).ToList()));
        }
        return rounds;
    }

    private static List<int> Shuffled(Rng rng, List<int> items)
    {
        for (var i = items.Count - 1; i > 0; i--)
        {
            var j = rng.Below(i + 1);
            (items[i], items[j]) = (items[j], items[i]);
        }
        return items;
    }

    /// <summary>Mulberry32: a small generator whose sequence is the same on every runtime, so a deal rebuilds exactly.</summary>
    private sealed class Rng(uint seed)
    {
        private uint _state = seed;

        public int Below(int n)
        {
            unchecked
            {
                _state += 0x6D2B79F5;
                var t = _state;
                t = (t ^ (t >> 15)) * (t | 1);
                t ^= t + (t ^ (t >> 7)) * (t | 61);
                return (int)((t ^ (t >> 14)) % (uint)n);
            }
        }
    }
}
