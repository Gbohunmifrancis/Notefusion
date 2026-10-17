using NoteFusion.Application.Practice;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The daily drill catalogue: every pattern, in every key it may be placed in, is labelled by the solfa engine exactly
/// as it is written, sits in a comfortable range, and today's drill is the same all day.
/// </summary>
public class DrillCatalogueTests
{
    public static TheoryData<string, int> EveryPlacement()
    {
        var data = new TheoryData<string, int>();
        foreach (var pattern in DrillCatalogue.Patterns)
            foreach (var doh in DrillCatalogue.Placements(pattern))
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
    }

    [Fact]
    public void Every_level_has_drills_and_every_drill_has_a_key()
    {
        Assert.Equal(PracticeRules.Levels.Count - 1, DrillCatalogue.LadderTopTier);
        foreach (var level in PracticeRules.Levels)
            Assert.NotEmpty(DrillCatalogue.Patterns.Where(p => p.Tier == level.Index));
        Assert.All(DrillCatalogue.Patterns, p => Assert.NotEmpty(DrillCatalogue.Placements(p)));
        Assert.Equal(DrillCatalogue.Patterns.Count, DrillCatalogue.Patterns.Select(p => p.Code).Distinct().Count());
    }

    [Fact]
    public void The_ladder_goes_steps_triad_scales_then_minor_and_chromatics()
    {
        Assert.Contains(DrillCatalogue.Patterns, p => p.Tier == 0 && p.Solfa == "d r m");
        Assert.Contains(DrillCatalogue.Patterns, p => p.Tier == 1 && p.Solfa == "d m s");
        Assert.Contains(DrillCatalogue.Patterns, p => p.Tier == 2 && p.Solfa == "d r m f s l t d'");
        Assert.All(DrillCatalogue.Patterns.Where(p => p.Tier == 5), p => Assert.Equal(KeyMode.Minor, p.Mode));
        Assert.All(DrillCatalogue.Patterns.Where(p => p.Tier < 5), p => Assert.Equal(KeyMode.Major, p.Mode));

        var chromatic = DrillCatalogue.Patterns.Where(p => p.Tier == 6).SelectMany(p => p.Tokens).ToHashSet();
        Assert.Contains("de", chromatic);
        Assert.Contains("fe", chromatic);
        Assert.Contains("ta", chromatic);
        Assert.DoesNotContain(DrillCatalogue.Patterns.Where(p => p.Tier < 5).SelectMany(p => p.Tokens),
            t => t.TrimEnd('\'', ',') is "de" or "fe" or "ta" or "se");
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
        => Assert.Equal("Eb major", DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "steps-up"), 63).KeyName);

    [Fact]
    public void Todays_drill_is_the_same_all_day_and_changes_with_the_day()
    {
        var user = Guid.Parse("8f1c2a8e-5b8a-4a51-9f60-1d2b3c4d5e6f");
        var day = new DateOnly(2026, 10, 17);

        Assert.Equal(DrillCatalogue.ForDay(user, day, 0).Id, DrillCatalogue.ForDay(user, day, 0).Id);

        var week = Enumerable.Range(0, 14).Select(i => DrillCatalogue.ForDay(user, day.AddDays(i), 0).Id).Distinct().Count();
        Assert.True(week > 3, $"only {week} different drills in a fortnight");
    }

    [Fact]
    public void Todays_drill_is_from_the_singers_level_and_the_top_tier_beyond_it()
    {
        var user = Guid.NewGuid();
        var day = new DateOnly(2026, 10, 17);

        for (var level = 0; level <= DrillCatalogue.LadderTopTier; level++)
            Assert.Equal(level, DrillCatalogue.ForDay(user, day, level).Pattern.Tier);
        Assert.Equal(DrillCatalogue.LadderTopTier, DrillCatalogue.ForDay(user, day, 99).Pattern.Tier);
    }

    [Fact]
    public void A_drill_is_found_again_by_its_id_and_nothing_else_is()
    {
        var drill = DrillCatalogue.ForDay(Guid.NewGuid(), new DateOnly(2026, 10, 17), 3);

        var again = DrillCatalogue.Find(drill.Id);

        Assert.NotNull(again);
        Assert.Equal(drill.Notes, again.Notes);
        Assert.Null(DrillCatalogue.Find(null));
        Assert.Null(DrillCatalogue.Find("steps-up"));
        Assert.Null(DrillCatalogue.Find("no-such-drill@60"));
        Assert.Null(DrillCatalogue.Find("steps-up@61")); // C# is not a key drills are placed in
        Assert.Null(DrillCatalogue.Find("scale-up@72")); // the top doh would be out of range
        Assert.Null(DrillCatalogue.Find("steps-up@x"));
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
        Assert.Equal(8 * 60.0 / 72, target.LeadInSec, 6);
        Assert.Equal(4 * 60.0 / 72, drill.PassageSeconds, 6);
        Assert.Equal(Math.Round(12 * 60.0 / 72 + PracticeRules.DrillTakeTailSeconds, 2), drill.MaxTakeSeconds);
    }
}
