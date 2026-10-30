using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Commands;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// Practice placed in the singer's range: once both ends are measured (and their switch is on), the path's drills and the
/// modes' exercises come in the keys (of those they may be placed in) whose notes, moved by whole octaves, sit best in the
/// range; the key never moves the path; and the range card's two switches are kept and read back.
/// </summary>
public class VoiceFitTests
{
    private static readonly Guid UserId = Guid.Parse("3b7e0c55-1d0a-4f8e-9a51-6c2d8e4f1a20");
    private static readonly DateOnly Day = new(2026, 10, 17);
    private static readonly DateTime Now = new(2026, 10, 17, 18, 0, 0, DateTimeKind.Utc);

    // An octave, G3 to G4: narrow enough that most keys do not sit in it.
    private const int Low = 55;
    private const int High = 67;

    [Fact]
    public void A_fit_needs_both_ends_measured_and_the_switch_on()
    {
        Assert.Equal(new VoiceFit(Low, High), VoiceFit.For(Low, High, true));
        Assert.Null(VoiceFit.For(Low, High, false));
        Assert.Null(VoiceFit.For(Low, null, true));
        Assert.Null(VoiceFit.For(null, High, true));
        Assert.Null(VoiceFit.For(High, Low, true));
    }

    [Fact]
    public void Keys_whose_notes_an_octave_away_sit_in_the_range_are_kept_else_the_nearest_misses()
    {
        var fit = new VoiceFit(57, 67);
        // d m s d' from each doh 53..65: only Ab (56, 56..68 with a semitone's grace) sits in A3–G4.
        Assert.Equal([56], fit.Choose(Enumerable.Range(53, 13).ToList(), [0, 4, 7, 12]));
        // A man's Bb3–Bb4 holds d–s from C4 sung an octave down (48..55 is out; 60..67 is in).
        Assert.Contains(60, new VoiceFit(58, 70).Choose([60, 61, 62], [0, 2, 4, 5, 7]));

        // Two octaves will not go into a fifth: the keys that miss it least, never none.
        var narrow = new VoiceFit(60, 67);
        var kept = narrow.Choose(Enumerable.Range(53, 13).ToList(), [0, 24]);
        Assert.NotEmpty(kept);
        Assert.All(kept, doh => Assert.Equal(Miss(narrow, 0, 24, doh), kept.Min(d => Miss(narrow, 0, 24, d))));
    }

    [Fact]
    public void A_take_counts_for_the_drill_offered_whatever_key_it_was_sung_in()
    {
        Assert.True(PracticePath.SameDrill("g1u1-a@60~gentle", "g1u1-a@65~gentle"));
        Assert.True(PracticePath.SameDrill("g1u1-a@60", "g1u1-a@67"));
        Assert.False(PracticePath.SameDrill("g1u1-a@60", "g1u1-a@60~gentle"));
        Assert.False(PracticePath.SameDrill("g1u1-b@60", "g1u1-a@60"));
        Assert.False(PracticePath.SameDrill(null, "g1u1-a@60"));
    }

    [Fact]
    public void The_path_offers_keys_in_the_range_and_moves_on_takes_sung_in_any_key()
    {
        var fit = new VoiceFit(Low, High);
        var takes = new List<PathTake>();
        var moved = 0;
        for (var i = 0; i < 40; i++)
        {
            var reading = PracticePath.Read(UserId, takes, _ => 0);
            var stop = PracticePath.Next(UserId, PracticeTrack.Focused, reading, 0, fit);
            var plain = PracticePath.Next(UserId, PracticeTrack.Focused, reading, 0);
            Assert.Equal(plain.Place, stop.Place);
            Assert.Equal(plain.Drill.Pattern, stop.Drill.Pattern);
            var (missed, plainMissed) = (Miss(fit, stop.Drill.Notes), Miss(fit, plain.Drill.Notes));
            Assert.True(missed <= plainMissed, $"{stop.Drill.Id} sits worse than {plain.Drill.Id}");
            Assert.Equal(0, DrillCatalogue.Placements(stop.Drill.Pattern).Min(doh => Miss(fit, stop.Drill.Notes, doh - stop.Drill.DohMidi)) - missed);
            if (missed < plainMissed)
                moved++;

            // Sung in the key offered without the range: it still counts for this drill.
            var at = Now.AddMinutes(i);
            takes.Add(new PathTake(Guid.NewGuid(), plain.Drill.Id, PracticeRules.PassScore, at, Day));
            Assert.NotEqual(stop.Place, PracticePath.Next(UserId, PracticeTrack.Focused, PracticePath.Read(UserId, takes, _ => 0), 0, fit).Place);
        }
        Assert.True(moved > 0, "the range never moved a key, so this proves nothing");
    }

