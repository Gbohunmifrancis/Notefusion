using NoteFusion.Application.Practice;
using NoteFusion.Core.Enums;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The daily quests: three a day, a warm-up, an effort and a quality one, the same for everyone that day and varied over
/// the days; read off that day's marked takes alone; and once all three are done the day's chest adds its XP on top of
/// the day's cap, so the take that finished the last quest earns it.
/// </summary>
public class DailyQuestTests
{
    private static readonly DateOnly Day = new(2026, 10, 29);
    private static readonly DateTime At = new(2026, 10, 29, 12, 0, 0, DateTimeKind.Utc);

    private static PracticeFact Take(PracticeKind kind, int score, DateOnly? day = null)
        => new(kind, score, false, day ?? Day, At);

    /// <summary>A day that does every quest there is.</summary>
    private static List<PracticeFact> Everything(DateOnly day)
        => Enumerable.Repeat(Take(PracticeKind.Drill, 95, day), 6)
            .Concat(Enumerable.Repeat(Take(PracticeKind.Game, 95, day), 3))
            .Append(Take(PracticeKind.PitchMatch, 95, day))
            .ToList();

    [Fact]
    public void Three_quests_a_day_the_same_for_everyone_and_varied_over_the_days()
    {
        var empty = Array.Empty<PracticeFact>();
        var seen = new HashSet<string>();
        for (var i = 0; i < 27; i++)
        {
            var day = Day.AddDays(i);
            var quests = DailyQuests.For(day, empty);
            Assert.Equal(3, quests.Count);
            Assert.Equal(3, quests.Select(q => q.Code).Distinct().Count());
            Assert.Equal(quests.Select(q => q.Code), DailyQuests.For(day, Everything(day)).Select(q => q.Code));
            Assert.All(quests, q => Assert.Equal(0, q.Progress));
            seen.Add(string.Join(",", quests.Select(q => q.Code)));
        }
        // Every warm-up, effort and quality quest turns up together with every other over the 27 days.
        Assert.Equal(27, seen.Count);
    }

    [Fact]
    public void A_quest_counts_that_days_marked_takes_alone_up_to_its_target()
    {
        var done = DailyQuests.For(Day, Everything(Day));
        Assert.All(done, q => Assert.True(q.Done, q.Code));
        Assert.All(done, q => Assert.Equal(q.Target, q.Progress));

        // Yesterday's takes do nothing for today.
        Assert.All(DailyQuests.Describe(Day, Everything(Day.AddDays(-1))).Quests, q => Assert.Equal(0, q.Progress));

        // A game is no sung take: games alone never do a sung-take quest.
        var games = Enumerable.Repeat(Take(PracticeKind.Game, 100), 6).ToList();
        for (var i = 0; i < 27; i++)
        {
            var day = Day.AddDays(i);
            foreach (var q in DailyQuests.For(day, games.Select(g => g with { LocalDate = day }).ToList()))
                if (q.Code is "drills-2" or "mode-1" or "takes-5" or "good-2" or "great-take")
                    Assert.Equal(0, q.Progress);
        }
    }

    [Fact]
    public void All_three_done_opens_the_chest_on_top_of_the_days_cap()
    {
        var day = Everything(Day);
        var baseXp = Math.Min(PracticeRules.DailyXpCap, day.Sum(f => PracticeRules.BaseXp(f.Kind, f.Score)));
        Assert.Equal(baseXp + PracticeRules.QuestChestXp, PracticeMath.XpByDay(day)[Day]);

        var capped = day.Concat(Enumerable.Repeat(Take(PracticeKind.Drill, 100), 20)).ToList();
        Assert.Equal(PracticeRules.DailyXpCap + PracticeRules.QuestChestXp, PracticeMath.XpByDay(capped)[Day]);

        // Without the last quest no chest; the take that does it earns it.
        var quests = DailyQuests.For(Day, day);
        var lacking = day.Take(1).ToList();
        Assert.False(DailyQuests.ChestOpened(Day, lacking));
        Assert.Equal(Math.Min(PracticeRules.DailyXpCap, PracticeRules.BaseXp(PracticeKind.Drill, 95)), PracticeMath.XpByDay(lacking)[Day]);

        var progress = PracticeMath.Progress(day, new Dictionary<string, DateTime>(), Day,
            new NoteFusion.Application.Practice.Dtos.DrillAllowanceDto(0, 10));
        Assert.True(progress.Quests!.ChestOpened);
        Assert.Equal(quests.Select(q => q.Code), progress.Quests.Quests.Select(q => q.Code));
        Assert.Equal(PracticeRules.QuestChestXp, progress.Quests.ChestXp);
    }
}
