using NoteFusion.Application.Practice.Dtos;

namespace NoteFusion.Application.Practice;

/// <summary>A badge's rule: earned once <c>Progress(stats)</c> reaches <c>Target</c>.</summary>
public sealed record BadgeDefinition(string Code, string Title, string Description, int Target, Func<PracticeStats, int> Progress);

/// <summary>
/// The badges, in the order the Practice screen lists them. A code is stored on <see cref="Core.Entities.Achievement"/>
/// rows, so it is never renamed; a new badge is a new line (and is awarded from the next practice recorded).
/// </summary>
public static class PracticeBadges
{
    public static readonly IReadOnlyList<BadgeDefinition> All =
    [
        new("first_drill", "First drill", "Sing your first daily drill.", 1, s => s.Drills),
        new("streak_3", "Three in a row", "Practise three days running.", 3, s => s.BestStreak),
        new("first_100", "Spot on", "Have a take marked 100.", 1, s => s.Perfect),
        new("drills_10", "Ten drills", "Sing ten daily drills.", 10, s => s.Drills),
        new("first_part", "First part", "Sing a part of a sheet and have it marked.", 1, s => s.Parts),
        // The weekly goal met in one Monday–Sunday week. Earned by any week that reached it (so a week before this
        // badge existed counts from the next practice); until then its progress is this week's days.
        new("week_goal", "A week of practice", "Practise five days in one week.", PracticeRules.WeeklyGoalDays,
            s => s.BestWeekDays >= PracticeRules.WeeklyGoalDays ? s.BestWeekDays : s.WeekDays),
        // streak_7 was titled "A week of practice" until week_goal took that name; the code (and every row) stays.
        new("streak_7", "Seven in a row", "Practise seven days running.", 7, s => s.BestStreak),
        new("whole_part_80", "Part learned", "Sing a whole part of a saved sheet and score 80 or more.", 1, s => s.WholePartsGood),
        new("streak_30", "A month of practice", "Practise thirty days running.", 30, s => s.BestStreak),
    ];

    /// <summary>The badges <paramref name="stats"/> reach that are not among <paramref name="earned"/> yet.</summary>
    public static IReadOnlyList<BadgeDefinition> Unlocked(PracticeStats stats, IReadOnlySet<string> earned)
        => All.Where(b => !earned.Contains(b.Code) && b.Progress(stats) >= b.Target).ToList();

    /// <summary>Every badge as the client draws it: earned (with when) or locked with progress.</summary>
    public static IReadOnlyList<BadgeDto> Describe(PracticeStats stats, IReadOnlyDictionary<string, DateTime> earned)
        => All.Select(b => Describe(b, stats, earned.TryGetValue(b.Code, out var at) ? at : null)).ToList();

    public static BadgeDto Describe(BadgeDefinition badge, PracticeStats stats, DateTime? earnedAtUtc)
        => new(
            badge.Code,
            badge.Title,
            badge.Description,
            earnedAtUtc is not null,
            earnedAtUtc,
            earnedAtUtc is not null ? badge.Target : Math.Min(badge.Target, badge.Progress(stats)),
            badge.Target);
}
