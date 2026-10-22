using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The one-song purchase: a free account that has spent its three buys exactly one more transcription,
/// with no membership. What it must do — raise that account's allowance by one, forever, once per payment,
/// spent like a free one (on success only) and good for a whole linked song — and what it must not: start
/// or extend Pro, count as recurring revenue, or be sold to someone who already has Pro.
/// </summary>
public class OneSongPurchaseTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);
    private const string Link = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    // ---------------------------------------------------------------- fulfilment

    [Fact]
    public async Task A_paid_one_song_checkout_adds_one_transcription_and_no_membership()
    {
        using var h = new TestHarness(Now);
        var (user, _, tx) = SeedPurchase(h);

        await Fulfil(h, tx);

        Assert.Empty(h.Db.Subscriptions);
        var entry = Assert.Single(h.Db.LedgerEntries);
        Assert.Equal(LedgerEntryReason.TranscriptionPurchase, entry.Reason);
        Assert.Equal(150_000, entry.AmountMinor);
        Assert.Equal(PaymentStatus.Completed, h.Db.PaymentTransactions.Single().Status);
        Assert.Equal(1, await TrialUsage.CountBoughtAsync(h.Db, user.Id));

        // The receipt is for one song, not "You're on Pro".
        var receipt = Assert.Single(h.Email.Receipts);
        Assert.True(receipt.OneTranscription);
        Assert.Null(receipt.RenewsAtUtc);
    }

    [Fact]
    public async Task A_payment_fulfilled_twice_grants_one_transcription()
    {
        // The webhook and the reconciliation sweep both arrive for one payment: the second is a no-op.
        using var h = new TestHarness(Now);
        var (user, _, tx) = SeedPurchase(h);

        await Fulfil(h, tx, "evt_1");
        await Fulfil(h, tx, "evt_2");

        Assert.Single(h.Db.LedgerEntries);
        Assert.Equal(1, await TrialUsage.CountBoughtAsync(h.Db, user.Id));
    }

    // ---------------------------------------------------------------- the free-tier gate

    [Fact]
    public async Task A_bought_transcription_lets_a_spent_account_submit_exactly_once_more()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Spend(h, user, 3);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", (await SubmitUpload(h, user, new FakeApi())).Error.Code);

        Buy(h, user);
        var api = new FakeApi();
        var shown = await Shown(h, user);
        Assert.Equal(1, shown.TrialGenerationsRemaining);
        Assert.Equal(4, shown.TrialGenerationsTotal);
        Assert.Equal(1, shown.BoughtTranscriptionsRemaining);
        Assert.Equal(1, shown.BoughtTranscriptionsTotal);

        var jobId = (await SubmitUpload(h, user, api)).Value;
        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);

        var after = await Shown(h, user);
        Assert.Equal(0, after.TrialGenerationsRemaining);
        Assert.Equal(0, after.BoughtTranscriptionsRemaining);
        var refused = await SubmitUpload(h, user, api);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", refused.Error.Code);
        Assert.Contains("the 1 you bought", refused.Error.Message);
    }

    [Fact]
    public async Task A_bought_transcription_pays_for_a_song_upload_and_leaves_the_free_week_alone()
    {
        // A song with the voice isolated is not one of the free weekly hums: a bought one pays for it even
        // while free ones are left, and those stay for the week's hums.
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Buy(h, user);
        var api = new FakeApi();

        var jobId = (await SubmitUpload(h, user, api, separate: true)).Value;
        var job = h.Db.TranscriptionJobs.Single();
        Assert.True(job.PaidByCredit);
        Assert.Equal(TranscriptionJobKind.Upload, job.Kind);
        Assert.True(api.LastOptions!.Separate);

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);

        var shown = await Shown(h, user);
        Assert.Equal(0, shown.BoughtTranscriptionsRemaining);
        Assert.Equal(3, shown.FreeTranscriptionsRemaining);
        Assert.Equal("BILLING_SONG_NOT_FREE", (await SubmitUpload(h, user, api, separate: true)).Error.Code);
    }

    [Fact]
    public async Task Free_ones_go_first_and_only_the_job_after_them_spends_the_bought_one()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Spend(h, user, 2);
        Buy(h, user);
        var api = new FakeApi();

        await SubmitUpload(h, user, api);
        Assert.False(h.Db.TranscriptionJobs.Single(j => j.JobId == "job-1").PaidByCredit);
        Assert.Equal(1, (await Shown(h, user)).BoughtTranscriptionsRemaining);

        await SubmitUpload(h, user, api);
        Assert.True(h.Db.TranscriptionJobs.Single(j => j.JobId == "job-2").PaidByCredit);
        Assert.Equal(0, (await Shown(h, user)).BoughtTranscriptionsRemaining);
    }

    [Fact]
    public async Task A_purchase_is_never_used_up_by_another_account_on_the_same_phone()
    {
        // Two accounts on one handset share the free three (that is the device rule), but each one's
        // purchases are its own: the second account buying and using a song must not spend the first's.
        using var h = new TestHarness(Now);
        var first = SeedUser(h);
        var second = User.Create("Ben Singer", "ben@example.com", h.Hasher.Hash("password123"), Now.AddDays(-3));
        second.RecordCountry("NG");
        h.Db.Users.Add(second);
        h.Db.SaveChanges();
        const string phone = "shared-phone";
        for (var i = 0; i < 3; i++)
        {
            var job = TranscriptionJob.Record($"first-{i}", first.Id, Now.AddDays(-1), phone); // earlier this free week
            job.ConsumeTrial(Now.AddDays(-1));
            h.Db.TranscriptionJobs.Add(job);
        }
        h.Db.SaveChanges();

        Buy(h, second);
        var api = new FakeApi();
        var secondsJob = await SubmitUpload(h, second, api, device: phone);
        Assert.True(secondsJob.IsSuccess);
        api.Status = TranscriptionStatus.Done;
        await Poll(h, second, secondsJob.Value, api);

        Buy(h, first);
        api.Status = TranscriptionStatus.Pending;
        Assert.Equal(1, (await Shown(h, first, phone)).BoughtTranscriptionsRemaining);
        Assert.True((await SubmitUpload(h, first, api, device: phone)).IsSuccess);
    }

    [Fact]
    public async Task A_bought_transcription_that_fails_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Spend(h, user, 3);
        Buy(h, user);
        var api = new FakeApi();

        var jobId = (await SubmitUpload(h, user, api)).Value;
        api.Status = TranscriptionStatus.Failed;
        await Poll(h, user, jobId, api);

        Assert.Equal(1, (await Shown(h, user)).BoughtTranscriptionsRemaining);
        Assert.True((await SubmitUpload(h, user, api)).IsSuccess);
    }

    [Fact]
    public async Task A_bought_transcription_covers_a_song_with_the_voice_isolated()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Spend(h, user, 3);
        Buy(h, user);
        var api = new FakeApi();

        var result = await SubmitUpload(h, user, api, separate: true);

        Assert.True(result.IsSuccess);
        Assert.True(api.LastOptions!.Separate);
        Assert.Equal(SongCredits.ProMaxSeconds, api.LastOptions.MaxSeconds); // the whole song, as a linked one
    }

    [Fact]
    public async Task Bought_transcriptions_never_expire()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Spend(h, user, 3);
        Buy(h, user, at: Now.AddYears(-2));

        Assert.Equal(1, (await Shown(h, user)).BoughtTranscriptionsRemaining);
        Assert.True((await SubmitUpload(h, user, new FakeApi())).IsSuccess);
    }

    // ---------------------------------------------------------------- a whole linked song

    [Fact]
    public async Task A_bought_transcription_pays_for_a_whole_linked_song_after_the_preview_is_gone()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Spend(h, user, 3);
        SpendPreview(h, user);
        var api = new FakeApi();
        Assert.Equal("BILLING_SONG_PREVIEW_USED", (await SubmitLink(h, user, api)).Error.Code);

        Buy(h, user);
        Assert.Equal(SongCredits.ProMaxSeconds, (await LinkInfo(h, user, api)).MaxSeconds);
        var jobId = (await SubmitLink(h, user, api)).Value;

        Assert.Equal(SongCredits.ProMaxSeconds, api.LastOptions!.MaxSeconds);
        Assert.Equal(TranscribePriority.Normal, api.LastOptions.Priority); // the fast lane stays Pro's
        var job = h.Db.TranscriptionJobs.Single(j => j.JobId == jobId);
        Assert.True(job.PaidByCredit);
        Assert.Equal(0, (await Shown(h, user)).BoughtTranscriptionsRemaining); // held while it runs

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);
        await Poll(h, user, jobId, api);

        // Charged to the allowance the purchase raised, once, and never as the preview.
        Assert.Equal(Now, job.TrialConsumedAtUtc);
        Assert.Null(job.SongCreditConsumedAtUtc);
        Assert.Equal(0, (await Shown(h, user)).TrialGenerationsRemaining);
        Assert.Equal("BILLING_SONG_PREVIEW_USED", (await SubmitLink(h, user, api)).Error.Code);
    }

    [Fact]
    public async Task A_bought_transcription_goes_on_the_whole_song_and_leaves_the_free_preview_for_later()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Buy(h, user);
        var api = new FakeApi();

        var paid = await SubmitLink(h, user, api);
        Assert.Equal(SongCredits.ProMaxSeconds, api.LastOptions!.MaxSeconds);
        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, paid.Value, api);

        // The bought one is gone; the free ones and the preview are not.
        var shown = await Shown(h, user);
        Assert.Equal(0, shown.BoughtTranscriptionsRemaining);
        Assert.Equal(3, shown.TrialGenerationsRemaining);
        Assert.Equal(SongCredits.FreePreviews, shown.SongCreditsRemaining);

        api.Status = TranscriptionStatus.Pending;
        Assert.True((await SubmitLink(h, user, api)).IsSuccess);
        Assert.Equal(SongCredits.FreePreviewSeconds, api.LastOptions.MaxSeconds);
    }

    [Fact]
    public async Task Free_transcriptions_alone_never_pay_for_a_whole_song()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        var api = new FakeApi();

        Assert.Equal(SongCredits.FreePreviewSeconds, (await LinkInfo(h, user, api)).MaxSeconds);
        await SubmitLink(h, user, api);

        Assert.Equal(SongCredits.FreePreviewSeconds, api.LastOptions!.MaxSeconds);
        Assert.False(h.Db.TranscriptionJobs.Single().PaidByCredit);
    }

    // ---------------------------------------------------------------- not for Pro

    [Fact]
    public async Task A_pro_member_is_not_offered_or_sold_the_one_song_purchase()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        var single = Plan.Create(Guid.NewGuid(), "one_song_ngn", "One song", 150_000, "NGN", BillingInterval.Single);
        var monthly = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.AddRange(single, monthly);
        h.Db.SaveChanges();

        // Free: offered, at its own list beside Pro.
        Assert.Contains(await Plans(h, user, single: true), p => p.Interval == BillingInterval.Single);

        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, monthly.Id, PaymentProvider.Paystack, Now.AddDays(-1), Now.AddDays(29), null, Now.AddDays(-1)));
        h.Db.SaveChanges();

        Assert.Empty(await Plans(h, user, single: true));
        var gateway = new FakeGateway();
        var result = await new InitiateCheckoutCommandHandler(
                h.Db, new StubCurrentUser(user.Id), gateway, h.Clock, new BillingSettings(), h.Email)
            .Handle(new InitiateCheckoutCommand(single.Id), default);
        Assert.Equal("BILLING_SINGLE_NOT_NEEDED", result.Error.Code);
        Assert.Empty(h.Db.PaymentTransactions);
    }

    [Fact]
    public async Task The_one_song_purchase_is_listed_apart_from_the_pro_plans()
    {
        // Older web pages and app builds label every plan in the main list that is not yearly "Monthly … a
        // month": a one-song purchase there was shown as ₦1,500 a month of Pro. Only its own list carries it.
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        h.Country.Country = "NG";
        h.Db.Plans.AddRange(
            Plan.Create(Guid.NewGuid(), "one_song_ngn", "One song", 150_000, "NGN", BillingInterval.Single),
            Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "pro_yearly_ngn", "NoteFusion Pro (Yearly)", 6_000_000, "NGN", BillingInterval.Yearly));
        h.Db.SaveChanges();

        var main = await Plans(h, user);
        var single = await Plans(h, user, single: true);
        var choir = (await new GetPlansQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new GetPlansQuery(Choir: true, Single: true), default)).Value;
        var pub = (await new GetPublicPricingQueryHandler(h.Db, h.Country).Handle(new GetPublicPricingQuery(), default)).Value;

        Assert.Equal(new[] { "pro_monthly_ngn", "pro_yearly_ngn" }, main.Select(p => p.Code).Order().ToArray());
        Assert.Equal("one_song_ngn", Assert.Single(single).Code);
        Assert.Empty(choir);
        Assert.DoesNotContain(pub.Plans, p => p.Interval == BillingInterval.Single);
        Assert.Equal("one_song_ngn", pub.Single?.Code); // apart, for the free card's "or ₦1,500 a song"
    }

    [Fact]
    public async Task A_free_account_can_open_a_one_song_checkout()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        var single = Plan.Create(Guid.NewGuid(), "one_song_ngn", "One song", 150_000, "NGN", BillingInterval.Single);
        h.Db.Plans.Add(single);
        h.Db.SaveChanges();

        var result = await new InitiateCheckoutCommandHandler(
                h.Db, new StubCurrentUser(user.Id), new FakeGateway(), h.Clock, new BillingSettings(), h.Email)
            .Handle(new InitiateCheckoutCommand(single.Id), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(150_000, h.Db.PaymentTransactions.Single().AmountMinor);
    }

    // ---------------------------------------------------------------- the dashboard

    [Fact]
    public async Task One_song_money_is_revenue_collected_but_never_run_rate()
    {
        using var h = new TestHarness(Now);
        var user = SeedUser(h);
        Buy(h, user, at: Now.AddDays(-1));
        h.Db.SaveChanges();

        var overview = await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default);

        Assert.True(overview.IsSuccess);
        var m = overview.Value.Membership;
        Assert.Equal([("NGN", 150_000L)], m.Revenue.Select(r => (r.Currency, r.AmountMinor)));
        Assert.Empty(m.MonthlyRunRate);
        Assert.Equal(0, m.ActiveMembers);
    }

    // ---------------------------------------------------------------- fixtures

    private static User SeedUser(TestHarness h, string country = "NG")
    {
        var user = User.Create("Ada Singer", "ada@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        user.RecordCountry(country);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static (User User, Plan Plan, PaymentTransaction Transaction) SeedPurchase(TestHarness h)
    {
        var user = SeedUser(h);
        var plan = Plan.Create(Guid.NewGuid(), "one_song_ngn", "One song", 150_000, "NGN", BillingInterval.Single);
        var tx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Paystack, "checkout:NF_song", "NF_song", 150_000, "NGN", Now.AddMinutes(-5));
        tx.AttachCheckout("ps_song", "https://checkout.paystack.com/x", "{}", Now.AddMinutes(-5));
        h.Db.Plans.Add(plan);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        return (user, plan, tx);
    }

    /// <summary>Drives fulfilment the way production does: through the webhook handler.</summary>
    private static async Task Fulfil(TestHarness h, PaymentTransaction tx, string eventId = "evt_paid")
    {
        var e = WebhookEvent.Receive(PaymentProvider.Paystack, eventId, "charge.success", tx.Reference, "{}", Now);
        h.Db.WebhookEvents.Add(e);
        await h.Db.SaveChangesAsync();

        var verification = new GatewayVerification(
            Succeeded: true, AmountMinor: tx.AmountMinor, Currency: tx.Currency, ProviderReference: "ps_song",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true);

        var result = await new ProcessWebhookEventCommandHandler(h.Db, new FakeGateway(verification), h.Clock, h.Email)
            .Handle(new ProcessWebhookEventCommand(e.Id), default);
        Assert.True(result.IsSuccess);
    }

    /// <summary>A fulfilled one-song purchase, as the ledger records it.</summary>
    private static void Buy(TestHarness h, User user, DateTime? at = null)
    {
        var when = at ?? Now.AddMinutes(-1);
        var reference = $"NF_{Guid.NewGuid():N}";
        var tx = PaymentTransaction.Create(user.Id, Guid.NewGuid(), PaymentProvider.Paystack, $"checkout:{reference}", reference, 150_000, "NGN", when);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.LedgerEntries.Add(LedgerEntry.Create(
            user.Id, tx.Id, LedgerDirection.Credit, LedgerEntryReason.TranscriptionPurchase, 150_000, "NGN", "One song", when));
        h.Db.SaveChanges();
    }

    private static void Spend(TestHarness h, User user, int count)
    {
        for (var i = 0; i < count; i++)
        {
            var job = TranscriptionJob.Record($"spent-{i}", user.Id, Now.AddDays(-1)); // earlier this free week
            job.ConsumeTrial(Now.AddDays(-1));
            h.Db.TranscriptionJobs.Add(job);
        }
        h.Db.SaveChanges();
    }

    private static void SpendPreview(TestHarness h, User user)
    {
        var job = TranscriptionJob.RecordLink("preview", user.Id, Now.AddDays(-5), null, wasPro: false);
        job.ConsumeSongCredit(Now.AddDays(-5));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
    }

    private static Task<Result<string>> SubmitUpload(
        TestHarness h, User user, FakeApi api, bool separate = false, string? device = null)
        => new SubmitTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(device), h.DeviceRegister,
                h.Activity(user.Id), h.QuotaGate)
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "song.m4a", TranscriptionMode.Melody, null, null, Separate: separate),
                default);

    private static Task<Result<string>> SubmitLink(TestHarness h, User user, FakeApi api)
        => new SubmitLinkTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.Activity(user.Id), h.QuotaGate)
            .Handle(new SubmitLinkTranscriptionCommand(Link, TranscriptionMode.Melody, null, null), default);

    private static async Task<LinkInfoDto> LinkInfo(TestHarness h, User user, FakeApi api)
        => (await new GetLinkInfoQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null))
            .Handle(new GetLinkInfoQuery(Link), default)).Value;

    private static Task<Result<TranscriptionJobDto>> Poll(TestHarness h, User user, string jobId, FakeApi api)
        => new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock, h.QuotaGate, h.Backing)
            .Handle(new GetTranscriptionJobQuery(jobId), default);

    private static async Task<SubscriptionDto> Shown(TestHarness h, User user, string? device = null)
        => (await new GetMySubscriptionQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(device))
            .Handle(new GetMySubscriptionQuery(), default)).Value;

    private static async Task<IReadOnlyList<PlanDto>> Plans(TestHarness h, User user, bool single = false)
        => (await new GetPlansQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock).Handle(new GetPlansQuery(Single: single), default)).Value;

    /// <summary>A gateway that opens every checkout and confirms every payment with the given answer.</summary>
    private sealed class FakeGateway : IPaymentGatewayFactory, IPaymentGateway
    {
        private readonly GatewayVerification? _answer;

        public FakeGateway(GatewayVerification? answer = null) => _answer = answer;

        public PaymentProvider Provider => PaymentProvider.Paystack;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["NGN", "USD"];
        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(new GatewayInitiation("https://checkout.paystack.com/s", "ps_1", "{}")));

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(_answer!));
    }

    /// <summary>Stands in for the worker; the status is the test's to set.</summary>
    private sealed class FakeApi : ITranscriptionApi
    {
        private int _next;

        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Pending;
        public TranscribeOptions? LastOptions { get; private set; }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
        {
            LastOptions = options;
            return Task.FromResult(Result<string>.Success($"job-{++_next}"));
        }

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(score, fileName, options, ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(Stream.Null, url, options, ct);

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            var result = Status == TranscriptionStatus.Done
                ? new TranscriptionResultDto("C major", 0.9, 100, "4/4", "<score/>", "", [], ["d r m"], 0.8)
                : null;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, Status == TranscriptionStatus.Done ? 1 : 0.5, result,
                    Status == TranscriptionStatus.Failed ? "Could not transcribe." : null)));
        }

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<NoteFusion.Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, double? maxTakeSeconds = null, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
