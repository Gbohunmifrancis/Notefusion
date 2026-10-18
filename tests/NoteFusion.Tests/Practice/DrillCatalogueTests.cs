using NoteFusion.Application.Practice;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The curriculum's drills: every pattern, in every key it may be placed in, is labelled by the solfa engine exactly as
/// it is written and sits in a comfortable range; every pattern keeps to its grade's syllabus (length, range, leaps,
/// keys, rhythm, chromatics, tempo); and the grades get harder on every axis.
/// </summary>
public class DrillCatalogueTests
{
    public static TheoryData<string, int> EveryPlacement()
    {
        var data = new TheoryData<string, int>();
        foreach (var pattern in DrillCatalogue.Patterns)
            foreach (var doh in DrillCatalogue.AnyPlacements(pattern))
                data.Add(pattern.Code, doh);
        return data;
    }

    [Theory]
    [MemberData(nameof(EveryPlacement))]
    public void Every_placed_drill_reads_as_written_and_its_pitches_are_its_labels(string code, int doh)
    {
        var pattern = DrillCatalogue.Patterns.Single(p => p.Code == code);
        var drill = DrillCatalogue.Build(pattern, doh);

        Assert.Equal(pattern.Tokens, drill.Notes.Select(n => n.Solfa + n.OctaveMark));
        Assert.InRange(drill.Notes.Count, DrillCatalogue.MinNotes, DrillCatalogue.MaxNotes);
        Assert.All(drill.Notes, n => Assert.InRange(n.PitchMidi, DrillCatalogue.LowestMidi, DrillCatalogue.HighestMidi));

        // Independently of the catalogue's own check: each pitch, mapped by the engine in the drill's key and register,
        // is the syllable printed for it.
        var pitches = drill.Notes.Select(n => n.PitchMidi).ToList();
        var reference = SolfaMapper.ReferenceDoh(pitches, drill.Key.DohPitchClass, drill.Key.Mode);
        var ascending = SolfaMapper.AscendingFlags(pitches, drill.Key.DohPitchClass);
        for (var i = 0; i < pitches.Count; i++)
        {
            var mapped = SolfaMapper.Map(pitches[i], drill.Key, reference, ascending[i] ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
            Assert.Equal(drill.Notes[i].Solfa, mapped.Text);
            Assert.Equal(drill.Notes[i].OctaveMark, mapped.OctaveMark);
        }

        Assert.Equal(doh % 12, drill.Key.DohPitchClass);
        Assert.True(KeyParser.Parse(drill.KeyName).IsSuccess, drill.KeyName);
        Assert.Equal(drill.Key.DohPitchClass, KeyParser.Parse(drill.KeyName).Value.DohPitchClass);
        var found = DrillCatalogue.Find(drill.Id);
        Assert.NotNull(found);
        Assert.Equal(drill.Notes, found.Notes);
        Assert.Equal(drill.TempoBpm, found.TempoBpm);
    }

    public static TheoryData<string> EveryPattern()
    {
        var data = new TheoryData<string>();
        foreach (var pattern in DrillCatalogue.Patterns)
            data.Add(pattern.Code);
        return data;
    }

    [Theory]
    [MemberData(nameof(EveryPattern))]
    public void Every_pattern_keeps_to_its_grades_syllabus(string code)
    {
        var pattern = DrillCatalogue.Patterns.Single(p => p.Code == code);
        var syllabus = DrillCatalogue.SyllabusOf(pattern);
        var offsets = DrillCatalogue.Offsets(pattern);

        Assert.InRange(pattern.Step, 1, DrillSyllabus.UnitsPerGrade);
        Assert.InRange(pattern.Tokens.Count, syllabus.MinNotes, syllabus.MaxNotes);
        Assert.True(offsets.Max() - offsets.Min() <= syllabus.MaxAmbitus, $"{code} spans {offsets.Max() - offsets.Min()} semitones");

        // Leaps: no wider than the grade's, except between notes of the doh chord and, from Grade 4, the octave.
        for (var i = 1; i < offsets.Count; i++)
        {
            var leap = Math.Abs(offsets[i] - offsets[i - 1]);
            var chord = IsDohChord(offsets[i]) && IsDohChord(offsets[i - 1]);
            Assert.True(
                leap <= syllabus.MaxLeap || (chord && leap <= syllabus.ChordLeap) || (syllabus.Octaves && leap == 12),
                $"{code}: a leap of {leap} between notes {i} and {i + 1} is past {syllabus.Label}'s");
        }

        // Keys: a minor drill only where the grade has minor keys; at least one of its grade's keys fits the range.
        if (pattern.Mode == KeyMode.Minor)
            Assert.NotEmpty(syllabus.MinorDohs);
        Assert.NotEmpty(DrillCatalogue.Placements(pattern));
        Assert.All(DrillCatalogue.Placements(pattern), doh =>
            Assert.Contains(doh % 12, pattern.Mode == KeyMode.Major ? syllabus.MajorDohs : syllabus.MinorDohs));

        // Chromatic notes only from Grade 7.
        if (!syllabus.Chromatic)
            Assert.False(DrillCatalogue.IsChromatic(pattern), $"{code} is chromatic in {syllabus.Label}");

        // Rhythm: within the grade's, from lengths a voice can be judged on.
        var rhythm = DrillCatalogue.RhythmOf(pattern);
        Assert.True((rhythm & ~syllabus.Rhythm) == 0, $"{code} uses {rhythm & ~syllabus.Rhythm}, not yet in {syllabus.Label}");
        var timing = DrillCatalogue.Timing(pattern);
        Assert.Equal(pattern.Tokens.Count, timing.Count);
        double[] lengths = [0.5, 1, 1.5, 2, 3, 4, 2.0 / 3];
        Assert.All(timing, t => Assert.Contains(lengths, l => Math.Abs(l - t.Beats) < 1e-6));
        var tempo = DrillCatalogue.TempoFor(pattern.Tier, pattern.Step);
        Assert.True(timing.Min(t => t.Beats) * 60.0 / tempo >= PracticeRules.ShortestNoteSeconds,
            $"{code}'s shortest note is under {PracticeRules.ShortestNoteSeconds}s at {tempo} BPM");

        // A triplet is three notes in two beats, starting on a beat, inside one bar.
        for (var i = 0; i < timing.Count; i++)
        {
            if (Math.Abs(timing[i].Beats - 2.0 / 3) > 1e-6)
                continue;
            Assert.True(i + 2 < timing.Count && Math.Abs(timing[i + 2].Beats - 2.0 / 3) < 1e-6, $"{code}: a broken triplet");
            Assert.Equal(Math.Round(timing[i].Start), timing[i].Start, 6);
            Assert.Equal(Math.Floor(timing[i].Start / 4), Math.Floor((timing[i].Start + 2 - 1e-6) / 4));
            i += 2;
        }
    }

    [Fact]
    public void Every_grade_has_five_units_with_patterns_to_vary_and_more_at_the_top()
    {
        Assert.Equal(PracticeRules.Levels.Count - 1, DrillCatalogue.LadderTopTier);
        Assert.Equal(DrillSyllabus.All.Count - 1, DrillCatalogue.TopTier);
        foreach (var syllabus in DrillSyllabus.All)
        {
            var grade = DrillCatalogue.Patterns.Where(p => p.Tier == syllabus.Tier).ToList();
            Assert.True(grade.Count >= 12, $"{syllabus.Label} has {grade.Count} patterns");
            Assert.Equal(DrillSyllabus.UnitsPerGrade, syllabus.Units.Count);
            for (var step = 1; step <= DrillSyllabus.UnitsPerGrade; step++)
                Assert.True(grade.Count(p => p.Step == step) >= 3, $"{syllabus.Label} unit {step}");
        }

        var ladderMost = Enumerable.Range(0, DrillCatalogue.LadderTopTier + 1).Max(t => DrillCatalogue.Patterns.Count(p => p.Tier == t));
        Assert.True(DrillCatalogue.Patterns.Count(p => p.Tier == DrillCatalogue.TopTier) > ladderMost);
        Assert.Equal(DrillCatalogue.Patterns.Count, DrillCatalogue.Patterns.Select(p => p.Code).Distinct().Count());
    }

    [Fact]
    public void The_grades_get_harder_on_every_axis()
    {
        var all = DrillSyllabus.All;
        for (var i = 1; i < all.Count; i++)
        {
            var (was, now) = (all[i - 1], all[i]);
            Assert.True(now.MaxNotes >= was.MaxNotes, now.Label);
            Assert.True(now.MaxAmbitus >= was.MaxAmbitus, now.Label);
            Assert.True(now.MaxLeap >= was.MaxLeap, now.Label);
            Assert.True(now.Octaves || !was.Octaves, now.Label);
            Assert.True(now.Chromatic || !was.Chromatic, now.Label);
            Assert.True(was.MajorDohs.All(now.MajorDohs.Contains), now.Label);
            Assert.True(was.MinorDohs.All(now.MinorDohs.Contains), now.Label);
            Assert.True((was.Rhythm & ~now.Rhythm) == 0, now.Label);
        }

        // Keys as ABRSM's sight-singing brings them in: C, F and G at Grade 1; four flats (Ab) only by Grade 6.
        Assert.Equal(new[] { 0, 5, 7 }, all[0].MajorDohs.Order());
        Assert.DoesNotContain(8, all[4].MajorDohs);
        Assert.Contains(8, all[5].MajorDohs);
        Assert.Empty(all[4].MinorDohs);
        Assert.NotEmpty(all[5].MinorDohs);

        // Within a grade, each unit is quicker than the one before, and its last unit has longer lines than its first.
        foreach (var syllabus in all)
        {
            Assert.True(DrillCatalogue.TempoFor(syllabus.Tier, 5) > DrillCatalogue.TempoFor(syllabus.Tier, 1));
            var first = DrillCatalogue.Patterns.Where(p => p.Tier == syllabus.Tier && p.Step == 1).Average(p => p.Tokens.Count);
            var last = DrillCatalogue.Patterns.Where(p => p.Tier == syllabus.Tier && p.Step == 5).Average(p => p.Tokens.Count);
            Assert.True(last > first, $"{syllabus.Label}: unit 5 averages {last} notes, unit 1 {first}");
        }
    }

    [Fact]
    public void The_curriculum_goes_steps_chord_scales_leaps_low_minor_chromatics()
    {
        Assert.Contains(DrillCatalogue.Patterns, p => p is { Tier: 0, Step: 1, Solfa: "d r m" });
        Assert.Contains(DrillCatalogue.Patterns, p => p is { Tier: 1, Step: 1, Solfa: "d m s" });
        Assert.Contains(DrillCatalogue.Patterns, p => p is { Tier: 2, Solfa: "d r m f s l t d'" });
        Assert.All(DrillCatalogue.Patterns.Where(p => p.Tier < 5), p => Assert.Equal(KeyMode.Major, p.Mode));
        Assert.All(DrillCatalogue.Patterns.Where(p => p.Tier == 5 && p.Step > 1), p => Assert.Equal(KeyMode.Minor, p.Mode));

        var chromatic = DrillCatalogue.Patterns.Where(p => p.Tier == 6).SelectMany(p => p.Tokens).ToHashSet();
        Assert.Contains("de", chromatic);
        Assert.Contains("fe", chromatic);
        Assert.Contains("ta", chromatic);
        Assert.DoesNotContain(DrillCatalogue.Patterns.Where(p => p.Tier < 5).SelectMany(p => p.Tokens),
            t => t.TrimEnd('\'', ',') is "de" or "fe" or "ta" or "se");

        // The rhythms arrive in order: quavers at Grade 2, dotted at 4, ties at 5, syncopation at 6, triplets at 8.
        DrillRhythm[] firsts = [DrillRhythm.Quavers, DrillRhythm.Dotted, DrillRhythm.Ties, DrillRhythm.Syncopation, DrillRhythm.Triplets];
        int[] grades = [1, 3, 4, 5, 7];
        for (var i = 0; i < firsts.Length; i++)
            Assert.Equal(grades[i], DrillCatalogue.Patterns.Where(p => DrillCatalogue.RhythmOf(p).HasFlag(firsts[i])).Min(p => p.Tier));
    }

    [Fact]
    public void A_minor_drill_is_la_based()
    {
        var drill = DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "minor-up"), 60);

