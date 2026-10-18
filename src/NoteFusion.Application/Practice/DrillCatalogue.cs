using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Practice;

/// <summary>
/// A drill as written: a few solfa syllables, with octave marks the way a tonic solfa hymn book prints them (' above,
/// , below the unmarked doh), for one unit (<see cref="Step"/>, 1–5) of one grade (<see cref="Tier"/>). Minor patterns
/// are la-based (l, t, d r m). <see cref="Rhythm"/> is each note's length in beats ("1 .5 .5 2", "2/3" for a triplet
/// crotchet); none means a beat each with the last held for two.
/// </summary>
public sealed record DrillPattern(string Code, int Tier, int Step, string Title, KeyMode Mode, string Solfa, string? Rhythm = null)
{
    public IReadOnlyList<string> Tokens => Solfa.Split(' ', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>Each note's length in beats.</summary>
    public IReadOnlyList<double> Beats => Rhythm is null
        ? Tokens.Select((_, i) => i == Tokens.Count - 1 ? 2.0 : 1.0).ToList()
        : Rhythm.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(ParseBeats).ToList();

    private static double ParseBeats(string token)
    {
        var slash = token.IndexOf('/');
        return slash < 0
            ? double.Parse(token, CultureInfo.InvariantCulture)
            : double.Parse(token[..slash], CultureInfo.InvariantCulture) / double.Parse(token[(slash + 1)..], CultureInfo.InvariantCulture);
    }
}

/// <summary>
/// A pattern placed in a key: pitches, the solfa engine's labels for them, and the take's timing (the pattern's
/// rhythm); the take starts with the count-in the app played — the seconds it sends, or
/// <see cref="DrillCatalogue.LegacyLeadInBeats"/> from an app that sends none.
/// </summary>
public sealed record Drill(string Id, DrillPattern Pattern, MusicalKey Key, int DohMidi, int TempoBpm, IReadOnlyList<NoteEventDto> Notes)
{
    public double BeatSeconds => 60.0 / TempoBpm;
    public double LegacyLeadInSeconds => DrillCatalogue.LegacyLeadInBeats * BeatSeconds;
    public double PassageSeconds => Notes.Sum(n => n.DurBeats) * BeatSeconds;

    /// <summary>The longest take any app sends: the older apps' count-in (no app's is longer), the passage and the tail.</summary>
    public double MaxTakeSeconds => MaxTakeSecondsAfter(LegacyLeadInSeconds);

    /// <summary>The take kept after a count-in of <paramref name="leadInSec"/>: it, the passage, and <see cref="PracticeRules.DrillTakeTailSeconds"/>.</summary>
    public double MaxTakeSecondsAfter(double leadInSec) => Math.Round(leadInSec + PassageSeconds + PracticeRules.DrillTakeTailSeconds, 2);

    /// <summary>The notes to grade, beat one <paramref name="leadInSec"/> into the take (the older apps' count-in when none is given).</summary>
    public GradeTargetDto Target(double? leadInSec = null)
        => new(Notes.Select(n => new GradeTargetNoteDto(n.PitchMidi, n.StartBeat, n.DurBeats)).ToList(), TempoBpm, leadInSec ?? LegacyLeadInSeconds);

    /// <summary>"Eb major", "B minor": the key named as its signature spells it, readable by <see cref="KeyParser"/>.</summary>
    public string KeyName => Key.Mode == KeyMode.Major
        ? $"{Key.DohHeader()["Doh is ".Length..]} major"
        : Key.ToString();
}

/// <summary>
/// The practice curriculum's drills: ten grades (<see cref="DrillSyllabus"/>) of five units each, every unit a handful of
/// solfa patterns — steps, the doh chord, scales, leaps, the low register, la-based minor, the chromatics fe, de, ta and
/// se, choir lines, then Focused's wide leaps and sight-singing phrases. Each pattern is placed in a key of its grade
/// that keeps every note between A3 and D5, where an untrained voice sings comfortably (a man an octave down, which
/// the grader accepts). Pitches come from the syllables; the labels the client shows come back out of the solfa
/// engine (<see cref="SolfaMapper"/>), and a pattern whose labels would not round-trip is a programmer error.
/// </summary>
/// <remarks>
/// A drill is named by its id (<c>code@dohMidi</c>, or <c>code@dohMidi~gentle</c> at Playful's slower pace) and rebuilt
/// from it on grading, so the notes a take is judged against are always the server's, never the client's. Which drill
/// comes next is <see cref="PracticePath"/>'s business. Tiers 0–7 are the ladder every track climbs; tiers 8 and 9
/// (Advanced 1 and 2) are Focused's only. Rhythms keep every note at least <see cref="PracticeRules.ShortestNoteSeconds"/>
/// long: the worker judges each note by the pitch sung while it was due, and a shorter note would be judged on a
/// handful of frames (no semiquavers, no quaver triplets).
/// </remarks>
public static class DrillCatalogue
{
    /// <summary>
    /// The count-in apps played before it was held to five seconds: a bar of the first note and a bar of clicks in
    /// 4/4. A take sent without its own lead-in (those apps, OTA or not) is graded with it, and the drill still offers
    /// it to them as <c>leadInBeats</c>. Current apps count in with <c>leadInPlan</c> (web <c>assets/practice.js</c>,
    /// mobile <c>lib/practice.ts</c>) and send its seconds with the take; theirs is never longer than this.
    /// </summary>
    public const int LegacyLeadInBeats = 8;

