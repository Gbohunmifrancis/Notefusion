using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Feedback;
using NoteFusion.Application.Web.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>Feedback, ratings and "where did you hear about us?", their prompts, and the engagement leaderboard.</summary>
public class FeedbackAndEngagementTests
{
    private static readonly DateTime Now = new(2026, 10, 8, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Heard_about_is_asked_until_answered_and_the_first_answer_stands()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");

        Assert.True((await Prompts(h, ada, "web")).AskHeardAbout);
        await Submit(h, ada, new SubmitFeedbackCommand("heard_about", Source: "WhatsApp", Client: "web"));
        await Submit(h, ada, new SubmitFeedbackCommand("heard_about", Source: "tiktok", Client: "app"));

        Assert.False((await Prompts(h, ada, "app")).AskHeardAbout);
        var answer = Assert.Single(h.Db.UserFeedback);
        Assert.Equal("whatsapp", answer.Category);
        Assert.Equal("web", answer.Client);
    }

    [Fact]
    public async Task The_rating_is_asked_in_the_app_after_three_transcriptions_and_respects_not_now()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");

        AddFinishedJobs(h, ada, 2);
        Assert.False((await Prompts(h, ada, "app")).AskRating);

        AddFinishedJobs(h, ada, 1);
        Assert.True((await Prompts(h, ada, "app")).AskRating);
        Assert.False((await Prompts(h, ada, "web")).AskRating); // never on the web

        await Submit(h, ada, new SubmitFeedbackCommand("rating_dismissed"));
        Assert.False((await Prompts(h, ada, "app")).AskRating);

        h.Clock.UtcNow = Now.AddDays(31);
        Assert.True((await Prompts(h, ada, "app")).AskRating); // "not now" lapses after 30 days

        await Submit(h, ada, new SubmitFeedbackCommand("rating", Rating: 5, Message: "Love it"));
        h.Clock.UtcNow = Now.AddDays(120);
        Assert.False((await Prompts(h, ada, "app")).AskRating);
    }

    [Fact]
    public async Task The_summary_averages_ratings_and_ranks_sources_and_the_list_names_the_user()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");
        var bob = Signup(h, "bob@example.com", "Bob");
        await Submit(h, ada, new SubmitFeedbackCommand("rating", Rating: 5));
        await Submit(h, bob, new SubmitFeedbackCommand("rating", Rating: 2, Message: "Missed the high notes"));
        await Submit(h, ada, new SubmitFeedbackCommand("heard_about", Source: "church"));
        await Submit(h, bob, new SubmitFeedbackCommand("heard_about", Source: "church"));
        await Submit(h, bob, new SubmitFeedbackCommand("feedback", Category: "bug", Message: "Export crashed"));

        var summary = (await new GetFeedbackSummaryQueryHandler(h.Db).Handle(new GetFeedbackSummaryQuery(), default)).Value;
        Assert.Equal(3.5, summary.AverageRating);
        Assert.Equal(2, summary.Ratings);
        Assert.Equal(("church", 2), (summary.HeardAbout[0].Label, summary.HeardAbout[0].Count));
        Assert.Equal(1, summary.RatingDistribution.Single(r => r.Label == "5").Count);
        Assert.Equal("bug", Assert.Single(summary.FeedbackByCategory).Label);

        var list = (await new GetFeedbackListQueryHandler(h.Db).Handle(new GetFeedbackListQuery(Kind: "feedback"), default)).Value;
        var row = Assert.Single(list.Items);
        Assert.Equal(("Export crashed", "bob@example.com"), (row.Message, row.UserEmail));
    }

    [Fact]
    public async Task Engagement_ranks_the_most_active_users_and_counts_active_users()
    {
        using var h = new TestHarness(Now.AddDays(-3));
        var busy = Signup(h, "busy@example.com", "Busy");
        var quiet = Signup(h, "quiet@example.com", "Quiet");

        AddFinishedJobs(h, busy, 4);                      // 3 days ago
        h.Clock.UtcNow = Now.AddDays(-1);
        AddFinishedJobs(h, busy, 2);                      // yesterday
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(quiet), h.Clock).Handle(new RecordWebEventsCommand("v", "s",
            [new WebEventInput("action", "Opened plans", "/app", null, null, "desktop", null)]), default);

        h.Clock.UtcNow = Now;
        var e = (await new GetEngagementQueryHandler(h.Db, h.Clock).Handle(new GetEngagementQuery(), default)).Value;

        Assert.Equal(2, e.ActiveUsers);
        Assert.Equal(2, e.NewActiveUsers);
        Assert.Equal(2, e.Mau);
        Assert.Equal(["Busy", "Quiet"], e.TopUsers.Select(u => u.FullName));
        var top = e.TopUsers[0];
        Assert.Equal((6, 2), (top.Transcriptions, top.ActiveDays));
        Assert.Equal(1, e.TopUsers[1].WebSessions);
        Assert.Equal(1, e.UsersByTranscriptions.Single(b => b.Label == "6–10").Count);
        Assert.Equal(1, e.UsersByTranscriptions.Single(b => b.Label == "0").Count);
        Assert.Equal(6, e.TranscriptionsByHour.Sum(b => b.Count));
    }

    private static void AddFinishedJobs(TestHarness h, Guid userId, int count)
    {
        for (var i = 0; i < count; i++)
        {
            var job = TranscriptionJob.Record($"job-{Guid.NewGuid():N}", userId, h.Clock.UtcNow);
            job.Settle("{}", h.Clock.UtcNow);
            h.Db.TranscriptionJobs.Add(job);
        }
        h.Db.SaveChanges();
    }

    private static async Task<FeedbackPromptsDto> Prompts(TestHarness h, Guid userId, string client)
        => (await new GetFeedbackPromptsQueryHandler(h.Db, new StubCurrentUser(userId), h.Clock)
            .Handle(new GetFeedbackPromptsQuery(client), default)).Value;

    private static async Task Submit(TestHarness h, Guid userId, SubmitFeedbackCommand command)
    {
        var result = await new SubmitFeedbackCommandHandler(h.Db, new StubCurrentUser(userId), h.Clock, new StubClientApp("app"))
            .Handle(command, default);
        Assert.True(result.IsSuccess);
    }

    private static Guid Signup(TestHarness h, string email, string name)
    {
        var user = User.Create(name, email, "hash", h.Clock.UtcNow);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user.Id;
    }
}
