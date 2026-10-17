using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// One free allowance per inbox. <c>you+1@gmail.com</c>, <c>y.o.u@gmail.com</c> and <c>you@googlemail.com</c>
/// all deliver to <c>you@gmail.com</c>, so each passes email verification through the same mailbox; with a
/// private window for a new device id, each used to be three more free transcriptions. The three are now
/// shared by every account on the inbox, as they already were by every account on a handset. Nobody is
/// refused an account: an alias signs up and signs in, and finds the free ones gone.
/// </summary>
public class MailboxQuotaTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);
    private const string Link = "https://youtu.be/dQw4w9WgXcQ";

    [Theory]
    [InlineData("you@gmail.com", "you+2@gmail.com")]
    [InlineData("you@gmail.com", "y.o.u@gmail.com")]
    [InlineData("you@gmail.com", "you@googlemail.com")]
    [InlineData("you+1@example.com", "you+2@example.com")]
    [InlineData("you@example.com", "YOU+free@example.com")]
    public async Task An_alias_shares_the_inbox_s_three_even_on_another_device(string first, string alias)
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, first);
        var b = Seed(h, alias);
        Spend(h, a, 3, "phone-a");

        var result = await Submit(h, b, device: "private-window");

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
        Assert.Equal("You have used all 3 of your free transcriptions. Buy just this song, or upgrade to Pro for unlimited transcriptions.",
            result.Error.Message);
        Assert.Equal(0, await Remaining(h, b, "private-window"));
    }

    [Fact]
    public async Task The_three_are_shared_not_tripled_one_each_across_three_aliases()
    {
        using var h = new TestHarness(Now);
        var api = new FakeTranscriptionApi();
        var accounts = new[] { Seed(h, "you@gmail.com"), Seed(h, "you+1@gmail.com"), Seed(h, "y.ou@gmail.com"), Seed(h, "you@googlemail.com") };

        var results = new List<Result<string>>();
        for (var i = 0; i < accounts.Length; i++)
            results.Add(await Submit(h, accounts[i], api, device: $"window-{i}"));

        Assert.Equal(3, results.Count(r => r.IsSuccess));
        Assert.Equal("BILLING_FREE_TIER_LIMIT", results[^1].Error.Code);
    }

    [Fact]
    public async Task One_job_seen_through_both_the_inbox_and_the_handset_counts_once()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "you@gmail.com");
        var b = Seed(h, "you+2@gmail.com");
        Spend(h, a, 1, "phone-a");

        // The job is the inbox's and the handset's: one transcription, not two.
        Assert.Equal(2, await Remaining(h, b, "phone-a"));
    }

    [Fact]
    public async Task Dots_are_one_inbox_only_on_gmail()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "you@example.com");
        var b = Seed(h, "y.ou@example.com");
        Spend(h, a, 3, "phone-a");

        // Off Gmail a dot can be a different person, so this is somebody else's three.
        Assert.Equal(3, await Remaining(h, b, "phone-b"));
        Assert.True((await Submit(h, b, device: "phone-b")).IsSuccess);
    }

    [Fact]
    public async Task A_running_job_on_one_alias_holds_its_place_for_the_other()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "you@gmail.com");
        var b = Seed(h, "you+2@gmail.com");
        Spend(h, a, 2, "phone-a");
        var api = new FakeTranscriptionApi();
        Assert.True((await Submit(h, a, api, device: "phone-a")).IsSuccess); // still running, not yet charged

        Assert.Equal("BILLING_FREE_TIER_LIMIT", (await Submit(h, b, api, device: "phone-b")).Error.Code);
    }

    [Fact]
    public async Task Bought_transcriptions_stay_with_the_account_that_paid()
    {
        using var h = new TestHarness(Now);
        var buyer = Seed(h, "you@gmail.com");
        var alias = Seed(h, "you+2@gmail.com");
        Spend(h, buyer, 3, "phone-a");
        Buy(h, buyer);

        Assert.True((await Submit(h, buyer, device: "phone-a")).IsSuccess);
        Assert.True(h.Db.TranscriptionJobs.Single(j => j.UserId == buyer.Id && j.TrialConsumedAtUtc == null).PaidByCredit);
        // The alias shares the inbox's free ones, never the purchase.
        Assert.Equal("BILLING_FREE_TIER_LIMIT", (await Submit(h, alias, device: "phone-b")).Error.Code);
    }

    [Fact]
    public async Task Pro_on_an_alias_is_not_metered()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "you@gmail.com");
        var b = Seed(h, "you+pro@gmail.com");
        Spend(h, a, 3, "phone-a");
        GoPro(h, b);

        Assert.True((await Submit(h, b, device: "phone-b")).IsSuccess);
    }

    [Fact]
    public async Task The_free_link_preview_is_one_per_inbox()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "you@gmail.com");
        var b = Seed(h, "y.o.u+2@gmail.com");
        var api = new FakeTranscriptionApi();
        Assert.True((await SubmitLink(h, a, api, "phone-a")).IsSuccess);

        var result = await SubmitLink(h, b, api, "phone-b");

        Assert.Equal("BILLING_SONG_PREVIEW_USED", result.Error.Code);
    }

    [Fact]
    public async Task An_alias_signs_up_and_both_old_accounts_on_one_inbox_still_sign_in()
    {
        using var h = new TestHarness(Now);
        // Two accounts made before the inbox was counted, on one mailbox. Neither is locked out or merged.
        foreach (var email in new[] { "you@gmail.com", "y.o.u@gmail.com" })
        {
            var user = User.Create("You", email, h.Hasher.Hash("password123"), Now.AddDays(-90));
            h.MarkEmailVerified(user);
            h.Db.Users.Add(user);
        }
        h.Db.SaveChanges();

        var login = new LoginCommandHandler(h.Db, h.Hasher, h.TokenIssuer, h.Tokens, h.Clock, h.Country, h.Email);
        Assert.True((await login.Handle(new LoginCommand("you@gmail.com", "password123"), default)).IsSuccess);
        Assert.True((await login.Handle(new LoginCommand("y.o.u@gmail.com", "password123"), default)).IsSuccess);

        // And a third alias is still a new account, with its own address.
        var registered = await new RegisterCommandHandler(h.Db, h.Hasher, h.Tokens, h.Clock, h.Email, h.Country)
            .Handle(new RegisterCommand("You", "you+3@gmail.com", "password123"), default);
        Assert.True(registered.IsSuccess);
        Assert.Equal(3, h.Db.Users.Count(u => u.CanonicalEmail == "you@gmail.com"));
    }

    [Fact]
    public async Task The_admin_page_shows_the_inbox_and_who_shares_it()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "you@gmail.com");
        Seed(h, "you+2@gmail.com");
        Seed(h, "someone@gmail.com");

        var detail = (await new GetUserAccountQueryHandler(h.Db, h.Clock)
            .Handle(new GetUserAccountQuery(a.Id), default)).Value;

        Assert.Equal("you@gmail.com", detail.CanonicalEmail);
        Assert.Equal(1, detail.SharedMailboxAccounts);
    }

    // ---------------------------------------------------------------- fixtures

    private static User Seed(TestHarness h, string email)
    {
        var user = User.Create("Free User", email, h.Hasher.Hash("password123"), Now.AddDays(-30));
        user.RecordCountry("NG");
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void GoPro(TestHarness h, User user)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    private static void Buy(TestHarness h, User user)
    {
        var tx = PaymentTransaction.Create(user.Id, Guid.NewGuid(), PaymentProvider.Paystack, "checkout:one", "one", 150_000, "NGN", Now.AddDays(-1));
        h.Db.PaymentTransactions.Add(tx);
        h.Db.LedgerEntries.Add(LedgerEntry.Create(
            user.Id, tx.Id, LedgerDirection.Credit, LedgerEntryReason.TranscriptionPurchase, 150_000, "NGN", "One song", Now.AddDays(-1)));
        h.Db.SaveChanges();
    }

    private static void Spend(TestHarness h, User user, int count, string? device)
    {
        for (var i = 0; i < count; i++)
        {
            var job = TranscriptionJob.Record($"spent-{user.Id}-{i}", user.Id, Now.AddDays(-10), device);
            job.ConsumeTrial(Now.AddDays(-10));
            h.Db.TranscriptionJobs.Add(job);
        }

        h.Db.SaveChanges();
    }

    private static Task<Result<string>> Submit(TestHarness h, User user, FakeTranscriptionApi? api = null, string? device = null)
        => new SubmitTranscriptionCommandHandler(
                api ?? new FakeTranscriptionApi(), h.Db, new StubCurrentUser(user.Id), h.Clock,
                new StubDeviceFingerprint(device), h.DeviceRegister, h.Activity(user.Id), h.QuotaGate)
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null),
                CancellationToken.None);

    private static Task<Result<string>> SubmitLink(TestHarness h, User user, FakeTranscriptionApi api, string? device)
        => new SubmitLinkTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(device), h.Activity(user.Id), h.QuotaGate)
            .Handle(new SubmitLinkTranscriptionCommand(Link, TranscriptionMode.Melody, null, null), CancellationToken.None);

    private static async Task<int> Remaining(TestHarness h, User user, string? device)
        => (await new GetMySubscriptionQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(device))
            .Handle(new GetMySubscriptionQuery(), CancellationToken.None)).Value.TrialGenerationsRemaining;

    private sealed class FakeTranscriptionApi : ITranscriptionApi
    {
        private int _next;

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => Task.FromResult(Result<string>.Success($"job-{++_next}"));

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(score, fileName, options, ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(Stream.Null, url, options, ct);

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
            => Task.FromResult(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(jobId, TranscriptionStatus.Pending, 0, null)));

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<NoteFusion.Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, double? maxTakeSeconds = null, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