    public const string TimeSignature = "4/4";

    /// <summary>The fewest and most notes a drill has: the longest are Advanced 2's sight-singing phrases.</summary>
    public const int MinNotes = 3;
    public const int MaxNotes = 16;

    /// <summary>The drill-id suffix for a pattern at Playful's slower pace.</summary>
    public const string GentleSuffix = "~gentle";

    /// <summary>The comfortable range every placed drill keeps to: A3 to D5.</summary>
    public const int LowestMidi = 57;
    public const int HighestMidi = 74;

    /// <summary>Every doh any grade places a drill on: C, D, Eb, E, F, G, Ab, A, Bb (minor drills: their relative minors).</summary>
    public static readonly IReadOnlyList<int> DohPitchClasses = [0, 2, 3, 4, 5, 7, 8, 9, 10];

    public static readonly IReadOnlyList<DrillPattern> Patterns =
    [
        // ── Grade 1: steps around doh ───────────────────────────────────────────
        new("steps-up", 0, 1, "Steps up from doh", KeyMode.Major, "d r m"),
        new("steps-down", 0, 1, "Steps down to doh", KeyMode.Major, "m r d"),
        new("steps-neighbour", 0, 1, "Doh and its neighbour", KeyMode.Major, "d r d"),
        new("steps-turn", 0, 2, "Up and home", KeyMode.Major, "d r m r d"),
        new("steps-dip", 0, 2, "Down and back up", KeyMode.Major, "m r d r m"),
        new("steps-ray-start", 0, 2, "Starting on ray", KeyMode.Major, "r m r d"),
        new("steps-repeat", 0, 3, "Each note twice", KeyMode.Major, "d d r r m"),
        new("steps-fah-up", 0, 3, "Up to fah", KeyMode.Major, "d r m f m"),
        new("steps-me-fah", 0, 3, "Me, fah, me, home", KeyMode.Major, "m f m r d"),
        new("steps-hold", 0, 4, "A held me", KeyMode.Major, "d r m r d", "1 1 2 1 2"),
        new("steps-te-below", 0, 4, "Te below doh", KeyMode.Major, "d t, d r d", "1 1 2 1 2"),
        new("steps-fah", 0, 4, "Up to fah and home", KeyMode.Major, "d r m f m r d"),
        new("steps-long-te", 0, 5, "Down to te and home", KeyMode.Major, "m r d t, d r d", "1 1 1 1 2 1 2"),
        new("steps-long-fah", 0, 5, "Round fah and home", KeyMode.Major, "m f m r d r d", "1 1 2 1 1 1 2"),
        new("steps-long-climb", 0, 5, "Climbing to fah", KeyMode.Major, "d r m r m f m", "1 1 2 1 1 1 2"),

        // ── Grade 2: the doh chord ──────────────────────────────────────────────
        new("triad-up", 1, 1, "The doh chord, rising", KeyMode.Major, "d m s"),
        new("triad-down", 1, 1, "The doh chord, falling", KeyMode.Major, "s m d"),
        new("so-mi", 1, 1, "Soh and me", KeyMode.Major, "s m s"),
        new("triad-arch", 1, 2, "Up the chord and back", KeyMode.Major, "d m s m d"),
        new("triad-from-soh", 1, 2, "From soh and back", KeyMode.Major, "s m d m s"),
        new("so-la-so", 1, 2, "Soh, lah, soh", KeyMode.Major, "s l s m"),
        new("chord-steps-down", 1, 3, "Up the chord, down the steps", KeyMode.Major, "d m s f m r d"),
        new("chord-to-me", 1, 3, "Down the chord, up to me", KeyMode.Major, "s m d r m"),
        new("so-mi-la", 1, 3, "Me, soh and lah", KeyMode.Major, "m s l s m d"),
        new("ray-quavers-up", 1, 4, "Quavers on me", KeyMode.Major, "d m m s m d", "1 .5 .5 1 1 2"),
        new("ray-quavers-repeat", 1, 4, "Quavers down the chord", KeyMode.Major, "s s m m d", ".5 .5 .5 .5 2"),
        new("ray-quavers-la", 1, 4, "Quavers to lah", KeyMode.Major, "s l s m d", ".5 .5 1 1 2"),
        new("chord-low-soh", 1, 5, "From low soh, in quavers", KeyMode.Major, "s, d m m r d", "1 1 .5 .5 1 2"),
        new("chord-arch-quavers", 1, 5, "Over soh to lah", KeyMode.Major, "d m s l s m d", "1 1 .5 .5 1 1 2"),
        new("chord-steps-quavers", 1, 5, "Running down to doh", KeyMode.Major, "s f m r d m d", ".5 .5 .5 .5 1 1 2"),

        // ── Grade 3: scales ─────────────────────────────────────────────────────
        new("scale-five-up", 2, 1, "Five notes up", KeyMode.Major, "d r m f s"),
        new("scale-five-down", 2, 1, "Five notes down", KeyMode.Major, "s f m r d"),
        new("scale-top", 2, 1, "Soh up to doh", KeyMode.Major, "s l t d'"),
        new("scale-up", 2, 2, "The scale, rising", KeyMode.Major, "d r m f s l t d'"),
        new("scale-down", 2, 2, "The scale, falling", KeyMode.Major, "d' t l s f m r d"),
        new("scale-top-down", 2, 2, "Top doh down to soh", KeyMode.Major, "d' t l s"),
        new("scale-thirds-up", 2, 3, "Thirds up the scale", KeyMode.Major, "d m r f m s"),
        new("scale-thirds-down", 2, 3, "Thirds down the scale", KeyMode.Major, "s m f r m d"),
        new("scale-skip", 2, 3, "Skipping up to lah", KeyMode.Major, "m s f l s"),
        new("scale-quaver-up", 2, 4, "A quaver run to soh", KeyMode.Major, "d r m f s m d", ".5 .5 .5 .5 1 1 2"),
        new("scale-fourth-home", 2, 4, "A fourth to the top doh", KeyMode.Major, "s d' t l s", "1 1 .5 .5 2"),
        new("scale-quaver-down", 2, 4, "Quavers down the scale", KeyMode.Major, "d' t l s f m r d", ".5 .5 1 .5 .5 1 1 2"),
        new("scale-run-hold", 2, 5, "Run up and hold", KeyMode.Major, "d r m f s l t d'", ".5 .5 .5 .5 .5 .5 1 3"),
        new("scale-thirds-fall", 2, 5, "Falling in thirds", KeyMode.Major, "d' l t s l f s m", "3 1 1 1 1 1 1 2"),
        new("scale-steps-skips", 2, 5, "Steps and skips", KeyMode.Major, "d r m d f m r d", "1 1 1 1 .5 .5 1 2"),

        // ── Grade 4: leaps ──────────────────────────────────────────────────────
        new("leap-fifth", 3, 1, "Leap to soh", KeyMode.Major, "d s m d"),
        new("leap-thirds", 3, 1, "Thirds and a fifth", KeyMode.Major, "m d s m"),
        new("leap-fifth-down", 3, 1, "Soh down to doh", KeyMode.Major, "s d m s"),
        new("leap-fourth", 3, 2, "Leap to fah", KeyMode.Major, "d f l s"),
        new("leap-octave", 3, 2, "Leap to the top doh", KeyMode.Major, "s d' s m"),
        new("leap-ray-soh", 3, 2, "Ray up to soh", KeyMode.Major, "r s f m r d"),
        new("leap-true-octave", 3, 3, "An octave leap", KeyMode.Major, "d d' t l s"),
        new("leap-octave-down", 3, 3, "Top doh down an octave", KeyMode.Major, "d' d r m s"),
        new("leap-soh-octave", 3, 3, "Low soh up an octave", KeyMode.Major, "s, s m d"),
        new("leap-dotted-chord", 3, 4, "Dotted: up the chord", KeyMode.Major, "d m s d' s m d", "1.5 .5 1 1 1.5 .5 2"),
        new("leap-dotted-fall", 3, 4, "Dotted: a falling line", KeyMode.Major, "s m l s f m r d", "1.5 .5 1 1 1.5 .5 1 2"),
        new("leap-dotted-fourths", 3, 4, "Dotted: fourths", KeyMode.Major, "r s m l s", "1.5 .5 1.5 .5 2"),
        new("leap-octave-dotted", 3, 5, "An octave and a dotted fall", KeyMode.Major, "d d' t l s m r d", "1 1 1.5 .5 1 1 1 2"),
        new("leap-fourths-turn", 3, 5, "Fourths and a dotted turn", KeyMode.Major, "m l s d' t l s", "1 1.5 .5 1 1 1 2"),
        new("leap-fifths-line", 3, 5, "Fifths and fourths", KeyMode.Major, "d s l s d' s m d", "1 1 1.5 .5 .5 .5 1 2"),

        // ── Grade 5: below doh, and wider ───────────────────────────────────────
        new("low-soh", 4, 1, "Down to low soh", KeyMode.Major, "s, d m d"),
        new("low-soh-steps", 4, 1, "From low soh, up", KeyMode.Major, "s, d r m"),
        new("low-soh-return", 4, 1, "Up the chord, down to low soh", KeyMode.Major, "d s m d s,"),
        new("low-lah-turn", 4, 2, "Round low lah", KeyMode.Major, "d t, l, t, d r m"),
        new("low-lah-leap", 4, 2, "Up from low lah", KeyMode.Major, "l, d m d"),
        new("wide-arch", 4, 2, "Over the top doh", KeyMode.Major, "m s d' s m"),
        new("wide-chord", 4, 2, "The chord, both ways", KeyMode.Major, "d m s d' s m d"),
        new("low-to-high-soh", 4, 3, "Low soh to soh", KeyMode.Major, "s, d m s"),
        new("soh-to-low-soh", 4, 3, "Soh down to low soh", KeyMode.Major, "s m d s, d"),
        new("lah-to-low-soh", 4, 3, "Lah down to low soh", KeyMode.Major, "l s m d s, l, t, d"),
        new("leap-sixth", 4, 4, "Leap to lah", KeyMode.Major, "d l s m d"),
        new("tie-low-soh", 4, 4, "Held over the bar", KeyMode.Major, "s, d m s m d", "1 1 1 2 1 2"),
        new("sixth-low-soh-me", 4, 4, "A sixth: low soh up to me", KeyMode.Major, "s, m r d"),
        new("low-wide-tied", 4, 5, "Low soh to lah, tied over", KeyMode.Major, "s, d m s l s m d", "1 1 1 2 1 1 1 2"),
        new("sixth-low-line", 4, 5, "A sixth, then down to low soh", KeyMode.Major, "d l s m d s, l, t, d", "1 1 1 2 1 1 1 1 2"),
        new("two-sixths-tied", 4, 5, "Two sixths, tied over", KeyMode.Major, "d l s m d' t l s", "1 1 1 2 1 1 1 2"),

        // ── Grade 6: lah — low lah, then la-based minor ─────────────────────────
        new("lah-low-chord", 5, 1, "Down to low lah", KeyMode.Major, "m d l, d"),
        new("lah-low-turn", 5, 1, "Low lah and up to me", KeyMode.Major, "d l, d r m"),
        new("lah-low-steps", 5, 1, "Me down to low lah", KeyMode.Major, "m r d l, d"),
        new("minor-up", 5, 2, "Minor: lah up to me", KeyMode.Minor, "l, t, d r m"),
        new("minor-down", 5, 2, "Minor: me down to lah", KeyMode.Minor, "m r d t, l,"),
        new("minor-chord", 5, 2, "Minor: the lah chord", KeyMode.Minor, "l, d m l"),
        new("minor-leading", 5, 3, "Minor: the leading note", KeyMode.Minor, "l, se, l,"),
        new("minor-cadence", 5, 3, "Minor: home through se", KeyMode.Minor, "m d t, se, l,"),
        new("minor-phrase", 5, 3, "Minor: a phrase", KeyMode.Minor, "l, d m r d t, l,"),
        new("minor-sixth-sync", 5, 4, "Minor: a sixth, off the beat", KeyMode.Minor, "l, f m r d t, l,", "1 .5 1 .5 1 1 2"),
        new("minor-se-sync", 5, 4, "Minor: up to se, syncopated", KeyMode.Minor, "m l, d m se l", ".5 1 .5 1 1 2"),
        new("minor-sync-steps", 5, 4, "Minor: a syncopated turn", KeyMode.Minor, "l, t, d t, l, se, l,", ".5 1 .5 1 1 1 2"),
        new("minor-long-se", 5, 5, "Minor: up to lah and home", KeyMode.Minor, "l, d m l se l m d t, l,", "1 1 1 .5 .5 2 .5 1 .5 2"),
        new("minor-down-se", 5, 5, "Minor: down to lah through se", KeyMode.Minor, "m f m r d t, l, se, l,", ".5 1 .5 2 1 1 1 1 2"),
        new("minor-sixth-line", 5, 5, "Minor: a sixth in a long line", KeyMode.Minor, "m l, f m r d t, l,", "1 1 .5 1 .5 1 1 2"),

        // ── Grade 7: te — chromatic notes ───────────────────────────────────────
        new("chromatic-de", 6, 1, "de, leading to ray", KeyMode.Major, "d de r"),
        new("chromatic-fe", 6, 1, "fe, leading to soh", KeyMode.Major, "s fe s"),
        new("chromatic-ta", 6, 1, "ta, falling to lah", KeyMode.Major, "d' ta l"),
        new("chromatic-de-turn", 6, 2, "de, between rays", KeyMode.Major, "d r de r"),
        new("chromatic-fe-rise", 6, 2, "Me, fe, soh", KeyMode.Major, "m fe s"),
        new("chromatic-ta-turn", 6, 2, "Soh, ta, lah", KeyMode.Major, "s ta l s"),
        new("chromatic-fe-either", 6, 3, "fe either side of soh", KeyMode.Major, "s fe s l s"),
        new("chromatic-ta-between", 6, 3, "ta between lahs", KeyMode.Major, "s l ta l s"),
        new("chromatic-de-neighbour", 6, 3, "de under ray", KeyMode.Major, "m r de r m"),
        new("choir-fe-line", 6, 4, "A line through fe", KeyMode.Major, "d m s fe s m r d", "1 1 1.5 .5 1 1 1 2"),
        new("choir-ta-fe", 6, 4, "ta and fe on the way down", KeyMode.Major, "d' t l ta l s fe s", "1 .5 1 .5 1 1 1 2"),
        new("chromatic-de-line", 6, 4, "Down through de", KeyMode.Major, "s m de r t, d", "1 1 1 1.5 .5 2"),
        new("turn-to-soh", 6, 5, "Turning towards soh", KeyMode.Major, "d r m fe s l s fe s", "1 1 1 .5 .5 1 1 1 2"),
        new("turn-to-fah", 6, 5, "Turning towards fah", KeyMode.Major, "d m s ta l s f m", "1 1 1 1 1.5 .5 1 2"),
        new("choir-melodic-minor", 6, 5, "Minor: the melodic scale", KeyMode.Minor, "l, t, d r m fe se l", "1 1 1 1 .5 .5 1 2"),

        // ── Grade 8: choir-ready — whole choir lines ────────────────────────────
        new("choir-low-line", 7, 1, "From low soh to soh", KeyMode.Major, "s, d t, d r m f s"),
        new("choir-de-line", 7, 1, "A line through de", KeyMode.Major, "m de r t, d"),
        new("choir-hymn-low", 7, 1, "A hymn line to low soh and home", KeyMode.Major, "d m r d s, l, t, d"),
        new("choir-ta-down", 7, 2, "A long fall through ta", KeyMode.Major, "d' t l ta l s f m r d"),
        new("choir-minor-home", 7, 2, "Minor: round se and home", KeyMode.Minor, "m r d t, l, se, l, t, d"),
        new("choir-de-fe", 7, 2, "Up through de and fe", KeyMode.Major, "d de r m fe s"),
        new("choir-seventh", 7, 3, "Low soh up a seventh to fah", KeyMode.Major, "r d t, s, f m r d"),
        new("choir-dotted-hymn", 7, 3, "A dotted hymn tune", KeyMode.Major, "d r m s l s m r d", "1.5 .5 1 1 1.5 .5 1 1 2"),
        new("choir-minor-long", 7, 3, "Minor: a long line home", KeyMode.Minor, "l, se, l, m f m r d t, l,"),
        new("choir-triplets-up", 7, 4, "Triplets up to fah", KeyMode.Major, "d r m f s m d", "2/3 2/3 2/3 1 1 1 2"),
        new("choir-triplet-minor", 7, 4, "Minor: triplets from lah", KeyMode.Minor, "l, t, d m r d t, l,", "2/3 2/3 2/3 1 1 1 1 2"),
        new("choir-triplet-fe", 7, 4, "Triplets round fe", KeyMode.Major, "s fe s l t d' s m d", "1 2/3 2/3 2/3 1 1 1 1 2"),
        new("choir-modulate-soh", 7, 5, "Turning to soh and back", KeyMode.Major, "d m s fe s l t d' l s fe s", "1 1 1 .5 .5 2 1 1 2 1 1 2"),
        new("choir-modulate-fah", 7, 5, "Turning to fah and home", KeyMode.Major, "s m d ta l s f m r d t, d", "1 1 2/3 2/3 2/3 1 1 1 1 1 1 2"),
        new("choir-triplet-tied", 7, 5, "Tied over, then triplets", KeyMode.Major, "d m s l s m r d t, d", "1 1 1 2 2/3 2/3 2/3 1 1 2"),

        // ── Advanced 1 (Focused only): wide leaps ───────────────────────────────
        new("sixth-ray-te", 8, 1, "Sixths: doh to lah, ray to te", KeyMode.Major, "d l s r t l s"),
        new("sixth-minor-me", 8, 1, "A minor sixth: me to the top doh", KeyMode.Major, "m d' t l s m"),
        new("sixth-low-soh", 8, 1, "Sixths from low soh and doh", KeyMode.Major, "s, m d l s m"),
        new("seventh-fah", 8, 2, "A seventh: low soh up to fah", KeyMode.Major, "s, f m r d"),
        new("seventh-down", 8, 2, "Falling a seventh: top doh to ray", KeyMode.Major, "d' r m f m r d"),
        new("seventh-ray-doh", 8, 2, "A seventh: ray up to the top doh", KeyMode.Major, "r d' t l s"),
        new("seventh-te", 8, 3, "A seventh: doh up to te", KeyMode.Major, "d t d' s m d"),
        new("minor-se-leap", 8, 3, "Minor: me down to se", KeyMode.Minor, "l, d m se, l,"),
        new("minor-se-sixth", 8, 3, "Minor: se up to me", KeyMode.Minor, "l, se, m d t, l,"),
        new("minor-harmonic", 8, 4, "Minor: the harmonic scale", KeyMode.Minor, "l, t, d r m f se l"),
        new("minor-dim-seventh", 8, 4, "Minor: the diminished seventh", KeyMode.Minor, "se, f m r d t, l,"),
        new("tritone-resolve", 8, 4, "A tritone, resolving", KeyMode.Major, "f t d' l f r t, d"),
        new("wide-dotted", 8, 5, "Sixths from low soh, dotted", KeyMode.Major, "s, m d l s d' t l s", "1 1 1 1 1.5 .5 1 1 2"),
        new("wide-sync-seventh", 8, 5, "A seventh, syncopated", KeyMode.Major, "s, f m d l, t, d", ".5 1 .5 1 1 1 2"),
        new("wide-triplet-sixths", 8, 5, "Sixths in triplets", KeyMode.Major, "m d' l s m d l, d", "2/3 2/3 2/3 1 1 1 1 2"),
        new("wide-octave-sevenths", 8, 5, "An octave and two sevenths", KeyMode.Major, "d d' r m f s, f m r d", "1 1 1.5 .5 2 1 1 1 1 2"),

        // ── Advanced 2 (Focused only): sight-singing phrases ────────────────────
        new("sight-hymn-line", 9, 1, "A hymn line", KeyMode.Major, "d m s l s m r d t, d"),
        new("sight-sixths-line", 9, 1, "Sixths in a long line", KeyMode.Major, "s, m r d l s f m r d t, d"),
        new("sight-dotted-hymn", 9, 1, "A dotted hymn line", KeyMode.Major, "s, d d r m d r m f m r d t, d", "1 1.5 .5 1 1 1.5 .5 1 1 1.5 .5 1 1 2"),
        new("sight-minor-line", 9, 2, "Minor: a line through se", KeyMode.Minor, "l, d m l se l m d t, l,"),
        new("sight-chromatic-line", 9, 2, "Up through de and fe", KeyMode.Major, "d de r m fe s l s f m r d"),
        new("sight-chromatic-dotted", 9, 2, "fe and ta, dotted", KeyMode.Major, "d r m fe s l ta l s fe s m d", "1 .5 .5 1 1 1.5 .5 1 1 1 1 1 2"),
        new("sight-to-soh", 9, 3, "Turning to soh through fe", KeyMode.Major, "d m r f m s fe s l t l s"),
        new("sight-to-fah", 9, 3, "Turning to fah through ta", KeyMode.Major, "d m s ta l f s m f"),
        new("sight-minor-to-major", 9, 3, "Minor, turning to its doh", KeyMode.Minor, "l, d m l se l m d r m s f m d", "1 1 1 1.5 .5 2 1 1 1 1 1 .5 .5 2"),
        new("sight-syncopated", 9, 4, "A syncopated line", KeyMode.Major, "d m s s l s m d r m r d", ".5 1 .5 1 1 .5 1 .5 1 1 1 2"),
        new("sight-triplet-line", 9, 4, "Triplets up and down the scale", KeyMode.Major, "d r m f s l s f m r d t, d", "2/3 2/3 2/3 1 1 1 1 2/3 2/3 2/3 1 1 2"),
        new("sight-sync-minor", 9, 4, "Minor: syncopated, round se", KeyMode.Minor, "l, t, d m r d t, l, se, l, d m l", ".5 1 .5 1 1 1 1 .5 1 .5 1 1 2"),
        new("sight-triplet-minor", 9, 4, "Minor: triplets up to lah", KeyMode.Minor, "l, d m l l se l m r d t, l,", "1 1 2/3 2/3 2/3 1 2 1 1 1 1 2"),
        new("sight-tied-long", 9, 5, "A sixteen-note hymn line, tied", KeyMode.Major, "s, d r m r d m s l s m d r m r d", "1 1 1 2 1 1 1 1 2 1 1 1 2 1 1 2"),
        new("sight-long-chromatic", 9, 5, "A long chromatic line", KeyMode.Major, "s, d m s fe s l t d' s m de r t, d", "1 1 1 .5 .5 1 1 1 2 1 1 .5 .5 1 2"),
        new("sight-minor-long", 9, 5, "Minor: a long line with triplets", KeyMode.Minor, "m l, t, d r m f m r d t, se, l,", "1 1 2/3 2/3 2/3 1 1 1 1.5 .5 1 1 2"),
        new("sight-long-ta", 9, 5, "Over the top doh through ta", KeyMode.Major, "d m s d' ta l s f m r d t, d", "1 1 1 1 1.5 .5 1 1 1 1 1 1 2"),
    ];

