using System.Globalization;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Games;

/// <summary>A deal rebuilt from its id: the game, the track it was dealt for, and its rounds with their answers.</summary>
public sealed record GameDeal(string Game, string DealId, bool Playful, IReadOnlyList<PracticeGameRoundDto> Rounds)
{
    /// <summary>A race (Staff to solfa) is answered for a time; the others round by round to the end.</summary>
    public bool IsRace => Game == PracticeGames.Staff;
}

/// <summary>A deal's answers as the server marks them (<see cref="PracticeGames.Mark"/>).</summary>
public sealed record GameMark(int Score, int Right, int Answered, IReadOnlyList<bool> Marks, bool EnoughAnswered);

/// <summary>
/// The quick games beside the sung practice, tapped not sung, about a minute each, no microphone: Which note? (doh, then
/// a note, tapped on the Curwen modulator), Staff to solfa (a note on the stave, tapped as its syllable, as many as a
/// minute allows) and Name that hymn (a hymn's opening, its name picked from three).
/// </summary>
/// <remarks>
/// <para>
/// <b>Dealt and marked by the server.</b> A deal is rebuilt from its id (<c>game:track:seed</c>, the seed the server's
/// own), so the rounds a tap is marked against are always the server's, as a mode's exercise is rebuilt from its id. The
/// app is handed every round's answer so it can say at once whether a tap was right, which a game needs; what counts is
/// the server's mark of the answers sent back, and a deal is marked once.
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

    /// <summary>Every game, in the order the Practice screen lists them.</summary>
    public static readonly IReadOnlyList<string> All = [WhichNote, Staff, Hymn];

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

    /// <summary>Playful's staff keys: none, one sharp, one flat.</summary>
    private static readonly GameKey[] PlayfulStaffKeys = [Keys[0], Keys[1], Keys[4]];

    /// <summary>The treble stave's diatonic positions a race asks (octave × 7 + letter): E4 to G5, Playful on the stave only (to F5).</summary>
    private const int LowestPosition = 4 * 7 + 2;
    private const int HighestPosition = 5 * 7 + 4;
    private const int PlayfulHighestPosition = 5 * 7 + 3;

    public static bool Exists(string game) => All.Contains(game);

    /// <summary>A new deal's id for <paramref name="game"/> on <paramref name="track"/> (no track deals as Focused).</summary>
    public static string NewDealId(string game, PracticeTrack? track, uint seed)
        => $"{game}:{(track == PracticeTrack.Playful ? "p" : "f")}:{seed.ToString("x8", CultureInfo.InvariantCulture)}";

    /// <summary>The deal an id names, rebuilt; null for an id the server never deals.</summary>
    public static GameDeal? Deal(string? dealId)
    {
        var parts = (dealId ?? string.Empty).Split(':');
        if (parts.Length != 3 || !Exists(parts[0]) || parts[1] is not ("p" or "f") || parts[2].Length != 8
            || !uint.TryParse(parts[2], NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var seed)
            || NewDealId(parts[0], parts[1] == "p" ? PracticeTrack.Playful : PracticeTrack.Focused, seed) != dealId)
            return null;

        var playful = parts[1] == "p";
        var rng = new Rng(seed);
        var rounds = parts[0] switch
        {
            WhichNote => WhichNoteRoundsFor(rng, playful),
            Staff => StaffRoundsFor(rng, playful),
            _ => HymnRoundsFor(rng)
        };
        return new GameDeal(parts[0], dealId!, playful, rounds);
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

            var letter = position % 7;
            var octave = position / 7;
            var accidental = AccidentalIn(key!, letter);
            var name = $"{Letters[letter]}{(accidental > 0 ? "#" : accidental < 0 ? "b" : "")}{octave}";
            var midi = 12 * (octave + 1) + NaturalSemitones[letter] + accidental;
            var syllable = Syllables[((letter - key!.Letter) % 7 + 7) % 7];
            rounds.Add(new PracticeGameRoundDto(
                i, syllable, Syllables, key.Doh, $"{key.Doh} major", key.Fifths, null, midi, name, null, null, null, null));
        }
        return rounds;
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
