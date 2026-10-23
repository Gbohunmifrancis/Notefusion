using System.Text.Json;
using NoteFusion.Application.Common.Errors;
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
/// The quick games: every deal is rebuilt from its id exactly, each round's answer is what its notes say, the hymns'
/// openings are the hymn pages' own, and the answers are marked by the server and recorded as practice once, within the
/// day's games, for less XP than a sung drill and none of the day's marked drills.
/// </summary>
public class PracticeGameTests
{
    // 19:00 in Lagos, Saturday 17 October.
    private static readonly DateTime Now = new(2026, 10, 17, 18, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 10, 17);

    private static readonly string[] Syllables = ["d", "r", "m", "f", "s", "l", "t"];
    private static readonly int[] MajorSteps = [0, 2, 4, 5, 7, 9, 11];

    // ── Deals ───────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(PracticeGames.WhichNote)]
    [InlineData(PracticeGames.Staff)]
    [InlineData(PracticeGames.Hymn)]
    public void A_deal_is_rebuilt_exactly_from_its_id(string game)
    {
        var id = PracticeGames.NewDealId(game, PracticeTrack.Focused, 0x1234abcd);
        Assert.Equal($"{game}:f:1234abcd", id);

        var first = PracticeGames.Deal(id)!;
        var again = PracticeGames.Deal(id)!;
        Assert.Equal(JsonSerializer.Serialize(first.Rounds), JsonSerializer.Serialize(again.Rounds));
        Assert.NotEqual(JsonSerializer.Serialize(first.Rounds), JsonSerializer.Serialize(PracticeGames.Deal(PracticeGames.NewDealId(game, null, 7))!.Rounds));
        Assert.Equal(game == PracticeGames.Staff, first.IsRace);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("chess:f:1234abcd")]
    [InlineData("staff:x:1234abcd")]
    [InlineData("staff:f:1234ABCD")]
    [InlineData("staff:f:1234abc")]
    [InlineData("staff:f:1234abcd:9")]
    [InlineData("staff:f:zzzzzzzz")]
    public void An_id_the_server_never_deals_rebuilds_nothing(string? id) => Assert.Null(PracticeGames.Deal(id));

    [Fact]
    public void Which_note_asks_a_step_above_doh_in_a_new_key_and_the_answer_is_the_step_heard()
    {
        for (uint seed = 0; seed < 50; seed++)
        foreach (var track in new[] { PracticeTrack.Playful, PracticeTrack.Focused })
        {
            var rounds = PracticeGames.Deal(PracticeGames.NewDealId(PracticeGames.WhichNote, track, seed))!.Rounds;
            Assert.Equal(PracticeGames.WhichNoteRounds, rounds.Count);
            Assert.Equal(track == PracticeTrack.Playful ? ["d", "m", "s", "d'"] : new[] { "d", "r", "m", "f", "s", "l", "t", "d'" }, rounds[0].Choices);
            for (var i = 0; i < rounds.Count; i++)
            {
                var r = rounds[i];
                var above = r.NoteMidi!.Value - r.DohMidi!.Value;
                Assert.InRange(above, 1, 12);
                Assert.Equal(above == 12 ? "d'" : Syllables[Array.IndexOf(MajorSteps, above)], r.Answer);
                Assert.Contains(r.Answer, r.Choices);
                Assert.NotEqual("d", r.Answer);
                Assert.Equal($"{r.Doh} major", r.Key);
                if (i > 0)
                    Assert.NotEqual(rounds[i - 1].Answer, r.Answer);
            }
        }
    }