        Assert.Equal(KeyMode.Minor, drill.Key.Mode);
        Assert.Equal("A minor", drill.KeyName);
        Assert.Equal("Doh is C", drill.Key.DohHeader());
        Assert.Equal(57, drill.Notes[0].PitchMidi); // l, = A3
    }

    [Fact]
    public void A_flat_key_is_named_as_its_signature_spells_it()
    {
        Assert.Equal("Eb major", DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "steps-up"), 63).KeyName);
        Assert.Equal("Ab major", DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "chromatic-de"), 68).KeyName);
    }

    [Fact]
    public void A_drill_is_found_again_by_its_id_and_nothing_else_is()
    {
        var pattern = DrillCatalogue.Patterns.Single(p => p.Code == "leap-fourth");
        var drill = DrillCatalogue.Build(pattern, DrillCatalogue.Placements(pattern)[0]);

        var again = DrillCatalogue.Find(drill.Id);

        Assert.NotNull(again);
        Assert.Equal(drill.Notes, again.Notes);
        Assert.Null(DrillCatalogue.Find(null));
        Assert.Null(DrillCatalogue.Find("steps-up"));
        Assert.Null(DrillCatalogue.Find("no-such-drill@60"));
        Assert.Null(DrillCatalogue.Find("steps-up@61")); // C# is not a key drills are placed in
        Assert.Null(DrillCatalogue.Find("scale-up@72")); // the top doh would be out of range
        Assert.Null(DrillCatalogue.Find("steps-up@x"));
        Assert.Null(DrillCatalogue.Find("steps-up@+60"));

        // A key the grade no longer offers is still marked (a drill handed out before a change).
        Assert.DoesNotContain(62, DrillCatalogue.Placements(DrillCatalogue.Patterns.Single(p => p.Code == "steps-up")));
        Assert.NotNull(DrillCatalogue.Find("steps-up@62"));
    }

    [Fact]
    public void A_drills_take_is_its_count_in_its_passage_and_a_few_seconds()
    {
        var drill = DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "steps-up"), 60); // 72 BPM

        var target = drill.Target();

        Assert.Equal(new[] { 60, 62, 64 }, target.Notes.Select(n => n.PitchMidi));
        Assert.Equal(new[] { 0.0, 1.0, 2.0 }, target.Notes.Select(n => n.StartBeat));
        Assert.Equal(new[] { 1.0, 1.0, 2.0 }, target.Notes.Select(n => n.DurBeats));
        Assert.Equal(72, target.TempoBpm);
        Assert.Equal(8 * 60.0 / 72, target.LeadInSec, 6); // an older app's two bars, when the take names no count-in
        Assert.Equal(4 * 60.0 / 72, drill.PassageSeconds, 6);
        Assert.Equal(Math.Round(12 * 60.0 / 72 + PracticeRules.DrillTakeTailSeconds, 2), drill.MaxTakeSeconds);

        // A current app's count-in (five seconds at 72 BPM): beat one there, and the take kept that much shorter.
        Assert.Equal(5.0, drill.Target(5.0).LeadInSec);
        Assert.Equal(Math.Round(5.0 + 4 * 60.0 / 72 + PracticeRules.DrillTakeTailSeconds, 2), drill.MaxTakeSecondsAfter(5.0));
    }

    [Fact]
    public void A_rhythmic_drill_is_timed_by_its_rhythm_and_its_units_tempo()
    {
        var run = DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "scale-run-hold"), 60);
        Assert.Equal(new[] { 0, 0.5, 1, 1.5, 2, 2.5, 3, 4 }, run.Notes.Select(n => n.StartBeat));
        Assert.Equal(new[] { 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 3 }, run.Notes.Select(n => n.DurBeats));
        Assert.Equal(80 + 4 * PracticeRules.TempoPerStep, run.TempoBpm); // Grade 3, unit 5
        Assert.Equal(7 * 60.0 / run.TempoBpm, run.PassageSeconds, 6);

        var triplets = DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "choir-triplets-up"), 60);
        Assert.Equal(new[] { 0, 0.666667, 1.333333, 2, 3, 4, 5 }, triplets.Notes.Select(n => n.StartBeat));
        Assert.Equal(DrillRhythm.Triplets, DrillCatalogue.RhythmOf(triplets.Pattern));

        Assert.Equal(DrillRhythm.Syncopation | DrillRhythm.Quavers, DrillCatalogue.RhythmOf(DrillCatalogue.Patterns.Single(p => p.Code == "minor-se-sync")));
        Assert.Equal(DrillRhythm.Ties | DrillRhythm.Minims, DrillCatalogue.RhythmOf(DrillCatalogue.Patterns.Single(p => p.Code == "tie-low-soh")));
        Assert.Equal(DrillRhythm.Crotchets, DrillCatalogue.RhythmOf(DrillCatalogue.Patterns.Single(p => p.Code == "steps-fah"))); // the held last note is no minim
    }

    private static bool IsDohChord(int offset) => (((offset % 12) + 12) % 12) is 0 or 4 or 7;
}
