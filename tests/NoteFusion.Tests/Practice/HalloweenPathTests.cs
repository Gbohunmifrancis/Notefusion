using System.Text.Json;
using NoteFusion.Application.Flags;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Flags;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The Halloween season's Midnight path, as the carols path at Christmas: six drills built from the published tunes'
/// real notes (checked against the hymn pack), labelled by the solfa engine, served only while Halloween is on, never
/// moving the main path, and the Night Singer badge for all six, earned only in season and kept for good.
/// </summary>
public class HalloweenPathTests
{
    private static readonly DateTime Now = new(2026, 10, 25, 18, 0, 0, DateTimeKind.Utc); // 19:00 in Lagos

    public static TheoryData<string, bool> EveryMidnightDrill()
    {
        var data = new TheoryData<string, bool>();
        foreach (var d in HalloweenPath.Drills)
        {
            data.Add(d.Code, false);
            data.Add(d.Code, true);
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(EveryMidnightDrill))]
    public void Every_midnight_drill_reads_as_written_in_range_and_markable_and_is_found_by_its_id(string code, bool gentle)
    {
        var definition = HalloweenPath.Drills.Single(d => d.Code == code);
        var drill = HalloweenPath.Path.For(definition, gentle ? PracticeTrack.Playful : PracticeTrack.Focused).Drill;

        Assert.All(drill.Notes, n => Assert.InRange(n.PitchMidi, DrillCatalogue.LowestMidi, DrillCatalogue.HighestMidi));
        Assert.All(drill.Notes, n => Assert.True(n.DurBeats * 60.0 / drill.TempoBpm >= PracticeRules.ShortestNoteSeconds - 1e-9,
            $"{drill.Id}: a {n.DurBeats}-beat note at {drill.TempoBpm} BPM is too short to mark"));
        Assert.True(drill.Notes[^1].DurBeats >= SeasonPath.HeldLastBeats);
        Assert.Equal(string.Join(' ', drill.Notes.Select(n => n.Solfa + n.OctaveMark)), definition.Solfa);
        var reference = SolfaMapper.ReferenceDoh(drill.Notes.Select(n => n.PitchMidi).ToList(), drill.Key.DohPitchClass, drill.Key.Mode);
        Assert.Equal(definition.DohMidi, reference); // the unmarked octave starts at the drill's own doh

        Assert.Equal(gentle, drill.Id.EndsWith(DrillCatalogue.GentleSuffix, StringComparison.Ordinal));
        var found = DrillCatalogue.Find(drill.Id);
        Assert.NotNull(found);
        Assert.Equal(drill.Notes, found.Notes);
        Assert.True(drill.Id.Length <= PracticeSession.DrillIdMaxLength);
    }

    [Fact]
    public void Every_drill_is_a_run_of_its_tune_as_the_page_publishes_it()
    {
        Assert.Equal(
            ["Mountain King run", "Toccata turn", "The climb", "Skeleton waltz", "Marionette march", "All Saints line"],
            HalloweenPath.Drills.Select(d => d.Title));
        Assert.All(HalloweenPath.Drills, d => Assert.StartsWith(HalloweenPath.CodePrefix, d.Code));

        using var pack = JsonDocument.Parse(File.ReadAllText(Path.Combine(CarolPathTests.RepoRoot(), "web-site", "hymns", "pack.json")));
        var tunes = pack.RootElement.GetProperty("hymns").EnumerateArray().ToDictionary(e => e.GetProperty("slug").GetString()!);
        foreach (var definition in HalloweenPath.Drills)
        {
            Assert.True(tunes.ContainsKey(definition.HymnSlug), $"{definition.HymnSlug} is not published");
            var tune = tunes[definition.HymnSlug];
            Assert.Contains("Halloween", tune.GetProperty("occasions").EnumerateArray().Select(o => o.GetString()));
            Assert.Equal(definition.TimeSignature, tune.GetProperty("time").GetString());
            var melody = tune.GetProperty("notes").EnumerateArray()
                .Select(n => (Pitch: n[0].GetInt32(), Start: n[1].GetDouble(), Beats: n[2].GetDouble()))
                .ToList();
            var drill = SeasonPath.Build(definition).Drill;

            var line = drill.Notes.Select(n => n.PitchMidi).ToList();
            var at = Enumerable.Range(0, melody.Count - line.Count + 1).FirstOrDefault(
                i => Enumerable.Range(0, line.Count).All(k => melody[i + k].Pitch - line[k] == melody[i].Pitch - line[0]), -1);
            Assert.True(at >= 0, $"{definition.Code}: {string.Join(' ', line)} is not a run of {definition.Carol}'s tune");
            // Moved (if at all) with its doh, so every note is the same degree of the scale as on the page.
            var shift = melody[at].Pitch - line[0];
            Assert.Equal(0, (((definition.DohMidi + shift - CarolPathTests.KeyOf(tune)) % 12) + 12) % 12);
            // Its rhythm, but for the held last note, and where its first bar line falls.
            for (var k = 0; k < line.Count - 1; k++)
                Assert.Equal(melody[at + k].Beats, drill.Notes[k].DurBeats, 6);
            Assert.Equal(definition.PickupBeats, CarolPathTests.Pickup(melody, at, tune), 6);
        }
    }