    /// <summary>The top of the ladder every track climbs: one tier per level, Doh to Choir-ready.</summary>
    public static int LadderTopTier => PracticeRules.Levels.Count - 1;

    /// <summary>The top of the catalogue: the Focused-only tiers above the ladder.</summary>
    public static int TopTier => Patterns.Max(p => p.Tier);

    /// <summary>A pattern's grade.</summary>
    public static DrillSyllabus SyllabusOf(DrillPattern pattern) => DrillSyllabus.For(pattern.Tier);

    /// <summary>
    /// A pattern Playful may offer: major, at most <see cref="PracticeRules.PlayfulMaxNotes"/> notes in plain crotchets
    /// and held notes, from the first <see cref="PracticeRules.PlayfulTopStep"/> units of a grade no higher than
    /// <see cref="PracticeRules.PlayfulTopTier"/>, and chromatic only from <see cref="PracticeRules.PlayfulChromaticTier"/>.
    /// </summary>
    public static bool IsPlayful(DrillPattern pattern)
        => pattern.Tier <= PracticeRules.PlayfulTopTier
           && pattern.Step <= PracticeRules.PlayfulTopStep
           && pattern.Mode == KeyMode.Major
           && pattern.Tokens.Count <= PracticeRules.PlayfulMaxNotes
           && (RhythmOf(pattern) & ~DrillRhythm.Minims) == 0
           && (pattern.Tier >= PracticeRules.PlayfulChromaticTier || !IsChromatic(pattern));

