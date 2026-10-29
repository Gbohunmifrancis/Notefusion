using NoteFusion.Application.Practice;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// Mastery, the path past the last grade: every tier has drills on both tracks, each placed in every key it fits,
/// labelled by the solfa engine exactly as written and found again by its id; each tier's beat is quicker than the
/// last's, never past the top or so quick a note is too short to mark; Playful's tunes stay its own kind (major, plain
/// beats and held notes); and two phrases joined are one line, labelled afresh.
/// </summary>
public class MasteryCatalogueTests
{
    public static TheoryData<int> Tiers => new() { 1, 2, 3, 7, 15, 40, MasteryCatalogue.Tiers };

    [Theory]
    [MemberData(nameof(Tiers))]
    public void Every_mastery_drill_is_placed_labelled_and_found_again_in_every_key_it_fits(int n)
    {
        var tier = MasteryCatalogue.FirstTier + n - 1;
        foreach (var track in new[] { PracticeTrack.Focused, PracticeTrack.Playful })
        {
            for (var step = 1; step <= MasteryCatalogue.UnitsOn(track); step++)
            {
                var unit = DrillCatalogue.UnitPatterns(track, tier, step);
                Assert.True(unit.Count >= 3, $"Mastery {n} unit {step} on {track} has {unit.Count} drills");
                Assert.Equal(unit.Count, unit.Select(p => p.Code).Distinct().Count());
                foreach (var pattern in unit)
                {
                    Assert.Equal((tier, step), (pattern.Tier, pattern.Step));
                    Assert.True(DrillCatalogue.OnTrack(pattern, track));
                    Assert.False(DrillCatalogue.OnTrack(pattern, track == PracticeTrack.Playful ? PracticeTrack.Focused : PracticeTrack.Playful));
                    Assert.NotEmpty(DrillCatalogue.Placements(pattern));
                    var gentle = track == PracticeTrack.Playful;
                    foreach (var doh in DrillCatalogue.AnyPlacements(pattern))
                    {
                        var drill = DrillCatalogue.Build(pattern, doh, gentle);
                        Assert.Equal(pattern.Tokens, drill.Notes.Select(x => x.Solfa + x.OctaveMark));
                        Assert.All(drill.Notes, x => Assert.InRange(x.PitchMidi, DrillCatalogue.LowestMidi, DrillCatalogue.HighestMidi));
                        // Never so quick that a note is shorter than the grader can mark.
                        Assert.True(pattern.Beats.Min() * 60.0 / drill.TempoBpm >= PracticeRules.ShortestNoteSeconds - 1e-9, $"{drill.Id} at {drill.TempoBpm}");
                        var again = DrillCatalogue.Find(drill.Id)!;
                        Assert.Equal(drill.TempoBpm, again.TempoBpm);
                        Assert.Equal(drill.Notes.Select(x => x.PitchMidi), again.Notes.Select(x => x.PitchMidi));
                    }
                    if (track == PracticeTrack.Playful)
                    {
                        Assert.Equal(KeyMode.Major, pattern.Mode);
                        Assert.Equal(DrillRhythm.Crotchets, DrillCatalogue.RhythmOf(pattern) & ~DrillRhythm.Minims);
                    }
                }
            }
        }
    }

    [Fact]
    public void Each_tier_is_quicker_than_the_last_up_to_the_top_and_joins_two_phrases_into_one_line()
    {
        var before = 0;
        for (var n = 1; n <= MasteryCatalogue.Tiers; n++)
        {
            var tempo = DrillCatalogue.TempoFor(MasteryCatalogue.FirstTier + n - 1, 1);
            Assert.True(tempo >= before && tempo <= MasteryCatalogue.MaxTempo);
            if (before < MasteryCatalogue.MaxTempo)
                Assert.True(tempo > before);
            before = tempo;
        }
        Assert.Equal(MasteryCatalogue.MaxTempo, before);
        Assert.True(DrillCatalogue.TempoFor(MasteryCatalogue.FirstTier, 1) > DrillCatalogue.TempoFor(DrillCatalogue.TopTier, 5) - 10);

        // Focused's fifth unit and Playful's first are joined lines, longer than either half, and change tier to tier.
        var tier1 = MasteryCatalogue.FirstTier;
        var long1 = DrillCatalogue.UnitPatterns(PracticeTrack.Focused, tier1, 5);
        Assert.All(long1, p => Assert.Contains("+", p.Code));
        Assert.All(long1, p => Assert.True(p.Tokens.Count > 10));
        var long2 = DrillCatalogue.UnitPatterns(PracticeTrack.Focused, tier1 + 1, 5);
        Assert.NotEqual(long1.Select(p => p.Code[p.Code.IndexOf('-')..]), long2.Select(p => p.Code[p.Code.IndexOf('-')..]));
        Assert.All(DrillCatalogue.UnitPatterns(PracticeTrack.Playful, tier1, 1), p => Assert.True(p.Tokens.Count > PracticeRules.PlayfulMaxNotes));

        // Its grade and units say what they are.
        Assert.Equal("Mastery 3", DrillSyllabus.For(MasteryCatalogue.FirstTier + 2).Label);
        Assert.Equal("Two phrases as one", MasteryCatalogue.UnitOf(PracticeTrack.Focused, 5).Title);
        Assert.Equal("Quicker tunes", MasteryCatalogue.UnitOf(PracticeTrack.Playful, 2).Title);
    }

    [Theory]
    [InlineData("mf0u1-sight-hymn-line@60")]
    [InlineData("mf201u1-sight-hymn-line@60")]
    [InlineData("mf1u6-sight-hymn-line@60")]
    [InlineData("mf1u1-not-a-pattern@60")]
    [InlineData("mx1u1-sight-hymn-line@60")]
    public void A_mastery_id_that_names_no_drill_finds_nothing(string id) => Assert.Null(DrillCatalogue.Find(id));

    [Fact]
    public void No_track_chosen_has_no_mastery_and_the_ladder_ends_where_it_did()
    {
        Assert.Empty(DrillCatalogue.UnitPatterns(null, MasteryCatalogue.FirstTier, 1));
        Assert.Equal(DrillCatalogue.LadderTopTier, PracticePath.UnitsFor(null)[^1].Tier);
    }
}