    [Fact]
    public async Task The_next_drill_and_every_mode_follow_the_range_until_the_switch_is_off()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        user.ChoosePracticeTrack(PracticeTrack.Focused);
        user.MeasureVoiceRange(true, Low);
        user.MeasureVoiceRange(false, High);
        h.Db.SaveChanges();
        var fit = new VoiceFit(Low, High);

        var next = await NextDrill(h, user);
        var offered = PracticePath.Next(user.Id, PracticeTrack.Focused, PracticePath.Read(user.Id, [], _ => 0), 0, fit).Drill;
        Assert.Equal(offered.Id, next.Id);
        var moved = 0;
        foreach (var mode in new[] { PracticeModes.Scales, PracticeModes.PitchMatch, PracticeModes.Intervals, PracticeModes.Runs })
        {
            var exercises = (await ModeQuery(h, user).Handle(new GetPracticeModeQuery(mode), default)).Value.Exercises;
            var listed = ModeCatalogue.ForTrack(mode, PracticeTrack.Focused, user.Id, Day, fit);
            var anyKey = ModeCatalogue.ForTrack(mode, PracticeTrack.Focused, user.Id, Day);
            Assert.Equal(listed.Select(e => e.Id), exercises.Select(e => e.Id));
            foreach (var (placed, plain) in listed.Zip(anyKey))
            {
                Assert.Equal(plain.Code, placed.Code);
                Assert.True(Miss(fit, placed.Notes) <= Miss(fit, plain.Notes), $"{placed.Id} sits worse than {plain.Id}");
                moved += Miss(fit, placed.Notes) < Miss(fit, plain.Notes) ? 1 : 0;
            }
        }
        Assert.True(moved > 0, "the range never moved an exercise, so this proves nothing");
        // A scale's exercise placed in range is still one the grader takes.
        var scale = ModeCatalogue.ForTrack(PracticeModes.Scales, PracticeTrack.Focused, user.Id, Day, fit)[0];
        Assert.NotNull(ModeCatalogue.Find(scale.Id));

        var off = await new SetVoiceRangeSettingsCommandHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(new SetVoiceRangeSettingsCommand(false, true), default);
        Assert.Equal((false, true), (off.Value.PracticeInRange, off.Value.LearnPartFromRange));
        Assert.Equal("tenor", off.Value.VoicePart);
        var anyKeyScales = ModeCatalogue.ForTrack(PracticeModes.Scales, PracticeTrack.Focused, user.Id, Day);
        var exercisesOff = (await ModeQuery(h, user).Handle(new GetPracticeModeQuery(PracticeModes.Scales), default)).Value.Exercises;
        Assert.Equal(anyKeyScales.Select(e => e.Id), exercisesOff.Select(e => e.Id));

        // Null leaves a switch as it is; the range reads both back.
        await new SetVoiceRangeSettingsCommandHandler(h.Db, new StubCurrentUser(user.Id)).Handle(new SetVoiceRangeSettingsCommand(true, null), default);
        var read = (await new GetVoiceRangeQueryHandler(h.Db, new StubCurrentUser(user.Id)).Handle(new GetVoiceRangeQuery(), default)).Value;
        Assert.Equal((true, true), (read.PracticeInRange, read.LearnPartFromRange));
    }

    [Fact]
    public void A_new_account_practises_in_its_range_and_learns_parts_as_it_chooses()
    {
        var user = User.Create("Chorister", "new@example.com", "hash", Now);
        Assert.True(user.PracticeInRange);
        Assert.False(user.LearnPartFromRange);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// <summary>How far notes (moved by <paramref name="by"/>) stick out of the range, at their best octave.</summary>
    private static int Miss(VoiceFit fit, IReadOnlyList<NoteEventDto> notes, int by = 0)
        => Miss(fit, notes.Min(n => n.PitchMidi) + by, notes.Max(n => n.PitchMidi) + by, 0);

    private static int Miss(VoiceFit fit, int lowest, int highest, int doh)
        => new[] { -24, -12, 0, 12 }.Min(shift =>
            Math.Max(0, fit.Low - VoiceFit.Grace - (doh + shift + lowest)) + Math.Max(0, doh + shift + highest - (fit.High + VoiceFit.Grace)));

    private static async Task<Application.Practice.Dtos.DrillDto> NextDrill(TestHarness h, User user)
        => (await new GetNextDrillQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetNextDrillQuery(), default)).Value;

    private static GetPracticeModeQueryHandler ModeQuery(TestHarness h, User user)
        => new(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), new PracticeModeSettings());

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Chorister", "range@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }
}