    /// <summary>Whether a pattern is on a track's slice of the catalogue (no track: the ladder, tiers 0–7).</summary>
    public static bool OnTrack(DrillPattern pattern, PracticeTrack? track) => track switch
    {
        PracticeTrack.Playful => IsPlayful(pattern),
        PracticeTrack.Focused => true,
        _ => pattern.Tier <= LadderTopTier
    };

    /// <summary>
    /// The grade a singer at <paramref name="levelIndex"/> starts a track's path on: the level's own (the ladder's top
    /// beyond it) with no track chosen; held to <see cref="PracticeRules.PlayfulTopTier"/> on Playful; and
    /// <see cref="PracticeRules.FocusedTierLead"/> ahead on Focused, into the grades only Focused sees.
    /// </summary>
    public static int TierFor(PracticeTrack? track, int levelIndex)
    {
        var level = Math.Max(0, levelIndex);
        return track switch
        {
            PracticeTrack.Playful => Math.Min(level, PracticeRules.PlayfulTopTier),
            PracticeTrack.Focused => Math.Min(level + PracticeRules.FocusedTierLead, TopTier),
            _ => Math.Min(level, LadderTopTier)
        };
    }

    /// <summary>The patterns a track offers in one unit (<paramref name="tier"/>, <paramref name="step"/>), in catalogue order.</summary>
    public static IReadOnlyList<DrillPattern> UnitPatterns(PracticeTrack? track, int tier, int step)
        => Patterns.Where(p => p.Tier == tier && p.Step == step && OnTrack(p, track)).ToList();

