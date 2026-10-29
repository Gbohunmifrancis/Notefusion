using System.Text.Json;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Commands;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Games;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The arcade: the quick games dealt by level, stage after stage with no top. Each level is a short stage rebuilt from
/// its id, harder than the one before on its own axis (more notes to hear, more keys and less time to read, more names
/// and less tune to pick from); a stage passed deals the next level and a poor one the one below, never under the
/// track's first; and the one-off games the phone plays are dealt exactly as before.
/// </summary>
public class PracticeArcadeTests
{
    private static readonly DateTime Now = new(2026, 10, 17, 18, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData(PracticeGames.WhichNote)]
    [InlineData(PracticeGames.Staff)]
    [InlineData(PracticeGames.Hymn)]
    public void A_stage_is_rebuilt_exactly_from_its_id_and_a_one_off_deal_is_unchanged(string game)
    {
        var id = PracticeGames.NewDealId(game, PracticeTrack.Focused, 0x1234abcd, 7);
        Assert.Equal($"{game}:f:1234abcd:L7", id);
        var stage = PracticeGames.Deal(id)!;
        Assert.Equal(7, stage.Level);
        Assert.False(stage.IsRace);
        Assert.Equal(PracticeGames.StageRounds(game), stage.Rounds.Count);
        Assert.Equal(JsonSerializer.Serialize(stage.Rounds), JsonSerializer.Serialize(PracticeGames.Deal(id)!.Rounds));

        var oneOff = PracticeGames.Deal(PracticeGames.NewDealId(game, PracticeTrack.Focused, 0x1234abcd))!;
        Assert.Null(oneOff.Level);
        Assert.Equal(game == PracticeGames.Staff, oneOff.IsRace);
        Assert.All(oneOff.Rounds, r => Assert.Null(r.NoteSeconds));
    }

    [Theory]
    [InlineData("which-note:f:1234abcd:L0")]
    [InlineData("which-note:f:1234abcd:L1000")]
    [InlineData("which-note:f:1234abcd:L007")]
    [InlineData("which-note:f:1234abcd:Lx")]
    [InlineData("which-note:f:1234abcd:7")]
    [InlineData("which-note:f:1234abcd:L7:L8")]
    public void A_level_the_server_never_deals_rebuilds_nothing(string id) => Assert.Null(PracticeGames.Deal(id));

    [Fact]
    public void Which_note_brings_more_notes_each_level_then_plays_them_ever_shorter()
    {
        var semitones = new Dictionary<string, int>
        {
            ["s,"] = -5, ["l,"] = -3, ["t,"] = -1, ["d"] = 0, ["de"] = 1, ["r"] = 2, ["ma"] = 3, ["m"] = 4, ["f"] = 5, ["fe"] = 6,
            ["s"] = 7, ["se"] = 8, ["l"] = 9, ["ta"] = 10, ["t"] = 11, ["d'"] = 12, ["r'"] = 14, ["m'"] = 16
        };
        var before = new HashSet<string>();
        for (var level = 1; level <= 14; level++)
        {
            var asked = new HashSet<string>();
            for (uint seed = 0; seed < 40; seed++)
            {
                foreach (var r in PracticeGames.Deal(PracticeGames.NewDealId(PracticeGames.WhichNote, PracticeTrack.Focused, seed, level))!.Rounds)
                {
                    Assert.Contains(r.Answer, r.Choices);
                    Assert.Contains("d", r.Choices);
                    Assert.NotEqual("d", r.Answer);
                    Assert.Equal(r.DohMidi + semitones[r.Answer], r.NoteMidi);
                    Assert.Equal(PracticeGames.EarNoteSeconds(level), r.NoteSeconds);
                    asked.Add(r.Answer);
                }
            }
            // Every level asks everything the one before did, and up to the full set something new.
            Assert.Superset(before, asked);
            if (level <= PracticeGames.WhichNoteFullLevel)
                Assert.True(asked.Count > before.Count, $"level {level} adds no note");
            before = asked;
        }
        Assert.Equal(new[] { "m", "s", "d'" }.ToHashSet(), PracticeGames.Deal("which-note:p:00000001:L1")!.Rounds.Select(r => r.Answer).ToHashSet());
        Assert.Equal(17, before.Count);

        // A second each up to the full set, then 10% shorter a level, never under 0.35 s.
        Assert.Equal(1.0, PracticeGames.EarNoteSeconds(PracticeGames.WhichNoteFullLevel));
        Assert.True(PracticeGames.EarNoteSeconds(12) < PracticeGames.EarNoteSeconds(11));
        Assert.Equal(0.35, PracticeGames.EarNoteSeconds(200));
    }

