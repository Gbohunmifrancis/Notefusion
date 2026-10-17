using System.Net;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Api.Controllers;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Commands;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The free daily drill end to end through its handlers: the server's own notes are graded, the take is recorded as
/// practice on the singer's calendar, the day's allowance holds, badges come once, and progress reads it all back.
/// </summary>
public class DrillGradingTests
{
    // 19:00 in Lagos, Saturday 17 October.
    private static readonly DateTime Now = new(2026, 10, 17, 18, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 10, 17);

    [Fact]
    public async Task Todays_drill_is_offered_to_a_free_account_with_its_allowance()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var drill = (await Today_(h, user).Handle(new GetTodayDrillQuery(), default)).Value;

        Assert.Equal(DrillCatalogue.ForDay(user.Id, Today, 0).Id, drill.Id);
        Assert.Equal(0, drill.Level);
        Assert.Equal("Doh", drill.LevelName);
        Assert.Equal(Today, drill.Date);
        Assert.Equal(new(0, PracticeRules.FreeDrillGradesPerDay), drill.Allowance);
        Assert.Equal(DrillCatalogue.LeadInBeats, drill.LeadInBeats);
        Assert.Equal("4/4", drill.TimeSignature);
    }

    [Fact]
    public async Task A_drill_is_graded_against_the_servers_own_notes_and_recorded_on_the_singers_day()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi(score: 100);
        var drill = DrillCatalogue.ForDay(user.Id, Today, 0);

        var result = await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(drill.Notes.Select(n => n.PitchMidi), api.LastTarget!.Notes.Select(n => n.PitchMidi));
        Assert.Equal(drill.LeadInSeconds, api.LastTarget.LeadInSec, 6);
        Assert.Equal(drill.MaxTakeSeconds, api.LastMaxTakeSeconds);

        var session = Assert.Single(h.Db.PracticeSessions);
        Assert.Equal(PracticeKind.Drill, session.Kind);
        Assert.Equal(drill.Id, session.DrillId);
        Assert.Equal(100, session.Score);
        Assert.Equal(Today, session.LocalDate);
        Assert.Equal(Now, session.CreatedAtUtc);

        var reward = result.Value.Reward!;
        Assert.Equal(20, reward.XpGained);
        Assert.Equal(20, reward.Xp);
        Assert.False(reward.LevelUp);
        Assert.Equal(1, reward.Streak);
        Assert.Equal(new[] { "first_drill", "first_100" }, reward.NewBadges.Select(b => b.Code));
    }

    [Fact]
    public async Task The_day_is_the_one_the_client_says_it_is_in()
    {
        using var h = new TestHarness(new DateTime(2026, 10, 18, 1, 0, 0, DateTimeKind.Utc)); // Saturday 21:00 in New York
        var user = Seed(h);
        var drill = DrillCatalogue.ForDay(user.Id, Today, 0);

        await Grade(h, user, new RecordingApi(70), zone: "America/New_York").Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);

        Assert.Equal(Today, Assert.Single(h.Db.PracticeSessions).LocalDate);
    }

    [Fact]
    public async Task An_unknown_drill_is_refused_without_reaching_the_worker()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi(90);

        var result = await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", "made-up@60"), default);

        Assert.Equal("PRACTICE_DRILL_UNKNOWN", result.Error.Code);
        Assert.Null(api.LastTarget);
        Assert.Empty(h.Db.PracticeSessions);
    }

    [Fact]
    public async Task A_free_account_gets_five_marked_drills_a_day_then_a_plain_sentence()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi(60);
        var drill = DrillCatalogue.ForDay(user.Id, Today, 0);

        for (var i = 0; i < PracticeRules.FreeDrillGradesPerDay; i++)
            Assert.True((await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default)).IsSuccess);
        api.Calls = 0;

        var refused = await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);

        Assert.Equal("PRACTICE_DAILY_LIMIT", refused.Error.Code);
        Assert.Equal(ErrorType.Forbidden, refused.Error.Type);
        Assert.Contains("Come back tomorrow", refused.Error.Message);
        Assert.Equal(0, api.Calls);
        Assert.Equal(5, h.Db.PracticeSessions.Count());

        // Tomorrow (Lagos) the allowance is back.
        h.Clock.UtcNow = Now.AddHours(7);
        Assert.True((await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default)).IsSuccess);
    }

    [Fact]
    public async Task Pro_gets_more_drills_a_day()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new RecordingApi(60);
        var drill = DrillCatalogue.ForDay(user.Id, Today, 0);

        for (var i = 0; i < PracticeRules.ProDrillGradesPerDay; i++)
            Assert.True((await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default)).IsSuccess);

        var refused = await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);

        Assert.Equal(20, PracticeRules.ProDrillGradesPerDay);
        Assert.Equal("PRACTICE_DAILY_LIMIT", refused.Error.Code);
        // Twenty drills at 10 XP each, held to the day's cap.
        Assert.Equal(PracticeRules.DailyXpCap, (await Progress(h, user)).Xp);
    }

    [Fact]
    public async Task A_take_the_worker_refuses_is_not_recorded_and_does_not_count()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var drill = DrillCatalogue.ForDay(user.Id, Today, 0);

        var result = await Grade(h, user, new RecordingApi(0) { Refuse = true }).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);

        Assert.True(result.IsFailure);
        Assert.Empty(h.Db.PracticeSessions);
        Assert.Equal(0, (await Progress(h, user)).Drills.Used);
    }

    [Fact]
    public async Task A_badge_is_awarded_once()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var drill = DrillCatalogue.ForDay(user.Id, Today, 0);

        var first = await Grade(h, user, new RecordingApi(50)).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);
        var second = await Grade(h, user, new RecordingApi(50)).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);

        Assert.Contains(first.Value.Reward!.NewBadges, b => b.Code == "first_drill");
        Assert.Empty(second.Value.Reward!.NewBadges);
        Assert.Single(h.Db.Achievements.Where(a => a.UserId == user.Id && a.Code == "first_drill"));
    }

    [Fact]
    public async Task Ten_drills_and_a_three_day_streak_unlock_their_badges_on_the_take_that_reaches_them()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi(60);

        var unlocked = new List<string>();
        for (var day = 0; day < 3; day++)
        {
            h.Clock.UtcNow = Now.AddDays(day);
            var drill = DrillCatalogue.ForDay(user.Id, Today.AddDays(day), 0);
            for (var i = 0; i < 4; i++)
            {
                var result = await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);
                unlocked.AddRange(result.Value.Reward!.NewBadges.Select(b => b.Code));
            }
        }

        Assert.Equal(new[] { "first_drill", "streak_3", "drills_10" }, unlocked);
        Assert.Equal(3, h.Db.Achievements.Count());
    }

    [Fact]
    public async Task Crossing_a_level_is_a_level_up_and_tomorrows_drill_comes_from_it()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi(100); // 20 XP a drill

        // Four days of five perfect drills: 100 XP a day.
        var levelUps = 0;
        for (var day = 0; day < 4; day++)
        {
            h.Clock.UtcNow = Now.AddDays(day);
            var drill = (await Today_(h, user).Handle(new GetTodayDrillQuery(), default)).Value;
            for (var i = 0; i < 5; i++)
            {
                var reward = (await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default)).Value.Reward!;
                if (reward.LevelUp) levelUps++;
            }
        }

        var progress = await Progress(h, user);
        Assert.Equal(400, progress.Xp);
        Assert.Equal("Me", progress.Level.Name); // 250 ≤ 400 < 500
        Assert.Equal(2, levelUps); // Ray on day 1, Me on day 3

        h.Clock.UtcNow = Now.AddDays(4);
        var next = (await Today_(h, user).Handle(new GetTodayDrillQuery(), default)).Value;
        Assert.Equal(2, next.Level);
        Assert.Equal(2, DrillCatalogue.Find(next.Id)!.Pattern.Tier);
    }

    [Fact]
    public async Task Todays_drill_does_not_change_when_the_singer_levels_up_during_the_day()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        // 95 XP yesterday: Doh, five short of Ray.
        for (var i = 0; i < 5; i++)
            h.Db.PracticeSessions.Add(PracticeSession.Record(user.Id, PracticeKind.Drill, 85, 3, 0, 0, 0, 3, Now.AddDays(-1), Today.AddDays(-1)));
        h.Db.PracticeSessions.Add(PracticeSession.Record(user.Id, PracticeKind.Part, 50, 3, 0, 0, 0, 3, Now.AddDays(-1), Today.AddDays(-1)));
        h.Db.SaveChanges();

        var before = (await Today_(h, user).Handle(new GetTodayDrillQuery(), default)).Value;
        await Grade(h, user, new RecordingApi(100)).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", before.Id), default);
        var after = (await Today_(h, user).Handle(new GetTodayDrillQuery(), default)).Value;

        Assert.Equal("Ray", (await Progress(h, user)).Level.Name);
        Assert.Equal(before.Id, after.Id);
        Assert.Equal(0, after.Level);
    }

    [Fact]
    public async Task Progress_reads_back_streak_week_and_badges()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var drill = DrillCatalogue.ForDay(user.Id, Today, 0);
        h.Db.PracticeSessions.Add(PracticeSession.Record(user.Id, PracticeKind.Drill, 70, 3, 0, 0, 0, 3, Now.AddDays(-1), Today.AddDays(-1)));
        h.Db.SaveChanges();

        var before = await Progress(h, user);
        Assert.True(before.Streak.AtRisk);
        Assert.Equal(1, before.Streak.Current);

        await Grade(h, user, new RecordingApi(80)).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);
        var after = await Progress(h, user);

        Assert.Equal(Today, after.Today);
        Assert.Equal(25, after.Xp);
        Assert.Equal(15, after.XpToday);
        Assert.Equal(2, after.Streak.Current);
        Assert.True(after.Streak.TodayDone);
        Assert.False(after.Streak.AtRisk);
        Assert.Equal(2, after.WeeklyGoal.DaysDone); // Friday and Saturday
        Assert.Equal(new(1, 5), after.Drills);
        Assert.True(after.Badges.Single(b => b.Code == "first_drill").Earned);
        Assert.Equal(2, after.Badges.Single(b => b.Code == "streak_3").Progress);
        Assert.Equal("done", after.LastSevenDays[^1].Status);
    }

    // ── The route ───────────────────────────────────────────────────────────

    [Fact]
    public void The_drill_routes_are_signed_in_and_grading_is_limited_before_the_take_is_read()
    {
        var controller = typeof(PracticeController);
        Assert.NotNull(controller.GetCustomAttribute<AuthorizeAttribute>());
        var grade = controller.GetMethod(nameof(PracticeController.GradeDrill))!;
        Assert.NotNull(grade.GetCustomAttribute<PracticeDrillRateLimitAttribute>());
        Assert.Equal("drills/grade", grade.GetCustomAttribute<HttpPostAttribute>()!.Template);
        Assert.True(grade.GetCustomAttribute<RequestSizeLimitAttribute>() is not null);
    }

    [Fact]
    public void A_device_gets_a_few_drills_a_minute_and_a_ceiling_a_day()
    {
        using var limiter = new PracticeDrillLimiter(new RateLimitSettings
        {
            TrustedProxyHops = 0, PracticeDrillPermits = 100, PracticeDrillDeviceDailyPermits = 3, PracticeDrillAddressDailyPermits = 100,
        });

        for (var i = 0; i < 3; i++)
            Assert.True(Try(limiter, $"10.0.0.{i}", "the-same-phone-1234"));
        Assert.False(Try(limiter, "10.0.0.99", "the-same-phone-1234"));
        Assert.True(Try(limiter, "10.0.0.99", "another-phone-5678"));
    }

    [Fact]
    public void An_address_has_a_days_ceiling_whatever_devices_it_claims()
    {
        using var limiter = new PracticeDrillLimiter(new RateLimitSettings
        {
            TrustedProxyHops = 0, PracticeDrillPermits = 100, PracticeDrillDeviceDailyPermits = 100, PracticeDrillAddressDailyPermits = 2,
        });

        Assert.True(Try(limiter, "1.2.3.4", "phone-number-0001"));
        Assert.True(Try(limiter, "1.2.3.4", null));
        Assert.False(Try(limiter, "1.2.3.4", "phone-number-0002"));
        Assert.True(Try(limiter, "5.6.7.8", null));
    }

    [Fact]
    public async Task The_drill_cap_goes_to_the_worker_and_a_part_take_sends_none()
    {
        var handler = new StubHttpMessageHandler((_, _) => StubHttpMessageHandler.Respond(HttpStatusCode.OK,
            """{"score":90,"hits":3,"near":0,"wrong":0,"missed":0,"tuningCents":2,"offsetSec":0.1,"octaveShift":0,"summary":"Good.","notes":[]}"""));
        var client = new TranscriptionApiClient(
            new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);
        var target = new GradeTargetDto([new(60, 0, 1)], 72, 6.67);

        await client.GradeAsync(new MemoryStream([1, 2, 3]), "take.m4a", target, 14.5);
        await client.GradeAsync(new MemoryStream([1, 2, 3]), "take.m4a", target);

        Assert.Contains("\"maxSec\":14.5", handler.Requests[0].Body);
        Assert.DoesNotContain("maxSec", handler.Requests[1].Body);
    }

    private static bool Try(PracticeDrillLimiter limiter, string address, string? device)
    {
        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = IPAddress.Parse(address);
        if (device is not null)
            http.Request.Headers["X-Device-Id"] = device;
        using var lease = limiter.Acquire(http);
        return lease.IsAcquired;
    }

    // ── Harness ─────────────────────────────────────────────────────────────

    private static GradeDrillCommandHandler Grade(TestHarness h, User user, ITranscriptionApi api, string? zone = null)
        => new(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(zone), h.QuotaGate, new PracticeRecorder(h.Db));

    private static GetTodayDrillQueryHandler Today_(TestHarness h, User user)
        => new(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone());

    private static async Task<Application.Practice.Dtos.PracticeProgressDto> Progress(TestHarness h, User user)
        => (await new GetPracticeProgressQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetPracticeProgressQuery(), default)).Value;

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Chorister", "soprano@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void GoPro(TestHarness h, User user)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    private sealed class RecordingApi(int score) : ITranscriptionApi
    {
        public GradeTargetDto? LastTarget { get; private set; }
        public double? LastMaxTakeSeconds { get; private set; }
        public int Calls { get; set; }
        public bool Refuse { get; init; }

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, double? maxTakeSeconds = null, CancellationToken ct = default)
        {
            Calls++;
            LastTarget = target;
            LastMaxTakeSeconds = maxTakeSeconds;
            if (Refuse)
                return Task.FromResult(Result.Failure<GradeResultDto>(Error.Validation("Api.Grade", "The take could not be read.")));
            return Task.FromResult(Result.Success(new GradeResultDto(score, target.Notes.Count, 0, 0, 0, 3.0, 0.1, 0, "Good.",
                target.Notes.Select((n, i) => new GradeNoteDto(i, n.PitchMidi, n.PitchMidi, 3.0, "hit")).ToList())));
        }

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result.Success(1));
    }
}