    [Fact]
    public void Staff_to_solfa_writes_each_note_as_its_key_signature_spells_it_and_the_answer_is_its_syllable()
    {
        var dohPitchClass = new Dictionary<string, int> { ["C"] = 0, ["G"] = 7, ["D"] = 2, ["A"] = 9, ["F"] = 5, ["Bb"] = 10, ["Eb"] = 3 };
        var fifths = new Dictionary<string, int> { ["C"] = 0, ["G"] = 1, ["D"] = 2, ["A"] = 3, ["F"] = -1, ["Bb"] = -2, ["Eb"] = -3 };
        for (uint seed = 0; seed < 50; seed++)
        foreach (var track in new[] { PracticeTrack.Playful, PracticeTrack.Focused })
        {
            var deal = PracticeGames.Deal(PracticeGames.NewDealId(PracticeGames.Staff, track, seed))!;
            Assert.Equal(PracticeGames.StaffRounds, deal.Rounds.Count);
            for (var i = 0; i < deal.Rounds.Count; i++)
            {
                var r = deal.Rounds[i];
                Assert.Equal(fifths[r.Doh!], r.Fifths);
                if (track == PracticeTrack.Playful)
                    Assert.Contains(r.Doh, new[] { "C", "G", "F" });
                // The key holds for ten notes, then changes.
                if (i % PracticeGames.StaffNotesPerKey != 0)
                    Assert.Equal(deal.Rounds[i - 1].Doh, r.Doh);
                else if (i > 0)
                    Assert.NotEqual(deal.Rounds[i - 1].Doh, r.Doh);

                // The note sounds what its name says, sits on the treble stave (E4 to G5; Playful to F5), and is the
                // scale step its syllable names.
                var name = r.NoteName!;
                var letter = "CDEFGAB".IndexOf(name[0]);
                var accidental = name.Length == 2 ? 0 : name[1] == '#' ? 1 : -1;
                var octave = name[^1] - '0';
                Assert.Equal(12 * (octave + 1) + new[] { 0, 2, 4, 5, 7, 9, 11 }[letter] + accidental, r.NoteMidi);
                Assert.InRange(octave * 7 + letter, 4 * 7 + 2, track == PracticeTrack.Playful ? 5 * 7 + 3 : 5 * 7 + 4);
                var step = ((r.NoteMidi!.Value - dohPitchClass[r.Doh!]) % 12 + 12) % 12;
                Assert.Equal(Syllables[Array.IndexOf(MajorSteps, step)], r.Answer);
                Assert.Equal(Syllables, r.Choices);
            }
        }
    }

    [Fact]
    public void Name_that_hymn_asks_eight_different_hymns_each_among_three_with_its_own_opening()
    {
        for (uint seed = 0; seed < 50; seed++)
        {
            var rounds = PracticeGames.Deal(PracticeGames.NewDealId(PracticeGames.Hymn, null, seed))!.Rounds;
            Assert.Equal(PracticeGames.HymnRounds, rounds.Count);
            Assert.Equal(rounds.Count, rounds.Select(r => r.Answer).Distinct().Count());
            foreach (var r in rounds)
            {
                Assert.Equal(PracticeGames.HymnChoices, r.Choices.Distinct().Count());
                Assert.Contains(r.Answer, r.Choices);
                Assert.Equal(r.Choices, r.Hymns!.Select(h => h.Slug));
                var hymn = HymnOpenings.Find(r.Answer)!;
                Assert.Equal(hymn.Notes.Select(n => (n.PitchMidi, n.StartBeat, n.DurBeats)), r.Notes!.Select(n => (n.PitchMidi, n.StartBeat, n.DurBeats)));
                Assert.Equal((hymn.Key, hymn.TimeSignature, hymn.TempoBpm), (r.Key!, r.TimeSignature!, r.TempoBpm!.Value));
            }
        }
    }

    [Fact]
    public void Every_hymn_opening_is_the_hymn_pages_own_notes()
    {
        using var pack = JsonDocument.Parse(File.ReadAllText(Path.Combine(CarolPathTests.RepoRoot(), "web-site", "hymns", "pack.json")));
        var hymns = pack.RootElement.GetProperty("hymns").EnumerateArray().ToDictionary(e => e.GetProperty("slug").GetString()!);

        Assert.True(HymnOpenings.All.Count >= PracticeGames.HymnRounds + PracticeGames.HymnChoices);
        Assert.Equal(HymnOpenings.All.Count, HymnOpenings.All.Select(h => h.Slug).Distinct().Count());
        foreach (var opening in HymnOpenings.All)
        {
            Assert.True(hymns.ContainsKey(opening.Slug), $"{opening.Slug} is not a published hymn");
            var page = hymns[opening.Slug];
            Assert.Equal(page.GetProperty("key").GetString(), opening.Key);
            Assert.Equal(page.GetProperty("time").GetString(), opening.TimeSignature);
            Assert.Equal(page.GetProperty("tempo").GetInt32(), opening.TempoBpm);
            if (page.GetProperty("kind").GetString() == "hymn")
                Assert.Equal(page.GetProperty("firstLine").GetString(), opening.FirstLine);
            var melody = page.GetProperty("notes").EnumerateArray()
                .Select(n => (n[0].GetInt32(), n[1].GetDouble(), n[2].GetDouble()))
                .ToList();
            var cut = HymnOpenings.Cut(melody, opening.TimeSignature, page.GetProperty("pickup").GetDouble());
            Assert.True(cut.SequenceEqual(opening.Notes), $"{opening.Slug}'s opening differs from its page; regenerate its line");
            Assert.InRange(opening.Notes.Count, 4, 24);
            Assert.Equal(0, opening.Notes[0].StartBeat);
        }
    }