    /// <summary>The grade's tempo for its first unit; each unit after it is <see cref="PracticeRules.TempoPerStep"/> quicker.</summary>
    public static int TempoFor(int tier, int step = 1)
        => DrillSyllabus.For(tier).TempoBpm + (Math.Clamp(step, 1, DrillSyllabus.UnitsPerGrade) - 1) * PracticeRules.TempoPerStep;

    /// <summary>Semitones from the unmarked doh for each syllable of <paramref name="pattern"/>.</summary>
    public static IReadOnlyList<int> Offsets(DrillPattern pattern) => pattern.Tokens.Select(Offset).ToList();

    /// <summary>A note's semitone above its doh, 0–11.</summary>
    private static int PitchClass(int offset) => ((offset % 12) + 12) % 12;

    /// <summary>Whether any note is outside the pattern's mode (minor's own se and fe are not chromatic).</summary>
    public static bool IsChromatic(DrillPattern pattern)
    {
        int[] scale = pattern.Mode == KeyMode.Major ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 4, 5, 6, 7, 8, 9, 11];
        return Offsets(pattern).Any(o => !scale.Contains(PitchClass(o)));
    }

    /// <summary>Each note's start beat and length, from the pattern's rhythm.</summary>
    public static IReadOnlyList<(double Start, double Beats)> Timing(DrillPattern pattern)
    {
        var beats = pattern.Beats;
        var timing = new List<(double, double)>(beats.Count);
        var at = 0.0;
        foreach (var b in beats)
        {
            timing.Add((Math.Round(at, 6), Math.Round(b, 6)));
            at += b;
        }
        return timing;
    }

