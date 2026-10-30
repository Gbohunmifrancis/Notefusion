using NoteFusion.Application.Choirs.Queries;
using NoteFusion.Application.Practice;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Choirs;

/// <summary>
/// The choir's practice league: everyone in the choir (the director too) ranked by the XP earned this ISO week, by the
/// same rules as their own XP; ties share a place; first names only; nobody outside the choir, and nothing once the plan
/// has run out.
/// </summary>
public class ChoirLeagueTests
{
    // Thursday 15 October 2026, 13:00 in Lagos: the week began on Monday the 12th.
    private static readonly DateTime Now = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Monday = new(2026, 10, 12);

    [Fact]
    public async Task The_week_is_ranked_by_xp_with_ties_sharing_a_place()
    {
        using var h = new TestHarness(Now);
        var (choir, director) = SeedChoir(h);
        var bea = Member(h, choir, "Bea Singer");
        var cal = Member(h, choir, "Cal Chorister");
        var dee = Member(h, choir, "Dee Alto");
        var outsider = SeedUser(h, "Eve Outside");

        // Bea: two good drills on two days. Cal: the same. Ada (director): one. Dee: last week only. Eve: not in it.
        Take(h, bea, Monday, 90);
        Take(h, bea, Monday.AddDays(2), 90);
        Take(h, cal, Monday.AddDays(1), 90);
        Take(h, cal, Monday.AddDays(3), 90);
        Take(h, director, Monday.AddDays(3), 60);
        Take(h, dee, Monday.AddDays(-1), 100);
        Take(h, outsider, Monday, 100);

        var league = (await League(h, cal)).Value;

        Assert.Equal(("St Mary's", Monday), (league.ChoirName, league.WeekStart));
        // The week starts afresh at midnight after Sunday, in the caller's zone (Lagos, UTC+1).
        Assert.Equal(new DateTime(2026, 10, 18, 23, 0, 0, DateTimeKind.Utc), league.ResetsAtUtc);
        var good = PracticeRules.BaseXp(PracticeKind.Drill, 90);
        Assert.Equal(
            [(1, "Bea", 2 * good, 2, false, false), (1, "Cal", 2 * good, 2, true, false),
             (3, "Ada", PracticeRules.BaseXp(PracticeKind.Drill, 60), 1, false, true), (4, "Dee", 0, 0, false, false)],
            league.Entries.Select(e => (e.Rank, e.Name, e.Xp, e.Days, e.IsYou, e.IsDirector)));
    }

    [Fact]
    public async Task A_day_counts_as_it_does_for_the_singer_capped()
    {
        using var h = new TestHarness(Now);
        var (choir, _) = SeedChoir(h);
        var bea = Member(h, choir, "Bea Singer");
        for (var i = 0; i < 30; i++)
            Take(h, bea, Monday, 100);

        var entry = (await League(h, bea)).Value.Entries.Single(e => e.IsYou);
        var facts = h.Db.PracticeSessions.Where(s => s.UserId == bea.Id).ToList()
            .Select(s => new PracticeFact(s.Kind, s.Score, s.WholePart, s.LocalDate, s.CreatedAtUtc, s.DrillId));
        Assert.Equal(PracticeMath.TotalXp(facts), entry.Xp);
        Assert.True(entry.Xp <= PracticeRules.DailyXpCap + PracticeRules.QuestChestXp);
    }

    [Fact]
    public async Task Only_the_choir_sees_it_and_only_while_its_plan_runs()
    {
        using var h = new TestHarness(Now);
        var (choir, director) = SeedChoir(h);
        var outsider = SeedUser(h, "Eve Outside");

        Assert.Equal("CHOIR_NOT_FOUND", (await League(h, outsider)).Error.Code);
        h.Clock.UtcNow = choir.CurrentPeriodEndUtc.AddDays(1);
        Assert.Equal("CHOIR_INACTIVE", (await League(h, director)).Error.Code);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static Task<NoteFusion.Shared.Results.Result<NoteFusion.Application.Choirs.Dtos.ChoirLeagueDto>> League(TestHarness h, User user)
        => new GetChoirLeagueQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetChoirLeagueQuery(), default);

    private static (Choir Choir, User Director) SeedChoir(TestHarness h)
    {
        var director = SeedUser(h, "Ada Director");
        var plan = Plan.Create(Guid.NewGuid(), "choir_monthly_ngn", "NoteFusion Choir (Monthly)", 2_500_000, "NGN", BillingInterval.Monthly, 25);
        h.Db.Plans.Add(plan);
        var choir = Choir.Start(director.Id, "St Mary's", "ABCD2345", plan.Id, 25, PaymentProvider.Paystack, Now.AddDays(-10), Now.AddDays(20), Now.AddDays(-10));
        h.Db.Choirs.Add(choir);
        h.Db.SaveChanges();
        return (choir, director);
    }

    private static User Member(TestHarness h, Choir choir, string name)
    {
        var user = SeedUser(h, name);
        h.Db.ChoirMembers.Add(ChoirMember.Create(choir.Id, user.Id, Now.AddDays(-5)));
        h.Db.SaveChanges();
        return user;
    }

    private static User SeedUser(TestHarness h, string name)
    {
        var user = User.Create(name, $"{name.Split(' ')[0].ToLowerInvariant()}@example.com", "hash", Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void Take(TestHarness h, User user, DateOnly day, int score)
    {
        h.Db.PracticeSessions.Add(PracticeSession.Record(
            user.Id, PracticeKind.Drill, score, 8, 0, 0, 0, 6, day.ToDateTime(new TimeOnly(9, 0), DateTimeKind.Utc), day, "g1u1-a@60"));
        h.Db.SaveChanges();
    }
}
