using NoteFusion.Application.Activity.Commands;
using NoteFusion.Application.Activity.Queries;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Preview.Queries;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Application.Web.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Activity;

/// <summary>
/// The dashboard's activity log: every transcription asked for is recorded with what was sent and how it
/// ended, saved or not; journeys join a person's browsers, devices, uploads and payments; the checkout
/// funnel counts sessions per step; and all of it is deleted after 180 days.
/// </summary>
public class ActivityLogTests
{
    private static readonly DateTime Now = new(2026, 10, 7, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task An_upload_is_logged_with_its_name_type_size_and_who_sent_it()
    {
        using var h = new TestHarness(Now);
        var user = Signup(h, "ada@example.com", "Ada");
        h.ClientApp.Current = "app";

        var result = await Upload(h, user, new FakeApi(), "Sunday choir take.m4a", contentType: "audio/mp4", size: 482_000, device: "phone-1");

        Assert.True(result.IsSuccess);
        var log = Assert.Single(h.Db.TranscriptionLogs);
        Assert.Equal(result.Value, log.JobId);
        Assert.Equal(user, log.UserId);
        Assert.Equal("phone-1", log.DeviceHash);
        Assert.Equal("app", log.Client);
        Assert.Equal(TranscriptionLog.AccountOrigin, log.Origin);
        Assert.Equal("upload", log.Kind);
        Assert.Equal("melody", log.Mode);
        Assert.Equal("Sunday choir take.m4a", log.FileName);
        Assert.Equal("audio/mp4", log.ContentType);
        Assert.Equal(482_000, log.SizeBytes);
        Assert.Equal(TranscriptionLog.Submitted, log.Status);
    }

    [Fact]
    public async Task A_refused_upload_is_logged_with_the_reason_and_no_job()
    {
        using var h = new TestHarness(Now);
        var user = Signup(h, "ada@example.com", "Ada");

        var result = await Upload(h, user, new FakeApi { RefuseSubmit = true }, "too-big.wav");

        Assert.True(result.IsFailure);
        var log = Assert.Single(h.Db.TranscriptionLogs);
        Assert.Null(log.JobId);
        Assert.Equal(TranscriptionLog.Refused, log.Status);
        Assert.Contains("Worker.Rejected", log.FailureReason);
        Assert.Equal("too-big.wav", log.FileName);
    }

    [Fact]
    public async Task A_finished_job_records_its_outcome_once_and_failed_ones_their_reason()
    {
        using var h = new TestHarness(Now);
        var user = Signup(h, "ada@example.com", "Ada");
        var api = new FakeApi();
        var done = (await Upload(h, user, api, "hymn.m4a")).Value;
        var failed = (await Upload(h, user, api, "noise.m4a")).Value;

        api.Outcomes[done] = TranscriptionStatus.Done;
        api.Outcomes[failed] = TranscriptionStatus.Failed;
        var poll = new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user), h.Clock);
        await poll.Handle(new GetTranscriptionJobQuery(done), default);
        await poll.Handle(new GetTranscriptionJobQuery(done), default); // polled twice: still one outcome
        await poll.Handle(new GetTranscriptionJobQuery(failed), default);

        var ok = h.Db.TranscriptionLogs.Single(l => l.JobId == done);
        Assert.Equal(TranscriptionLog.Done, ok.Status);
        Assert.Equal("G major", ok.DetectedKey);
        Assert.Equal(96, ok.DetectedTempo);
        Assert.Equal(2, ok.NoteCount);
        Assert.Equal(42.5, ok.AudioSeconds);
        Assert.Equal(Now, ok.FinishedAtUtc);