    [Fact]
    public void An_opening_is_its_pickup_and_two_bars_or_more_bars_while_it_is_short()
    {
        // 3/4 with a crotchet pickup at the end of the first bar: the pickup and the two bars after it.
        (int, double, double)[] waltz = [(62, 2, 1), (67, 3, 2), (71, 5, 1), (69, 6, 1), (67, 7, 2), (64, 9, 1), (62, 10, 2), (60, 12, 3)];
        Assert.Equal([(62, 0, 1), (67, 1, 2), (71, 3, 1), (69, 4, 1), (67, 5, 2), (64, 7, 1), (62, 8, 2)], HymnOpenings.Cut(waltz, "3/4", 1));

        // Long notes: a bar more at a time while it is under seven notes, two bars more at most.
        (int, double, double)[] slow = [(60, 0, 2), (62, 2, 2), (64, 4, 4), (65, 8, 2), (67, 10, 2), (69, 12, 4), (71, 16, 4)];
        Assert.Equal(6, HymnOpenings.Cut(slow, "4/4", 0).Count);
        (int, double, double)[] steady = [(60, 0, 2), (62, 2, 2), (64, 4, 2), (65, 6, 2), (67, 8, 2), (69, 10, 2), (71, 12, 2), (72, 14, 2)];
        Assert.Equal(8, HymnOpenings.Cut(steady, "4/4", 0).Count); // whole bars: four, six, then eight
        Assert.Equal(3.0, HymnOpenings.BarBeats("6/8"));
    }

    // ── Marking ─────────────────────────────────────────────────────────────

    [Fact]
    public void A_game_of_rounds_is_scored_over_every_round_and_a_race_over_the_rounds_answered()
    {
        var quiz = PracticeGames.Deal(PracticeGames.NewDealId(PracticeGames.WhichNote, null, 3))!;
        var answers = quiz.Rounds.Select(r => (string?)r.Answer).ToList();
        answers[1] = "zz";
        answers[2] = null;
        var mark = PracticeGames.Mark(quiz, answers)!;
        // A round left unanswered is wrong, and a game of rounds counts only when every round was answered.
        Assert.Equal((80, 8, 9, false), (mark.Score, mark.Right, mark.Answered, mark.EnoughAnswered));
        Assert.Equal([true, false, false], mark.Marks.Take(3));
        answers[2] = quiz.Rounds[2].Answer;
        Assert.Equal((90, true), (PracticeGames.Mark(quiz, answers)!.Score, PracticeGames.Mark(quiz, answers)!.EnoughAnswered));

        var race = PracticeGames.Deal(PracticeGames.NewDealId(PracticeGames.Staff, null, 3))!;
        var raced = race.Rounds.Take(12).Select((r, i) => (string?)(i < 9 ? r.Answer : "x")).ToList();
        Assert.Equal((75, 9, 12, true), (PracticeGames.Mark(race, raced)!.Score, PracticeGames.Mark(race, raced)!.Right, 12, PracticeGames.Mark(race, raced)!.EnoughAnswered));
        Assert.False(PracticeGames.Mark(race, raced.Take(PracticeGames.StaffMinAnswered - 1).ToList())!.EnoughAnswered);

        Assert.Null(PracticeGames.Mark(quiz, Enumerable.Repeat<string?>("d", quiz.Rounds.Count + 1).ToList()));
    }

    [Fact]
    public async Task A_game_counts_once_as_practice_for_less_xp_than_a_drill_and_spends_no_marked_drill()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var deal = (await Deal(h, user, PracticeGames.Hymn)).Value;
        Assert.Equal((0, PracticeRules.GamesPerDay, (int?)null), (deal.GamesToday, deal.GamesPerDay, deal.TimeLimitSeconds));

        var result = await Grade(h, user).Handle(new GradePracticeGameCommand(deal.DealId, AllRight(deal), 55), default);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        var dto = result.Value;
        Assert.Equal((100, 8, 8, 8, true, (string?)null), (dto.Score, dto.Right, dto.Answered, dto.Rounds, dto.Counted, dto.NotCounted));
        Assert.Equal(PracticeRules.GameXp + PracticeRules.GameGoodBonus, dto.Reward!.XpGained);
        Assert.True(dto.Reward.XpGained < PracticeRules.DrillXp);
        Assert.Equal(1, dto.Reward.Streak);
        // A perfect game is not a take marked 100.
        Assert.DoesNotContain(dto.Reward.NewBadges, b => b.Code == "first_100");

        var row = Assert.Single(h.Db.PracticeSessions);
        Assert.Equal((PracticeKind.Game, deal.DealId, Today, 55.0), (row.Kind, row.DrillId, row.LocalDate, row.DurationSec));
        Assert.False(PracticeRules.UsesDrillAllowance(PracticeKind.Game));

