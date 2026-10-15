using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// Analytics handler tests over the real SQLite harness.
/// </summary>
/// <remarks>
/// The assertions worth keeping are the ones about <em>absence</em>: an undefined rate must be null
/// rather than 0, and a day with no activity must appear as an explicit zero rather than vanish. A
/// dashboard that shows 0% success on an idle day, or draws a straight line across a dead week,
/// tells the reader something false.
/// </remarks>
public class AnalyticsHandlerTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Utc);

    private static readonly IReadOnlyList<NoteEventDto> SampleNotes =
    [
        new(60, 0.0, 1.0, 0, "", "", 0.99),
        new(64, 1.0, 1.0, 0, "", "", 0.98)
    ];

    [Fact]
    public async Task Overview_counts_signups_inside_the_window_and_ignores_older_ones()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "recent@example.com", Now.AddDays(-5));
        await SeedUser(h, "older@example.com", Now.AddDays(-45));

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Users.TotalUsers);   // total ignores the window
        Assert.Equal(1, result.Value.Users.NewUsers);     // only the one inside 30 days
    }

    [Fact]
    public async Task Success_rate_is_null_when_nothing_has_reached_a_terminal_state()
    {
        using var h = new TestHarness(Now);

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        // Null, not 0. Zero would render as "everything failed" on an empty database.
        Assert.Null(result.Value.Transcriptions.SuccessRate);
        Assert.Null(result.Value.Transcriptions.AverageConfidence);
    }

    [Fact]
    public async Task Outcomes_count_jobs_not_saved_sheets_and_confidence_comes_from_the_sheets()
    {
        // Anchored on real time, not on Now: Transcription stamps its own CreatedAtUtc from
        // DateTime.UtcNow rather than taking the injected clock, so a fixed window in the past
        // would exclude every row this test saves and the assertions would read as a handler bug.
        using var h = new TestHarness(DateTime.UtcNow.AddMinutes(1));
        var userId = await SeedUser(h, "user@example.com", h.Clock.UtcNow.AddDays(-2));
        await SaveTranscription(h, userId);
        await SaveTranscription(h, userId);
        // Three jobs: two finished (the saved ones, and one more nobody saved), one that failed, one running.
        var at = h.Clock.UtcNow.AddHours(-1);
        foreach (var (id, outcome) in new[] { ("j1", "done"), ("j2", "done"), ("j3", "done"), ("j4", "failed"), ("j5", "running") })
        {
            var job = TranscriptionJob.Record(id, userId, at);
            if (outcome == "done") job.Settle("{}", at);
            if (outcome == "failed") job.Settle(null, at);
            h.Db.TranscriptionJobs.Add(job);
        }
        await h.Db.SaveChangesAsync();

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        var t = result.Value.Transcriptions;
        Assert.Equal(2, t.TotalSaved);
        Assert.Equal(3, t.SucceededCount);
        Assert.Equal(1, t.FailedCount);
        Assert.Equal(1, t.InFlightCount);
        Assert.Equal(0.75, t.SuccessRate);
        Assert.Equal(0.95, t.AverageConfidence);

        // The key breakdown groups on the owned value object's flattened columns.
        Assert.Equal(new CategoryCountDto("C major", 2), Assert.Single(result.Value.TopKeys));
    }

    [Fact]
    public async Task The_daily_series_zero_fills_days_with_no_activity()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "one@example.com", Now.AddDays(-3));

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        var series = result.Value.SignupsPerDay;

        // One point per day across the window, not one point per day that had a signup.
        Assert.Equal(result.Value.ToUtc.Subtract(result.Value.FromUtc).Days + 1, series.Count);
        Assert.Equal(1, series.Sum(p => p.Count));
        Assert.Contains(series, p => p.Count == 0);

        // Ordered, so the chart does not have to sort.
        Assert.Equal(series.OrderBy(p => p.Date).Select(p => p.Date), series.Select(p => p.Date));
    }

    [Fact]
    public async Task Google_accounts_are_reported_as_google_verified_and_not_as_password_users()
    {
        using var h = new TestHarness(Now);
        var google = User.CreateFromGoogle("G User", "g@example.com", "google-sub-1", null, Now.AddDays(-1));
        h.Db.Users.Add(google);
        await SeedUser(h, "pw@example.com", Now.AddDays(-1));
        await h.Db.SaveChangesAsync();

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        Assert.Equal(1, result.Value.Users.GoogleVerifiedUsers);
        Assert.Equal(1, result.Value.Users.PasswordOnlyUsers);

        // A Google account has no password, so it belongs to exactly one signup-method bucket.
        var methods = result.Value.SignupMethods.ToDictionary(m => m.Label, m => m.Count);
        Assert.Equal(1, methods["Google"]);
        Assert.Equal(1, methods["Password"]);
        Assert.Equal(0, methods["Both"]);
    }

    [Fact]
    public async Task A_linked_account_counts_as_both_rather_than_inflating_either_route()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Linked", "linked@example.com", h.Hasher.Hash("password123"), Now.AddDays(-1));
        // Verified first: linking Google to an account that never proved its address discards the password,
        // and this test needs one that genuinely has both routes in.
        h.MarkEmailVerified(user);
        user.LinkGoogleAccount("google-sub-2");
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        var methods = result.Value.SignupMethods.ToDictionary(m => m.Label, m => m.Count);
        Assert.Equal(0, methods["Google"]);
        Assert.Equal(0, methods["Password"]);
        Assert.Equal(1, methods["Both"]);
    }

    [Fact]
    public async Task Retention_excludes_same_day_activity_from_the_returned_count()
    {
        using var h = new TestHarness(Now);

        // Signed in on the day they registered: that is the registration itself, not a return.
        var sameDay = User.Create("Same Day", "same@example.com", h.Hasher.Hash("password123"), Now.AddDays(-6));
        sameDay.RecordSuccessfulLogin(Now.AddDays(-6).AddHours(2));

        // Came back the next day: a genuine return.
        var returned = User.Create("Returner", "return@example.com", h.Hasher.Hash("password123"), Now.AddDays(-6));
        returned.RecordSuccessfulLogin(Now.AddDays(-4));

        h.Db.Users.AddRange(sameDay, returned);
        await h.Db.SaveChangesAsync();

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        var cohort = Assert.Single(result.Value.Retention);
        Assert.Equal(2, cohort.CohortSize);
        Assert.Equal(1, cohort.ReturnedCount);
        Assert.Equal(0.5, cohort.RetentionRate);
    }

    [Fact]
    public async Task The_reporting_offset_is_echoed_so_the_client_formats_dates_the_same_way()
    {
        using var h = new TestHarness(Now);

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        Assert.Equal(60, result.Value.ReportingOffsetMinutes); // WAT, UTC+1
    }

    [Fact]
    public async Task Stored_bytes_sums_the_musicxml_length_across_all_transcriptions()
    {
        using var h = new TestHarness(DateTime.UtcNow.AddMinutes(1));
        var userId = await SeedUser(h, "user@example.com", h.Clock.UtcNow.AddDays(-2));
        await SaveTranscription(h, userId); // "<score/>" — 8 chars
        await SaveTranscription(h, userId);

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        // MusicXml is "<score/>" (8 chars) per saved row; the sum is exact, not an estimate.
        Assert.Equal("<score/>".Length * 2L, result.Value.Transcriptions.StoredBytes);
    }

    [Fact]
    public async Task Stored_bytes_is_zero_rather_than_null_on_an_empty_library()
    {
        using var h = new TestHarness(Now);

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        // SUM over no rows is null in SQL; the handler coalesces so the wire always carries a number.
        Assert.Equal(0L, result.Value.Transcriptions.StoredBytes);
    }

    [Fact]
    public async Task Recent_activity_interleaves_signups_and_finished_transcriptions_newest_first()
    {
        using var h = new TestHarness(DateTime.UtcNow.AddMinutes(1));
        var userId = await SeedUser(h, "author@example.com", h.Clock.UtcNow.AddDays(-3));
        // A finished job is the transcription event (saved or not), the newest thing that happened.
        var job = TranscriptionJob.Record("job-recent", userId, h.Clock.UtcNow.AddMinutes(-5));
        job.Settle("{}", h.Clock.UtcNow.AddMinutes(-4));
        h.Db.TranscriptionJobs.Add(job);
        await h.Db.SaveChangesAsync();

        var result = await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default);

        var feed = result.Value.RecentActivity;
        Assert.NotEmpty(feed);

        // The transcription finished after the signup, so it leads the feed.
        Assert.Equal("transcription", feed[0].Kind);
        Assert.Contains(feed, a => a.Kind == "signup" && a.Subtitle == "author@example.com");

        // Ordered strictly newest-first, so the client renders the list as given.
        Assert.Equal(
            feed.OrderByDescending(a => a.OccurredAtUtc).Select(a => a.OccurredAtUtc),
            feed.Select(a => a.OccurredAtUtc));
    }

    [Fact]
    public async Task Recent_activity_leaves_out_sign_ins_and_says_what_happened_in_utc()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Returner", "return@example.com", h.Hasher.Hash("password123"), Now.AddDays(-3));
        user.RecordSuccessfulLogin(Now.AddDays(-1));
        h.Db.Users.Add(user);
        var failed = TranscriptionJob.RecordLink("j-failed", user.Id, Now.AddHours(-2), null, false);
        failed.Settle(null, Now.AddHours(-2));
        h.Db.TranscriptionJobs.Add(failed);
        await h.Db.SaveChangesAsync();

        var feed = (await Handler(h).Handle(new GetAnalyticsOverviewQuery(), default)).Value.RecentActivity;

        // A sign-in is not something someone did; a single LastLoginAt cannot place it in history anyway.
        Assert.DoesNotContain(feed, a => a.Kind == "login");
        Assert.Equal(("transcription_failed", "had a song link fail to transcribe"), (feed[0].Kind, feed[0].Detail));
        Assert.Equal(("signup", "signed up"), (feed[1].Kind, feed[1].Detail));
        Assert.All(feed, a => Assert.Equal(DateTimeKind.Utc, a.OccurredAtUtc.Kind));
    }

    [Fact]
    public async Task An_invalid_range_fails_instead_of_returning_partial_numbers()
    {
        using var h = new TestHarness(Now);

        var result = await Handler(h).Handle(
            new GetAnalyticsOverviewQuery(new DateTime(2026, 8, 7), new DateTime(2026, 8, 1)), default);

        Assert.True(result.IsFailure);
        Assert.Equal("ANALYTICS_RANGE_INVERTED", result.Error.Code);
    }

    // ── Admin user list ───────────────────────────────────────────────────────

    [Fact]
    public async Task The_user_list_pages_newest_first_and_reports_the_total()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "first@example.com", Now.AddDays(-10));
        await SeedUser(h, "second@example.com", Now.AddDays(-5));
        await SeedUser(h, "third@example.com", Now.AddDays(-1));

        var result = await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(Page: 1, PageSize: 2), default);

        Assert.Equal(3, result.Value.TotalCount);
        Assert.Equal(2, result.Value.TotalPages);
        Assert.Equal(2, result.Value.Items.Count);
        Assert.Equal("third@example.com", result.Value.Items[0].Email);
    }

    [Fact]
    public async Task The_user_list_search_matches_email_and_name_case_insensitively()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "ada@example.com", Now.AddDays(-1), "Ada Lovelace");
        await SeedUser(h, "grace@example.com", Now.AddDays(-1), "Grace Hopper");

        var byName = await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(Search: "LOVELACE"), default);
        Assert.Equal("ada@example.com", Assert.Single(byName.Value.Items).Email);

        var byEmail = await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(Search: "grace@"), default);
        Assert.Equal("grace@example.com", Assert.Single(byEmail.Value.Items).Email);
    }

    [Fact]
    public async Task The_user_list_filters_and_sorts_by_last_seen_and_marks_who_is_online()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "online@example.com", Now.AddDays(-40));
        await SeedUser(h, "today@example.com", Now.AddDays(-30));
        await SeedUser(h, "month@example.com", Now.AddDays(-20));
        await SeedUser(h, "never@example.com", Now.AddDays(-50));
        var users = h.Db.Users.ToDictionary(u => u.Email);
        users["online@example.com"].MarkSeen(Now.AddMinutes(-2));
        users["today@example.com"].MarkSeen(Now.AddHours(-6));
        users["month@example.com"].RecordSuccessfulLogin(Now.AddDays(-12)); // seen only by its last sign-in
        await h.Db.SaveChangesAsync();

        async Task<List<string>> Emails(string? within, string? sort = null)
            => (await new GetAdminUsersQueryHandler(h.Db, h.Clock)
                    .Handle(new GetAdminUsersQuery(LastSeenWithin: within, Sort: sort), default))
                .Value.Items.Select(i => i.Email).ToList();

        Assert.Equal(["online@example.com"], await Emails("online"));
        Assert.Equal(["online@example.com", "today@example.com"], (await Emails("today")).Order().ToList());
        Assert.Equal(3, (await Emails("month")).Count);
        Assert.Equal(["never@example.com"], await Emails("inactive"));
        Assert.Equal(["online@example.com", "today@example.com", "month@example.com", "never@example.com"], await Emails(null, "lastSeen"));

        var rows = (await new GetAdminUsersQueryHandler(h.Db, h.Clock).Handle(new GetAdminUsersQuery(), default))
            .Value.Items.ToDictionary(r => r.Email);
        Assert.True(rows["online@example.com"].IsOnline);
        Assert.False(rows["today@example.com"].IsOnline);
        Assert.Equal(Now.AddHours(-6), rows["today@example.com"].LastSeenAtUtc);
        Assert.Equal(Now.AddDays(-12), rows["month@example.com"].LastSeenAtUtc);
        Assert.Null(rows["never@example.com"].LastSeenAtUtc);

        // The old isOnline flag is the same filter.
        var legacy = await new GetAdminUsersQueryHandler(h.Db, h.Clock).Handle(new GetAdminUsersQuery(IsOnline: true), default);
        Assert.Equal("online@example.com", Assert.Single(legacy.Value.Items).Email);
    }

    [Fact]
    public async Task The_user_list_reports_each_users_transcription_count()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h, "author@example.com", Now.AddDays(-3));
        await SaveTranscription(h, userId);
        await SaveTranscription(h, userId);
        await SeedUser(h, "empty@example.com", Now.AddDays(-2));

        var result = await new GetAdminUsersQueryHandler(h.Db, h.Clock).Handle(new GetAdminUsersQuery(), default);

        var rows = result.Value.Items.ToDictionary(r => r.Email, r => r.TranscriptionCount);
        Assert.Equal(2, rows["author@example.com"]);
        Assert.Equal(0, rows["empty@example.com"]);
    }

    [Fact]
    public async Task The_user_list_carries_each_accounts_avatar_when_it_has_one()
    {
        using var h = new TestHarness(Now);
        var withPhoto = await SeedUser(h, "photo@example.com", Now.AddDays(-2));
        await SeedUser(h, "initials@example.com", Now.AddDays(-1));
        h.Db.Users.Single(u => u.Id == withPhoto).SetProfilePicture("https://cdn.example.com/a.jpg");
        await h.Db.SaveChangesAsync();

        var rows = (await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(), default)).Value.Items.ToDictionary(r => r.Email);

        Assert.Equal("https://cdn.example.com/a.jpg", rows["photo@example.com"].ProfilePictureUrl);

        // Null rather than a placeholder URL: the console draws initials for an account with no
        // picture, and it can only make that choice if the absence reaches it as an absence.
        Assert.Null(rows["initials@example.com"].ProfilePictureUrl);
    }

    [Fact]
    public async Task An_oversized_page_size_is_clamped_rather_than_rejected()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "user@example.com", Now.AddDays(-1));

        var result = await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(Page: 0, PageSize: 5_000), default);

        // A paging control that overshoots is normal UI behaviour, not an error state.
        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.Page);
        Assert.Equal(GetAdminUsersQuery.MaxPageSize, result.Value.PageSize);
    }

    [Fact]
    public async Task The_user_list_tells_a_gift_apart_from_a_payment_and_from_no_access()
    {
        using var h = new TestHarness(Now);
        var paid = await SeedUser(h, "paid@example.com", Now.AddDays(-3));
        var gifted = await SeedUser(h, "gifted@example.com", Now.AddDays(-2));
        await SeedUser(h, "free@example.com", Now.AddDays(-1));

        SeedSubscription(h, paid, PaymentProvider.Paystack, Now.AddDays(20));
        SeedSubscription(h, gifted, provider: null, Now.AddDays(20));

        var rows = (await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(), default)).Value.Items.ToDictionary(r => r.Email);

        Assert.True(rows["paid@example.com"].HasProAccess);
        Assert.False(rows["paid@example.com"].IsGiftedPro);

        Assert.True(rows["gifted@example.com"].HasProAccess);
        Assert.True(rows["gifted@example.com"].IsGiftedPro);

        // Not gifted, but not paid either — the column has to read "Free", and a row that only carried
        // "is this a gift" would be indistinguishable from the paying customer above.
        Assert.False(rows["free@example.com"].HasProAccess);
        Assert.False(rows["free@example.com"].IsGiftedPro);
    }

    [Fact]
    public async Task A_lapsed_subscription_is_not_reported_as_pro_access()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h, "lapsed@example.com", Now.AddDays(-60));
        SeedSubscription(h, userId, PaymentProvider.Paystack, Now.AddDays(-1));

        var row = Assert.Single((await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(), default)).Value.Items);

        // The row still exists — a subscription is never deleted — so presence of a subscription cannot be
        // the test. The period window decides, exactly as the paywall decides it.
        Assert.False(row.HasProAccess);
    }

    [Fact]
    public async Task The_user_list_can_be_filtered_to_suspended_accounts()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "active@example.com", Now.AddDays(-2));
        var suspendedId = await SeedUser(h, "suspended@example.com", Now.AddDays(-1));
        h.Db.Users.Single(u => u.Id == suspendedId).Suspend();
        await h.Db.SaveChangesAsync();

        var suspended = await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(IsActive: false), default);
        var active = await new GetAdminUsersQueryHandler(h.Db, h.Clock)
            .Handle(new GetAdminUsersQuery(IsActive: true), default);

        Assert.Equal("suspended@example.com", Assert.Single(suspended.Value.Items).Email);
        Assert.Equal("active@example.com", Assert.Single(active.Value.Items).Email);

        // The total is the filtered total, not the table's. A pager that read 2 here would offer a page
        // with nothing on it.
        Assert.Equal(1, suspended.Value.TotalCount);
    }

    private static GetAnalyticsOverviewQueryHandler Handler(TestHarness h)
        => new(h.Db, h.Clock);

    [Fact]
    public async Task A_users_count_includes_unsaved_work_and_claimed_previews_and_keeps_failures_apart()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h, "busy@example.com", Now.AddDays(-30));

        // Three finished jobs (one later saved), one failed job, one still running.
        string[] done = ["j-done-1", "j-done-2", "j-saved"];
        foreach (var id in done)
        {
            var job = TranscriptionJob.Record(id, userId, Now.AddDays(-2));
            job.Settle("{}", Now.AddDays(-2));
            h.Db.TranscriptionJobs.Add(job);
        }
        var failed = TranscriptionJob.Record("j-failed", userId, Now.AddDays(-1));
        failed.Settle(null, Now.AddDays(-1));
        h.Db.TranscriptionJobs.AddRange(failed, TranscriptionJob.Record("j-running", userId, Now));

        // A free preview run before signing up, claimed at sign-up.
        var preview = PreviewJob.Record("p-1", "upload", "browser", null, Now.AddDays(-31));
        preview.Complete(true, null, Now.AddDays(-31));
        preview.Claim(userId, Now.AddDays(-30));
        h.Db.PreviewJobs.Add(preview);
        await h.Db.SaveChangesAsync();

        // One sheet saved from a finished job, and one from before jobs were recorded.
        await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId), h.QuotaGate).Handle(
            new SaveTranscriptionCommand("Kept", "C", 120, "4/4", "<score/>", SampleNotes, 0.9, SourceJobId: "j-saved"), default);
        await SaveTranscription(h, userId);

        var row = (await new GetAdminUsersQueryHandler(h.Db, h.Clock).Handle(new GetAdminUsersQuery(), default))
            .Value.Items.Single();
        // 3 finished jobs + 1 claimed preview + 1 legacy sheet; the sheet saved from j-saved is not counted twice.
        Assert.Equal(5, row.TranscriptionCount);
        Assert.Equal(2, row.SavedTranscriptionCount);
        Assert.Equal(1, row.FailedTranscriptionCount);

        var detail = (await new NoteFusion.Application.Admin.Queries.GetUserAccountQueryHandler(h.Db, h.Clock)
            .Handle(new NoteFusion.Application.Admin.Queries.GetUserAccountQuery(userId), default)).Value;
        Assert.Equal((5, 2, 1), (detail.TranscriptionCount, detail.SavedTranscriptionCount, detail.FailedTranscriptionCount));
    }

    private static async Task<Guid> SeedUser(
        TestHarness h, string email, DateTime createdAt, string fullName = "Test User")
    {
        var user = User.Create(fullName, email, h.Hasher.Hash("password123"), createdAt);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }

    /// <summary>
    /// A subscription ending at <paramref name="endsAtUtc"/>, paid for when a provider is given and gifted
    /// when it is not — the absence of a provider is the only thing that marks a comp.
    /// </summary>
    private static void SeedSubscription(
        TestHarness h, Guid userId, PaymentProvider? provider, DateTime endsAtUtc)
    {
        var planId = new Guid("11111111-1111-1111-1111-111111111111");
        if (!h.Db.Plans.Any(p => p.Id == planId))
        {
            h.Db.Plans.Add(Plan.Create(
                planId, "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly));
        }

        var start = Now.AddDays(-30);
        h.Db.Subscriptions.Add(provider is { } p
            ? Subscription.Start(userId, planId, p, start, endsAtUtc, "prov-sub-1", start)
            : Subscription.Grant(userId, planId, start, endsAtUtc, start));

        h.Db.SaveChanges();
    }

    private static async Task SaveTranscription(TestHarness h, Guid userId)
        => await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId), h.QuotaGate)
            .Handle(new SaveTranscriptionCommand(
                "Song", "C", 120, "4/4", "<score/>", SampleNotes, 0.95, SourceJobId: null), default);
}