        var bad = h.Db.TranscriptionLogs.Single(l => l.JobId == failed);
        Assert.Equal(TranscriptionLog.Failed, bad.Status);
        Assert.Equal("Too quiet to hear any notes.", bad.FailureReason);
    }

    [Fact]
    public async Task An_anonymous_preview_is_logged_and_completed_by_its_poll()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi();
        var preview = new SubmitPreviewCommandHandler(api, h.Db, h.Clock, new StubDeviceFingerprint("browser-a"), h.ClientIp, h.Activity(device: "browser-a"), h.QuotaGate);

        var job = (await preview.Handle(new SubmitPreviewCommand(new MemoryStream([1]), "hum.webm", ContentType: "audio/webm", SizeBytes: 9000), default)).Value;
        api.Outcomes[job] = TranscriptionStatus.Done;
        await new GetPreviewJobQueryHandler(api, h.Db, h.Clock).Handle(new GetPreviewJobQuery(job), default);

        var log = Assert.Single(h.Db.TranscriptionLogs);
        Assert.Equal(TranscriptionLog.PreviewOrigin, log.Origin);
        Assert.Null(log.UserId);
        Assert.Equal("browser-a", log.DeviceHash);
        Assert.Equal("audio/webm", log.ContentType);
        Assert.Equal(TranscriptionLog.Done, log.Status);
    }

    [Fact]
    public async Task The_log_shows_saved_and_unsaved_work_and_filters_it()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada Lovelace");
        var bob = Signup(h, "bob@example.com", "Bob Marley");
        var api = new FakeApi();
        var kept = (await Upload(h, ada, api, "kept.m4a", size: 1000)).Value;
        await Upload(h, ada, api, "thrown away.m4a", size: 2000);
        await Upload(h, bob, new FakeApi { RefuseSubmit = true }, "bob.m4a");
        h.Db.Transcriptions.Add(new Transcription(ada, "Kept", KeyParser.Parse("C major").Value, 100, "4/4", "<x/>", [], 0.9, kept));
        await h.Db.SaveChangesAsync();

        var all = (await Log(h, new GetTranscriptionLogQuery())).Value;
        Assert.Equal(3, all.Summary.Total);
        Assert.Equal(1, all.Summary.Saved);
        Assert.Equal(1, all.Summary.Refused);
        Assert.Equal(1000 + 2000 + 1234, all.Summary.TotalBytes); // a refused upload still says how big it was
        Assert.Equal("Ada Lovelace", all.Page.Items.Single(r => r.FileName == "kept.m4a").UserName);
        Assert.True(all.Page.Items.Single(r => r.FileName == "kept.m4a").Saved);

        var unsaved = (await Log(h, new GetTranscriptionLogQuery(Saved: false, UserId: ada))).Value;
        Assert.Equal("thrown away.m4a", Assert.Single(unsaved.Page.Items).FileName);

        var bySearch = (await Log(h, new GetTranscriptionLogQuery(Search: "BOB@example"))).Value;
        Assert.Equal("bob.m4a", Assert.Single(bySearch.Page.Items).FileName);

        var refused = (await Log(h, new GetTranscriptionLogQuery(Status: TranscriptionLog.Refused))).Value;
        Assert.Equal(bob, Assert.Single(refused.Page.Items).UserId);
    }

    [Fact]
    public async Task A_journey_joins_the_browsing_before_signup_with_the_accounts_uploads_and_payments()
    {
        using var h = new TestHarness(Now.AddHours(-3));
        var events = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock);
        // Anonymous first: the pricing page, then a checkout click, from browser "v1" on device "d1".
        await events.Handle(new RecordWebEventsCommand("v1", "s1",
            [new WebEventInput("pageview", null, "/", null, "google.com", "desktop", null)], "d1"), default);

        h.Clock.UtcNow = Now.AddHours(-2);
        var ada = Signup(h, "ada@example.com", "Ada");
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(ada), h.Clock).Handle(new RecordWebEventsCommand("v1", "s2",
        [
            new WebEventInput("action", CheckoutSteps.Started, "/app", null, null, "desktop", null),
            new WebEventInput("action", CheckoutSteps.Failed, "/app", null, null, "desktop", null, "BILLING_PROVIDER_DOWN (502)"),
        ], "d1"), default);
        await Upload(h, ada, new FakeApi(), "warmup.m4a", device: "d1");
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "Pro Monthly", 1000, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        var payment = PaymentTransaction.Create(ada, plan.Id, PaymentProvider.Paystack, "idem-1", "ref-1", 1000, "USD", h.Clock.UtcNow);
        payment.MarkFailed("Card declined", h.Clock.UtcNow);
        h.Db.PaymentTransactions.Add(payment);
        await h.Db.SaveChangesAsync();

        // Someone else's browser must not leak in.
        await events.Handle(new RecordWebEventsCommand("v2", "s9", [new WebEventInput("pageview", null, "/", null, null, "mobile", null)], "d2"), default);

        h.Clock.UtcNow = Now;
        var journey = (await new GetJourneyQueryHandler(h.Db, h.Clock).Handle(new GetJourneyQuery(UserId: ada), default)).Value;

        Assert.Contains("v1", journey.VisitorIds);
        Assert.Contains("d1", journey.DeviceHashes);
        Assert.Equal(2, journey.Sessions);
        var types = journey.Items.Select(i => i.Type).ToList();
        Assert.Contains("pageview", types);      // the anonymous visit before the account existed
        Assert.Contains("signup", types);
        Assert.Contains("transcription", types);
        Assert.Contains("payment", types);
        Assert.Equal("error", journey.Items.Single(i => i.Title == CheckoutSteps.Failed).Tone);
        Assert.Equal("BILLING_PROVIDER_DOWN (502)", journey.Items.Single(i => i.Title == CheckoutSteps.Failed).Detail);
        Assert.Equal("error", journey.Items.Single(i => i.Type == "payment").Tone);
        Assert.DoesNotContain(journey.Items, i => i.SessionId == "s9");
        Assert.Equal(journey.Items.OrderByDescending(i => i.AtUtc).Select(i => i.AtUtc), journey.Items.Select(i => i.AtUtc));

        // The same device, looked up anonymously, names the account it was seen signed in as.
        var byDevice = (await new GetJourneyQueryHandler(h.Db, h.Clock).Handle(new GetJourneyQuery(Device: "d1"), default)).Value;
        Assert.Equal([ada], byDevice.OtherAccounts);
        Assert.Contains(byDevice.Items, i => i.Type == "payment");
    }

    [Fact]
    public async Task The_checkout_funnel_counts_sessions_per_step_and_lists_the_problems()
    {
        using var h = new TestHarness(Now.AddHours(-1));
        var ada = Signup(h, "ada@example.com", "Ada");
        var anon = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock);
        var signedIn = new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(ada), h.Clock);
        static WebEventInput A(string name, string? detail = null) => new("action", name, "/app", null, null, "desktop", null, detail);

        await anon.Handle(new RecordWebEventsCommand("v1", "s1", [A(CheckoutSteps.PlansViewed), A(CheckoutSteps.ChoseSignedOut)]), default);
        await signedIn.Handle(new RecordWebEventsCommand("v2", "s2",
            [A(CheckoutSteps.PlansViewed), A(CheckoutSteps.Started), A(CheckoutSteps.Failed, "HTTP 500"), A(CheckoutSteps.Started), A(CheckoutSteps.Failed, "HTTP 500")]), default);
        await signedIn.Handle(new RecordWebEventsCommand("v2", "s3",
            [A(CheckoutSteps.Started), A(CheckoutSteps.Opened, "paystack"), A(CheckoutSteps.Confirmed), A(CheckoutSteps.PageError, "TypeError: x is undefined")]), default);
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "Pro Monthly", 1000, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        var failed = PaymentTransaction.Create(ada, plan.Id, PaymentProvider.Paystack, "i1", "r1", 1000, "USD", h.Clock.UtcNow);
        failed.MarkFailed("Card declined", h.Clock.UtcNow);
        h.Db.PaymentTransactions.AddRange(failed, PaymentTransaction.Create(ada, plan.Id, PaymentProvider.Paystack, "i2", "r2", 1000, "USD", h.Clock.UtcNow));
        await h.Db.SaveChangesAsync();

        h.Clock.UtcNow = Now;
        var funnel = (await new GetCheckoutFunnelQueryHandler(h.Db, h.Clock).Handle(new GetCheckoutFunnelQuery(), default)).Value;

        int Sessions(string step) => funnel.Steps.Single(s => s.Step == step).Sessions;
        Assert.Equal(2, Sessions(CheckoutSteps.PlansViewed));
        Assert.Equal(1, Sessions(CheckoutSteps.ChoseSignedOut));
        Assert.Equal(2, Sessions(CheckoutSteps.Started));
        Assert.Equal(3, funnel.Steps.Single(s => s.Step == CheckoutSteps.Started).Events);
        Assert.Equal(1, Sessions(CheckoutSteps.Opened));
        Assert.Equal(1, Sessions(CheckoutSteps.Failed));
        Assert.Equal(("HTTP 500", 2), (funnel.ErrorCodes[0].Label, funnel.ErrorCodes[0].Count));
        Assert.Equal("TypeError: x is undefined", Assert.Single(funnel.PageErrors).Label);
        Assert.Equal(2, funnel.PaymentsByStatus.Sum(s => s.Count));
        Assert.Equal("Card declined", Assert.Single(funnel.FailureReasons).Label);
        Assert.Contains(funnel.RecentProblems, p => p.Source == "provider" && p.Detail == "Card declined" && p.UserEmail == "ada@example.com");
        Assert.Equal(2, funnel.RecentProblems.Count(p => p.Problem == CheckoutSteps.Failed));
    }

    [Fact]
    public async Task Only_actions_keep_a_detail_and_the_device_hash_is_stored()
    {
        using var h = new TestHarness(Now);
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock).Handle(new RecordWebEventsCommand("v", "s",
        [
            new WebEventInput("pageview", null, "/", null, null, "desktop", null, "ignored"),
            new WebEventInput("action", CheckoutSteps.Failed, "/", null, null, "desktop", null, new string('x', 400)),
        ], "dev-hash"), default);

        Assert.Null(h.Db.WebEvents.Single(e => e.Kind == WebEvent.Pageview).Detail);
        Assert.Equal(WebEvent.DetailMaxLength, h.Db.WebEvents.Single(e => e.Kind == WebEvent.Action).Detail!.Length);
        Assert.All(h.Db.WebEvents, e => Assert.Equal("dev-hash", e.DeviceHash));
    }

    [Fact]
    public async Task Activity_older_than_180_days_is_deleted_and_newer_is_kept()
    {
        using var h = new TestHarness(Now.AddDays(-181));
        var ada = Signup(h, "ada@example.com", "Ada");
        await Upload(h, ada, new FakeApi(), "old.m4a");
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock)
            .Handle(new RecordWebEventsCommand("v", "s", [new WebEventInput("pageview", null, "/old", null, null, "desktop", null)]), default);

        h.Clock.UtcNow = Now.AddDays(-179);
        await Upload(h, ada, new FakeApi(), "new.m4a");
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock)
            .Handle(new RecordWebEventsCommand("v", "s", [new WebEventInput("pageview", null, "/new", null, null, "desktop", null)]), default);

        h.Clock.UtcNow = Now;
        var purged = (await new PurgeOldActivityCommandHandler(h.Db, h.Clock).Handle(new PurgeOldActivityCommand(), default)).Value;

        Assert.Equal((1, 1), (purged.WebEvents, purged.TranscriptionLogs));
        h.Db.ChangeTracker.Clear();
        Assert.Equal("new.m4a", Assert.Single(h.Db.TranscriptionLogs).FileName);
        Assert.Equal("/new", Assert.Single(h.Db.WebEvents).Path);
    }

    [Fact]
    public async Task The_full_feed_merges_every_source_newest_first_pages_and_filters()
    {
        using var h = new TestHarness(Now.AddHours(-3));
        var ada = Signup(h, "ada@example.com", "Ada Lovelace");                       // -3h signup
        h.Clock.UtcNow = Now.AddHours(-2);
        await Upload(h, ada, new FakeApi { RefuseSubmit = true }, "broken.m4a");      // -2h refused transcription
        h.Clock.UtcNow = Now.AddHours(-1);
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(ada), h.Clock).Handle(new RecordWebEventsCommand("v", "s",
            [new WebEventInput("action", "Shared sheet", "/app", null, null, "desktop", null)]), default); // -1h action
        await new RecordWebEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock).Handle(new RecordWebEventsCommand("v2", "s2",
            [new WebEventInput("action", "Preview started", "/", null, null, "desktop", null)]), default); // anonymous: not in the feed

        var handler = new GetActivityFeedQueryHandler(h.Db);
        var all = (await handler.Handle(new GetActivityFeedQuery(), default)).Value;

        Assert.Equal(["action", "transcription", "signup"], all.Items.Select(i => i.Kind));
        Assert.Equal(3, all.TotalCount);
        Assert.All(all.Items, i => Assert.Equal("Ada Lovelace", i.UserName));
        Assert.Equal("error", all.Items.Single(i => i.Kind == "transcription").Tone);
        Assert.StartsWith("refused", all.Items.Single(i => i.Kind == "transcription").Detail);

        var page2 = (await handler.Handle(new GetActivityFeedQuery(Page: 2, PageSize: 2), default)).Value;
        Assert.Equal("signup", Assert.Single(page2.Items).Kind);

        var onlyActions = (await handler.Handle(new GetActivityFeedQuery(Kind: "action"), default)).Value;
        Assert.Equal("Shared sheet", Assert.Single(onlyActions.Items).Title);
    }

    private static Task<Result<string>> Upload(
        TestHarness h, Guid user, FakeApi api, string fileName, string? contentType = "audio/mp4", long? size = 1234, string? device = null)
        => new SubmitTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user), h.Clock, new StubDeviceFingerprint(device), h.DeviceRegister, h.Activity(user, device), h.QuotaGate)
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), fileName, TranscriptionMode.Melody, null, null,
                ContentType: contentType, SizeBytes: size), default);

    private static Task<Result<Application.Activity.Dtos.TranscriptionLogPageDto>> Log(TestHarness h, GetTranscriptionLogQuery query)
        => new GetTranscriptionLogQueryHandler(h.Db).Handle(query, default);

    private static Guid Signup(TestHarness h, string email, string name)
    {
        var user = User.Create(name, email, "hash", h.Clock.UtcNow);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user.Id;
    }

    /// <summary>A worker that accepts everything (unless told to refuse) and reports each job as set in <see cref="Outcomes"/>.</summary>
    private sealed class FakeApi : ITranscriptionApi
    {
        private int _next;
        public bool RefuseSubmit { get; init; }
        public Dictionary<string, TranscriptionStatus> Outcomes { get; } = [];

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => Task.FromResult(RefuseSubmit
                ? Result.Failure<string>(Error.Failure("Worker.Rejected", "The file could not be read."))
                : Result<string>.Success($"job-{Guid.NewGuid():N}-{++_next}"));

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(score, fileName, options, ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(Stream.Null, url, options, ct);

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            var status = Outcomes.GetValueOrDefault(jobId, TranscriptionStatus.Pending);
            var result = status == TranscriptionStatus.Done
                ? new TranscriptionResultDto("G major", 0.9, 96, "4/4", "<score/>", "", [new NoteEventDto(67, 0, 1, 1, "d", "", 0.9), new NoteEventDto(69, 1, 1, 2, "r", "", 0.9)], ["s l"], 0.8,
                    SongDurationSec: 42.5)
                : null;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(
                jobId, status, status == TranscriptionStatus.Pending ? 0.5 : 1, result,
                status == TranscriptionStatus.Failed ? "Too quiet to hear any notes." : null)));
        }

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
