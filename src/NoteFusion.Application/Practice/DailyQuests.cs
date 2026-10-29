using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice;

/// <summary>One daily quest: what it asks, how far the day's takes have got, and how many it needs.</summary>
public sealed record DailyQuest(string Code, string Title, int Progress, int Target)
{
    public bool Done => Progress >= Target;
}

/// <summary>
/// Three quests a day, the same for everyone on that local day (a warm-up, an effort, a quality one), each read off the
/// day's marked practice like XP is: nothing is stored, so a quest can only be done by takes the server marked. All three
/// done opens the day's chest: <see cref="PracticeRules.QuestChestXp"/> on top of the day's XP and its cap
/// (<see cref="PracticeMath.XpByDay"/>), so the take that finishes the last quest says so in its reward.
/// </summary>
public static class DailyQuests
{
    private sealed record Quest(string Code, string Title, int Target, Func<IReadOnlyCollection<PracticeFact>, int> Progress);

    private static bool Sung(PracticeFact f) => f.Kind != PracticeKind.Game;

    private static readonly Quest[] WarmUps =
    [
        new("drills-2", "Sing 2 drills", 2, day => day.Count(f => f.Kind == PracticeKind.Drill)),
        new("game-1", "Play a quick game", 1, day => day.Count(f => f.Kind == PracticeKind.Game)),
        new("mode-1", "Sing in a practice mode", 1, day => day.Count(f => f.Kind is not (PracticeKind.Drill or PracticeKind.Part or PracticeKind.Game))),
    ];

    private static readonly Quest[] Efforts =
    [
        new("takes-5", "Sing 5 takes", 5, day => day.Count(Sung)),
        new("xp-40", "Earn 40 XP", 40, day => Math.Min(PracticeRules.DailyXpCap, day.Sum(f => PracticeRules.BaseXp(f.Kind, f.Score)))),
        new("games-3", "Play 3 quick games", 3, day => day.Count(f => f.Kind == PracticeKind.Game)),
    ];

    private static readonly Quest[] Qualities =
    [
        new("good-2", "Score 80 or more on 2 takes", 2, day => day.Count(f => Sung(f) && f.Score >= PracticeRules.GoodScore)),
        new("great-game", "Score 90 or more in a quick game", 1, day => day.Count(f => f.Kind == PracticeKind.Game && f.Score >= 90)),
        new("great-take", "Score 90 or more on a take", 1, day => day.Count(f => Sung(f) && f.Score >= 90)),
    ];

    /// <summary>The day's three quests and how far <paramref name="day"/>'s takes (that day's only) have got.</summary>
    public static IReadOnlyList<DailyQuest> For(DateOnly date, IReadOnlyCollection<PracticeFact> day)
    {
        var n = date.DayNumber;
        return new[] { WarmUps[n % WarmUps.Length], Efforts[n / 3 % Efforts.Length], Qualities[n / 9 % Qualities.Length] }
            .Select(q => new DailyQuest(q.Code, q.Title, Math.Min(q.Target, q.Progress(day)), q.Target))
            .ToList();
    }

    /// <summary>Whether <paramref name="day"/>'s takes did all three of that day's quests (the chest's XP).</summary>
    public static bool ChestOpened(DateOnly date, IReadOnlyCollection<PracticeFact> day) => For(date, day).All(q => q.Done);

    /// <summary>The quests on the progress: today's three and whether today's chest is open.</summary>
    public static DailyQuestsDto Describe(DateOnly today, IReadOnlyCollection<PracticeFact> facts)
    {
        var day = facts.Where(f => f.LocalDate == today).ToList();
        var quests = For(today, day);
        return new DailyQuestsDto(
            quests.Select(q => new DailyQuestDto(q.Code, q.Title, q.Progress, q.Target, q.Done)).ToList(),
            quests.All(q => q.Done),
            PracticeRules.QuestChestXp);
    }
}