        var again = await Grade(h, user).Handle(new GradePracticeGameCommand(deal.DealId, AllRight(deal), 55), default);
        Assert.Equal(PracticeErrors.GameMarked.Code, again.Error.Code);
        Assert.Single(h.Db.PracticeSessions);
    }

    [Fact]
    public async Task A_game_below_good_earns_the_base_xp_and_a_race_scores_the_notes_answered()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, PracticeTrack.Playful);
        var race = (await Deal(h, user, PracticeGames.Staff)).Value;
        Assert.Equal(PracticeGames.StaffSeconds, race.TimeLimitSeconds);
        Assert.EndsWith(race.DealId.Split(':')[2], race.DealId);
        Assert.Contains(":p:", race.DealId);

        var answers = race.Rounds.Take(10).Select((r, i) => (string?)(i < 6 ? r.Answer : "nope")).ToList();
        var dto = (await Grade(h, user).Handle(new GradePracticeGameCommand(race.DealId, answers, 60), default)).Value;

        Assert.Equal((60, 6, 10, 40), (dto.Score, dto.Right, dto.Answered, dto.Rounds));
        Assert.Equal(PracticeRules.GameXp, dto.Reward!.XpGained);
        var row = Assert.Single(h.Db.PracticeSessions);
        Assert.Equal((6, 4, 30), (row.Hits, row.Wrong, row.Missed));
    }

    [Fact]
    public async Task A_game_with_too_few_answers_or_past_the_days_games_is_marked_but_not_counted()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var race = (await Deal(h, user, PracticeGames.Staff)).Value;
        var few = (await Grade(h, user).Handle(new GradePracticeGameCommand(race.DealId, AllRight(race).Take(3).ToList(), 60), default)).Value;
        Assert.Equal((false, "few", 100), (few.Counted, few.NotCounted, few.Score));
        Assert.Null(few.Reward);
        Assert.Empty(h.Db.PracticeSessions);

        for (var i = 0; i < PracticeRules.GamesPerDay; i++)
        {
            var quiz = (await Deal(h, user, PracticeGames.WhichNote)).Value;
            Assert.Equal(i, quiz.GamesToday);
            Assert.True((await Grade(h, user).Handle(new GradePracticeGameCommand(quiz.DealId, AllRight(quiz), 40), default)).Value.Counted);
        }

        var extra = (await Deal(h, user, PracticeGames.WhichNote)).Value;
        var played = (await Grade(h, user).Handle(new GradePracticeGameCommand(extra.DealId, AllRight(extra), 40), default)).Value;
        Assert.Equal((false, "daily", 100), (played.Counted, played.NotCounted, played.Score));
        Assert.Equal(PracticeRules.GamesPerDay, h.Db.PracticeSessions.Count());
    }

    [Fact]
    public async Task Unknown_games_deals_and_answers_are_refused()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Assert.Equal(PracticeErrors.GameUnknown.Code, (await Deal(h, user, "chess")).Error.Code);
        Assert.Equal(PracticeErrors.GameDealUnknown.Code,
            (await Grade(h, user).Handle(new GradePracticeGameCommand("hymn:f:nothex!!", ["x"], 1), default)).Error.Code);
        var quiz = (await Deal(h, user, PracticeGames.WhichNote)).Value;
        Assert.Equal(PracticeErrors.GameAnswers.Code,
            (await Grade(h, user).Handle(new GradePracticeGameCommand(quiz.DealId, null, 1), default)).Error.Code);
        Assert.Equal(PracticeErrors.GameAnswers.Code,
            (await Grade(h, user).Handle(new GradePracticeGameCommand(quiz.DealId, Enumerable.Repeat<string?>("d", 11).ToList(), 1), default)).Error.Code);
    }

    [Fact]
    public void A_game_earns_by_its_own_rule_under_the_days_cap()
    {
        Assert.Equal(PracticeRules.GameXp, PracticeRules.BaseXp(PracticeKind.Game, 79));
        Assert.Equal(PracticeRules.GameXp + PracticeRules.GameGoodBonus, PracticeRules.BaseXp(PracticeKind.Game, 100));
        var day = Enumerable.Range(0, 40).Select(i => new PracticeFact(PracticeKind.Game, 100, false, Today, Now)).ToList();
        Assert.Equal(PracticeRules.DailyXpCap, PracticeMath.TotalXp(day));
        Assert.Equal(0, PracticeMath.Stats(day, Today).Perfect);
    }

    private static List<string?> AllRight(PracticeGameDto deal) => deal.Rounds.Select(r => (string?)r.Answer).ToList();

    private static User Seed(TestHarness h, PracticeTrack? track = null)
    {
        var user = User.Create("Chorister", "games@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        if (track is { } t)
            user.ChoosePracticeTrack(t);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static Task<NoteFusion.Shared.Results.Result<PracticeGameDto>> Deal(TestHarness h, User user, string game)
        => new GetPracticeGameQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetPracticeGameQuery(game), default);

    private static GradePracticeGameCommandHandler Grade(TestHarness h, User user)
        => new(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), h.QuotaGate, new PracticeRecorder(h.Db));
}