    [Fact]
    public void Staff_to_solfa_brings_more_keys_and_ledger_lines_and_gives_less_time_each_level()
    {
        var fifths = new Dictionary<string, int>
        {
            ["C"] = 0, ["G"] = 1, ["F"] = -1, ["D"] = 2, ["Bb"] = -2, ["A"] = 3, ["Eb"] = -3, ["E"] = 4, ["Ab"] = -4, ["B"] = 5,
            ["Db"] = -5, ["F#"] = 6, ["Gb"] = -6
        };
        var tonic = new Dictionary<string, int>
        {
            ["C"] = 0, ["G"] = 7, ["F"] = 5, ["D"] = 2, ["Bb"] = 10, ["A"] = 9, ["Eb"] = 3, ["E"] = 4, ["Ab"] = 8, ["B"] = 11,
            ["Db"] = 1, ["F#"] = 6, ["Gb"] = 6
        };
        int[] major = [0, 2, 4, 5, 7, 9, 11];
        string[] syllables = ["d", "r", "m", "f", "s", "l", "t"];
        var keysBefore = 0;
        for (var level = 1; level <= 8; level++)
        {
            var keys = new HashSet<string>();
            for (uint seed = 0; seed < 60; seed++)
            {
                var stage = PracticeGames.Deal(PracticeGames.NewDealId(PracticeGames.Staff, PracticeTrack.Focused, seed, level))!;
                Assert.Equal(PracticeGames.StaffSecondsPerNote(level), stage.SecondsPerRound);
                Assert.Single(stage.Rounds.Select(r => r.Doh).Distinct()); // one key a stage
                foreach (var r in stage.Rounds)
                {
                    keys.Add(r.Doh!);
                    Assert.Equal(fifths[r.Doh!], r.Fifths);
                    var name = r.NoteName!;
                    var letter = "CDEFGAB".IndexOf(name[0]);
                    var accidental = name.Length == 2 ? 0 : name[1] == '#' ? 1 : -1;
                    var octave = name[^1] - '0';
                    Assert.Equal(12 * (octave + 1) + major[letter] + accidental, r.NoteMidi);
                    var (_, lowest, highest) = PracticeGames.StaffLevel(level);
                    Assert.InRange(octave * 7 + letter, lowest, highest);
                    Assert.Equal(syllables[Array.IndexOf(major, ((r.NoteMidi!.Value - tonic[r.Doh!]) % 12 + 12) % 12)], r.Answer);
                }
            }
            Assert.True(keys.Count >= keysBefore);
            keysBefore = keys.Count;
        }
        Assert.Equal(13, keysBefore);
        Assert.Equal(6.0, PracticeGames.StaffSecondsPerNote(1));
        Assert.True(PracticeGames.StaffSecondsPerNote(5) < PracticeGames.StaffSecondsPerNote(4));
        Assert.Equal(1.5, PracticeGames.StaffSecondsPerNote(500));
    }