    /// <summary>What the pattern's rhythm asks of the singer (the last note, held, never counts as a minim or a tie).</summary>
    public static DrillRhythm RhythmOf(DrillPattern pattern)
    {
        var timing = Timing(pattern);
        var beatsPerBar = 4.0;
        var rhythm = DrillRhythm.Crotchets;
        for (var i = 0; i < timing.Count; i++)
        {
            var (start, length) = timing[i];
            var last = i == timing.Count - 1;
            var halves = length * 2;
            var triplet = Math.Abs(halves - Math.Round(halves)) > 1e-6;
            if (triplet)
                rhythm |= DrillRhythm.Triplets;
            else if (Math.Abs(length - 0.5) < 1e-6)
                rhythm |= DrillRhythm.Quavers;
            else if (Math.Abs(length - 1.5) < 1e-6)
                rhythm |= DrillRhythm.Dotted;
            else if (length >= 2 && !last)
                rhythm |= DrillRhythm.Minims;

            var offBeat = Math.Abs(start - Math.Round(start)) > 1e-6;
            if (offBeat && !triplet && length >= 1 - 1e-6)
                rhythm |= DrillRhythm.Syncopation;
            if (!last && Math.Floor(start / beatsPerBar + 1e-9) != Math.Floor((start + length) / beatsPerBar - 1e-9))
                rhythm |= DrillRhythm.Ties;
        }
        return rhythm;
    }