    [Fact]
    public async Task Out_of_season_there_is_no_midnight_path_and_no_night_singer_badge()
    {
        using var h = new TestHarness(Now);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");

        var progress = await CarolPathTests.Progress(h, singer);
        Assert.Null(progress.Season);
        Assert.DoesNotContain(progress.Badges, b => b.Code == HalloweenPath.BadgeCode);

        var path = await Midnight(h, singer);
        Assert.Equal(("PRACTICE_SEASON_OFF", ErrorType.NotFound), (path.Error.Code, path.Error.Type));
        Assert.Equal("The Midnight path is back next Halloween. Your path is in Practice.", path.Error.Message);
    }

    [Fact]
    public async Task In_season_the_progress_carries_the_midnight_path_and_its_drills_are_ready_to_sing()
    {
        using var h = new TestHarness(Now);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");
        SetHalloween(h);

        var progress = await CarolPathTests.Progress(h, singer);
        var season = Assert.IsType<PracticeSeasonDto>(progress.Season);
        Assert.Equal(("halloween", "The Midnight path", new DateOnly(2026, 11, 1)), (season.Season, season.Title, season.Until!.Value));
        Assert.Equal((0, 6, "night_singer"), (season.Sung, season.Total, season.BadgeCode));
        Assert.Equal("Mountain King run", season.Next!.Title);
        var badge = Assert.Single(progress.Badges, b => b.Code == HalloweenPath.BadgeCode);
        Assert.Equal(("Night Singer", false, 6), (badge.Title, badge.Earned, badge.Target));
        Assert.DoesNotContain(progress.Badges, b => b.Code == CarolPath.BadgeCode);

        var path = (await Midnight(h, singer)).Value;
        Assert.Equal(6, path.Drills.Count);
        Assert.Equal(("Doh is D", "4/4"), (path.Drills[0].Drill.DohHeader, path.Drills[0].Drill.TimeSignature));
        Assert.Equal(2, path.Drills[4].PickupBeats);
        // Christmas's path is not served at Halloween.
        Assert.True((await new GetSeasonPathQueryHandler(h.Db, SeasonFlagTests.Caller(singer), h.Clock, new StubClientTimeZone())
            .Handle(new GetSeasonPathQuery(), default)).IsFailure);
    }

    [Fact]
    public async Task All_six_in_season_earn_the_night_singer_badge_and_it_is_kept_after_halloween()
    {
        using var h = new TestHarness(Now);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");
        SetHalloween(h);
        var steps = (await CarolPathTests.Progress(h, singer)).Season!.Steps;

        var before = await CarolPathTests.Progress(h, singer);
        for (var i = 0; i < 5; i++)
            Assert.DoesNotContain((await CarolPathTests.Sing(h, singer, steps[i].Id, 85)).Reward!.NewBadges, b => b.Code == HalloweenPath.BadgeCode);
        var sixth = await CarolPathTests.Sing(h, singer, steps[5].Id, 85);
        Assert.Equal(("Night Singer", true), (Assert.Single(sixth.Reward!.NewBadges, b => b.Code == HalloweenPath.BadgeCode).Title, true));
        Assert.Equal(before.Path, (await CarolPathTests.Progress(h, singer)).Path); // the main path has not moved

        h.Clock.UtcNow = new DateTime(2026, 11, 5, 12, 0, 0, DateTimeKind.Utc); // switched itself off after 1 November
        var november = await CarolPathTests.Progress(h, singer);
        Assert.Null(november.Season);
        Assert.True(Assert.Single(november.Badges, b => b.Code == HalloweenPath.BadgeCode).Earned);
    }

    private static Task<Result<CarolsPathDto>> Midnight(TestHarness h, User user)
        => new GetSeasonPathQueryHandler(h.Db, SeasonFlagTests.Caller(user), h.Clock, new StubClientTimeZone())
            .Handle(new GetSeasonPathQuery(FeatureFlag.Halloween), default);

    private static void SetHalloween(TestHarness h)
    {
        var flag = FeatureFlag.Create(FeatureFlag.Halloween, null, h.Clock.UtcNow);
        flag.Set(true, false, FeatureFlags.SwitchOffAtUtc(new DateOnly(2026, 11, 1)), Guid.NewGuid(), "owner@example.com", h.Clock.UtcNow);
        h.Db.FeatureFlags.Add(flag);
        h.Db.SaveChanges();
    }
}