    [Fact]
    public void Name_that_hymn_offers_more_names_and_plays_less_of_the_opening_each_level()
    {
        var choicesBefore = 0;
        for (var level = 1; level <= 9; level++)
        {
            var (choices, notes) = PracticeGames.HymnLevel(level);
            Assert.True(choices >= choicesBefore);
            choicesBefore = choices;
            var stage = PracticeGames.Deal(PracticeGames.NewDealId(PracticeGames.Hymn, PracticeTrack.Playful, (uint)level, level))!;
            Assert.Equal(stage.Rounds.Count, stage.Rounds.Select(r => r.Answer).Distinct().Count());
            foreach (var r in stage.Rounds)
            {
                Assert.Equal(choices, r.Choices.Count);
                Assert.Contains(r.Answer, r.Choices);
                var opening = HymnOpenings.All.Single(h => h.Slug == r.Answer);
                Assert.Equal(Math.Min(notes ?? opening.Notes.Count, opening.Notes.Count), r.Notes!.Count);
            }
        }
        Assert.Equal((6, 4), PracticeGames.HymnLevel(40));
    }

    [Fact]
    public void A_stage_passed_deals_the_next_level_and_a_poor_one_the_level_below_never_under_the_tracks_first()
    {
        Assert.Equal(8, PracticeGames.NextLevel(7, 80, playful: false));
        Assert.Equal(7, PracticeGames.NextLevel(7, 79, playful: false));
        Assert.Equal(7, PracticeGames.NextLevel(7, 50, playful: false));
        Assert.Equal(6, PracticeGames.NextLevel(7, 49, playful: false));
        Assert.Equal(3, PracticeGames.NextLevel(3, 0, playful: false));
        Assert.Equal(2, PracticeGames.NextLevel(2, 0, playful: false)); // already under the first: held, not raised
        Assert.Equal(1, PracticeGames.NextLevel(1, 0, playful: true));
        Assert.Equal(PracticeGames.MaxLevel, PracticeGames.NextLevel(PracticeGames.MaxLevel, 100, playful: true));
        Assert.Equal((1, 3), (PracticeGames.StartLevel(PracticeTrack.Playful), PracticeGames.StartLevel(PracticeTrack.Focused)));
    }

    [Fact]
    public async Task A_stage_is_dealt_at_its_level_marked_over_every_round_and_says_the_level_to_deal_next()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Chorister", "arcade@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        var deal = new GetPracticeGameQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone());
        var grade = new GradePracticeGameCommandHandler(
            h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), h.QuotaGate, new PracticeRecorder(h.Db));

        var staff = (await deal.Handle(new GetPracticeGameQuery(PracticeGames.Staff, 4), default)).Value;
        Assert.Equal((4, (int?)null, PracticeGames.StaffSecondsPerNote(4)), (staff.Level, staff.TimeLimitSeconds, staff.SecondsPerRound!.Value));
        Assert.EndsWith(":L4", staff.DealId);

        // A note let run out is sent as "" and marked wrong; nine of ten right passes the stage.
        var answers = staff.Rounds.Select((r, i) => (string?)(i == 0 ? "" : r.Answer)).ToList();
        var marked = (await grade.Handle(new GradePracticeGameCommand(staff.DealId, answers, 40), default)).Value;
        Assert.Equal((90, 9, 10, true, 5), (marked.Score, marked.Right, marked.Answered, marked.Counted, marked.NextLevel));

        var hymn = (await deal.Handle(new GetPracticeGameQuery(PracticeGames.Hymn, 5), default)).Value;
        var poor = hymn.Rounds.Select((r, i) => (string?)(i < 2 ? r.Answer : "nope")).ToList();
        Assert.Equal(4, (await grade.Handle(new GradePracticeGameCommand(hymn.DealId, poor, 40), default)).Value.NextLevel);

        // The one-off games the phone plays say no level.
        var oneOff = (await deal.Handle(new GetPracticeGameQuery(PracticeGames.WhichNote), default)).Value;
        Assert.Null(oneOff.Level);
        var right = oneOff.Rounds.Select(r => (string?)r.Answer).ToList();
        Assert.Null((await grade.Handle(new GradePracticeGameCommand(oneOff.DealId, right, 40), default)).Value.NextLevel);

        // A level past the top is dealt at the top.
        Assert.Equal(PracticeGames.MaxLevel, (await deal.Handle(new GetPracticeGameQuery(PracticeGames.WhichNote, 5000), default)).Value.Level);
    }
}