    /// <summary>The unmarked-doh MIDI pitches <paramref name="pattern"/> is placed on: its grade's keys, in range, lowest first.</summary>
    public static IReadOnlyList<int> Placements(DrillPattern pattern)
    {
        var syllabus = SyllabusOf(pattern);
        return InRange(pattern, pattern.Mode == KeyMode.Major ? syllabus.MajorDohs : syllabus.MinorDohs);
    }

    /// <summary>
    /// Every doh <paramref name="pattern"/> fits on in range, from all of <see cref="DohPitchClasses"/>: what
    /// <see cref="Find"/> accepts, so a drill handed out before a grade's keys changed is still marked.
    /// </summary>
    public static IReadOnlyList<int> AnyPlacements(DrillPattern pattern) => InRange(pattern, DohPitchClasses);

    private static List<int> InRange(DrillPattern pattern, IReadOnlyList<int> dohPitchClasses)
    {
        var offsets = Offsets(pattern);
        var low = offsets.Min();
        var high = offsets.Max();
        return dohPitchClasses
            .SelectMany(pc => new[] { 48 + pc, 60 + pc })
            .Where(doh => doh + low >= LowestMidi && doh + high <= HighestMidi)
            .Order()
            .ToList();
    }

    /// <summary>
    /// The pattern placed with its unmarked doh on <paramref name="dohMidi"/>: pitches from the syllables, labels
    /// from the solfa engine, timing from its rhythm. Throws when the engine would label it differently — a catalogue mistake.
    /// </summary>
    public static Drill Build(DrillPattern pattern, int dohMidi, bool gentle = false)
    {
        var dohPc = dohMidi % 12;
        var key = pattern.Mode == KeyMode.Major
            ? new MusicalKey(dohPc, KeyMode.Major)
            : new MusicalKey((dohPc + 9) % 12, KeyMode.Minor);

        var pitches = Offsets(pattern).Select(o => dohMidi + o).ToList();
        var timing = Timing(pattern);
        if (timing.Count != pitches.Count)
            throw new InvalidOperationException($"Drill '{pattern.Code}' has {pitches.Count} notes but {timing.Count} lengths.");
        var reference = SolfaMapper.ReferenceDoh(pitches, key.DohPitchClass, key.Mode);
        var ascending = SolfaMapper.AscendingFlags(pitches, key.DohPitchClass);

        var notes = new List<NoteEventDto>(pitches.Count);
        for (var i = 0; i < pitches.Count; i++)
        {
            var syllable = SolfaMapper.Map(
                pitches[i], key, reference, ascending[i] ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
            notes.Add(new NoteEventDto(
                pitches[i], timing[i].Start, timing[i].Beats, SolfaMapper.Degree(pitches[i], key), syllable.Text, syllable.OctaveMark, 1.0));
        }

        var labels = string.Join(' ', notes.Select(n => n.Solfa + n.OctaveMark));
        if (labels != string.Join(' ', pattern.Tokens))
            throw new InvalidOperationException(
                $"Drill '{pattern.Code}' on {dohMidi} is labelled \"{labels}\" by the solfa engine, not \"{pattern.Solfa}\".");

        var tempo = TempoFor(pattern.Tier, pattern.Step);
        return gentle
            ? new Drill($"{pattern.Code}@{dohMidi}{GentleSuffix}", pattern, key, dohMidi, tempo - PracticeRules.PlayfulTempoDrop, notes)
            : new Drill($"{pattern.Code}@{dohMidi}", pattern, key, dohMidi, tempo, notes);
    }

    /// <summary>A drill's id without building it.</summary>
    public static string IdOf(DrillPattern pattern, int dohMidi, bool gentle)
        => $"{pattern.Code}@{dohMidi}{(gentle ? GentleSuffix : "")}";

    /// <summary>
    /// The drill an id names, or null when it names none (an old id, a typo, a range it may not use, the gentle pace
    /// on a pattern Playful never offers). Any track's drill is found, so a take sung before a switch is still marked.
    /// </summary>
    public static Drill? Find(string? id)
    {
        var gentle = id?.EndsWith(GentleSuffix, StringComparison.Ordinal) == true;
        var parts = (gentle ? id![..^GentleSuffix.Length] : id)?.Split('@');
        if (parts is not { Length: 2 } || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var doh))
            return null;
        var pattern = Patterns.FirstOrDefault(p => p.Code == parts[0]);
        if (pattern is null || !AnyPlacements(pattern).Contains(doh) || (gentle && !IsPlayful(pattern)))
            return null;
        return Build(pattern, doh, gentle);
    }

    /// <summary>A stable hash (unlike <c>GetHashCode</c>, which changes every process) of a user and some words.</summary>
    public static ulong Hash(Guid userId, string words)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{userId:N}:{words}"));
        return BitConverter.ToUInt64(bytes, 0);
    }

    /// <summary>One syllable with its octave marks, as semitones from the unmarked doh.</summary>
    private static int Offset(string token)
    {
        var up = token.Count(c => c == '\'');
        var down = token.Count(c => c == ',');
        var text = token.TrimEnd('\'', ',');
        for (var semitone = 0; semitone < 12; semitone++)
        {
            if (SolfaMapper.Syllable(semitone, ChromaticSpelling.Ascending) == text
                || SolfaMapper.Syllable(semitone, ChromaticSpelling.Descending) == text)
                return semitone + 12 * (up - down);
        }
        throw new InvalidOperationException($"'{token}' is not a solfa syllable.");
    }
}
