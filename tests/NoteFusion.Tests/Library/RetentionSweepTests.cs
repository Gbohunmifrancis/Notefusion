using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Library;

/// <summary>
/// The two retention sweeps: finished transcriptions nobody saved are kept in the library, and an
/// unfinished Pro checkout gets one reminder email.
/// </summary>
public class RetentionSweepTests
{
    private static readonly DateTime Now = new(2026, 10, 13, 12, 0, 0, DateTimeKind.Utc);

    // ── Keeping unsaved sheets ───────────────────────────────────────────────

    [Fact]
    public async Task An_unsaved_finished_job_is_kept_once_after_half_an_hour_and_a_deleted_sheet_stays_deleted()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");
        var fresh = FinishedJob(h, ada, Now.AddMinutes(-10));
        var old = FinishedJob(h, ada, Now.AddMinutes(-45));

        Assert.Equal(1, await AutoSave(h));
        var sheet = Assert.Single(h.Db.Transcriptions);
        Assert.Equal(old.JobId, sheet.SourceJobId);
        Assert.Equal("Recording in G major · 13 Oct", sheet.Title);
        Assert.Equal(2, sheet.Notes.Count);
        Assert.Null(h.Db.TranscriptionJobs.Single(j => j.Id == fresh.Id).AutoSavedAtUtc);

        // The user deletes it: the next sweeps do not put it back, and the fresh job is kept once ready.
        h.Db.Transcriptions.Remove(sheet);
        await h.Db.SaveChangesAsync();
        h.Clock.UtcNow = Now.AddMinutes(30);
        Assert.Equal(1, await AutoSave(h));
        Assert.Equal(fresh.JobId, Assert.Single(h.Db.Transcriptions).SourceJobId);
        Assert.Equal(0, await AutoSave(h));
    }

    [Fact]
    public async Task A_job_saved_by_hand_is_not_kept_twice_and_a_linked_song_keeps_its_title()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");
        var saved = FinishedJob(h, ada, Now.AddHours(-1));
        await Save(h, ada, saved.JobId, "My own title");
        FinishedJob(h, ada, Now.AddHours(-1), new SourceDto("youtube", "https://youtu.be/x", "Amazing Grace", "Choir", null));

        Assert.Equal(1, await AutoSave(h));
        Assert.Equal(["Amazing Grace — Choir", "My own title"], h.Db.Transcriptions.Select(t => t.Title).OrderBy(t => t).ToList());
    }

    [Fact]
    public async Task Save_after_the_sweep_replaces_the_kept_copy()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");
        var job = FinishedJob(h, ada, Now.AddHours(-1));
        await AutoSave(h);

        await Save(h, ada, job.JobId, "Sunday anthem");

        Assert.Equal("Sunday anthem", Assert.Single(h.Db.Transcriptions).Title);
    }

    [Fact]
    public async Task Jobs_past_the_lookback_or_of_deleted_accounts_are_marked_but_not_kept()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");
        FinishedJob(h, ada, Now.AddDays(-20));
        var orphan = TranscriptionJob.Record("job-orphan", Guid.NewGuid(), Now.AddHours(-1));
        orphan.Settle(TranscriptionResultCache.Serialize(Result()), Now.AddHours(-1));
        h.Db.TranscriptionJobs.Add(orphan);
        await h.Db.SaveChangesAsync();

        Assert.Equal(0, await AutoSave(h));
        Assert.Empty(h.Db.Transcriptions);
        Assert.NotNull(h.Db.TranscriptionJobs.Single(j => j.JobId == "job-orphan").AutoSavedAtUtc);
    }

    // ── Reminding unfinished checkouts ───────────────────────────────────────

    [Fact]
    public async Task An_unfinished_checkout_gets_one_reminder_after_two_hours()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");
        var plan = AddPlan(h);
        Checkout(h, ada, plan, Now.AddHours(-1), failed: true);

        Assert.Equal(0, await Remind(h)); // still inside the quiet period: they may be retrying

        h.Clock.UtcNow = Now.AddHours(2);
        Assert.Equal(1, await Remind(h));
        Assert.Equal(("checkout-abandoned", "ada@example.com"), (h.Email.Sent.Single().Kind, h.Email.Sent.Single().To.Email));

        h.Clock.UtcNow = Now.AddHours(4);
        Assert.Equal(0, await Remind(h)); // once per attempt
    }

    [Fact]
    public async Task A_new_attempt_earns_another_reminder_but_not_within_a_week()
    {
        using var h = new TestHarness(Now);
        var ada = Signup(h, "ada@example.com", "Ada");
        var plan = AddPlan(h);
        Checkout(h, ada, plan, Now.AddHours(-3), failed: true);
        Assert.Equal(1, await Remind(h));

        Checkout(h, ada, plan, Now.AddDays(2), failed: true);
        h.Clock.UtcNow = Now.AddDays(2).AddHours(3);
        Assert.Equal(0, await Remind(h)); // a week has not passed

        Checkout(h, ada, plan, Now.AddDays(8), failed: true);
        h.Clock.UtcNow = Now.AddDays(8).AddHours(3);
        Assert.Equal(1, await Remind(h));
        Assert.Equal(2, h.Email.Sent.Count(s => s.Kind == "checkout-abandoned"));
    }

    [Fact]
    public async Task No_reminder_for_Pro_a_later_payment_an_old_attempt_or_a_refused_one()
    {
        using var h = new TestHarness(Now);
        var plan = AddPlan(h);

        var pro = Signup(h, "pro@example.com", "Pro");
        Checkout(h, pro, plan, Now.AddHours(-5), failed: true);
        h.Db.Subscriptions.Add(Subscription.Start(pro, plan.Id, PaymentProvider.Paystack, Now.AddDays(-1), Now.AddDays(29), "sub_1", Now));

        var paid = Signup(h, "paid@example.com", "Paid");
        Checkout(h, paid, plan, Now.AddHours(-5), failed: true);
        var later = Checkout(h, paid, plan, Now.AddHours(-4), failed: false);
        later.MarkVerified("ps_1", null, Now.AddHours(-4));
        later.MarkCompleted(Now.AddHours(-4));

        var old = Signup(h, "old@example.com", "Old");
        Checkout(h, old, plan, Now.AddDays(-4), failed: true);

        // Refused before a payment page opened: InitiateCheckoutCommand already sent "payment didn't go through".
        var refused = Signup(h, "refused@example.com", "Refused");
        Checkout(h, refused, plan, Now.AddHours(-5), failed: true, reachedCheckout: false);
        await h.Db.SaveChangesAsync();

        Assert.Equal(0, await Remind(h));
        Assert.Empty(h.Email.Sent);
    }

    [Fact]
    public async Task A_free_owners_kept_sheet_has_only_what_the_poll_gave_them()
    {
        using var h = new TestHarness(Now);
        var free = Signup(h, "free@example.com", "Free");
        var pro = Signup(h, "pro@example.com", "Pro");
        var plan = AddPlan(h);
        h.Db.Subscriptions.Add(Subscription.Start(pro, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
        var parts = new Dictionary<string, PartDto> { ["bass"] = new PartDto([new NoteEventDto(43, 0, 2, 1, "d", "", 0.9)], ["Doh is G · Bass"]) };
        var freeJob = FinishedJob(h, free, Now.AddHours(-1), parts: parts);
        var proJob = FinishedJob(h, pro, Now.AddHours(-1), parts: parts);

        Assert.Equal(2, await AutoSave(h));

        // The cached result is the worker's whole answer; the four-part harmony in it is Pro, and the poll
        // withholds it from a free account (ProGate.ForFree). Keeping the sheet must not hand it over.
        var freeSheet = h.Db.Transcriptions.Single(t => t.SourceJobId == freeJob.JobId);
        Assert.Null(freeSheet.Parts);
        Assert.Null(freeSheet.PartsMusicXml);
        Assert.Equal(2, freeSheet.Notes.Count); // the tune itself is theirs
        var proSheet = h.Db.Transcriptions.Single(t => t.SourceJobId == proJob.JobId);
        Assert.NotNull(proSheet.Parts);
        Assert.Equal("<satb/>", proSheet.PartsMusicXml);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static Task<int> AutoSave(TestHarness h)
        => new AutoSaveFinishedTranscriptionsCommandHandler(h.Db, h.Clock)
            .Handle(new AutoSaveFinishedTranscriptionsCommand(), default)
            .ContinueWith(t => t.Result.Value);

    private static Task<int> Remind(TestHarness h)
        => new RemindAbandonedCheckoutsCommandHandler(h.Db, h.Clock, h.Email)
            .Handle(new RemindAbandonedCheckoutsCommand(), default)
            .ContinueWith(t => t.Result.Value);

    private static async Task Save(TestHarness h, Guid userId, string jobId, string title)
    {
        var r = Result();
        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new SaveTranscriptionCommand(title, r.Key, r.Tempo, r.TimeSignature, r.MusicXml, r.Notes, r.OverallConfidence, jobId), default);
        Assert.True(saved.IsSuccess);
    }

    private static TranscriptionResultDto Result(SourceDto? source = null, Dictionary<string, PartDto>? parts = null)
        => new("G major", 0.9, 96, "4/4", "<score/>", "",
            [new NoteEventDto(67, 0, 1, 1, "d", "", 0.9), new NoteEventDto(69, 1, 1, 2, "r", "", 0.9)],
            ["d r"], 0.8, Source: source, Parts: parts, PartsMusicXml: parts is null ? "" : "<satb/>");

    private static TranscriptionJob FinishedJob(
        TestHarness h, Guid userId, DateTime createdAt, SourceDto? source = null, Dictionary<string, PartDto>? parts = null)
    {
        var job = TranscriptionJob.Record($"job-{Guid.NewGuid():N}", userId, createdAt);
        job.Settle(TranscriptionResultCache.Serialize(Result(source, parts)), createdAt.AddMinutes(1));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        return job;
    }

    private static Plan AddPlan(TestHarness h)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();
        return plan;
    }

    private static PaymentTransaction Checkout(TestHarness h, Guid userId, Plan plan, DateTime at, bool failed, bool reachedCheckout = true)
    {
        var id = Guid.NewGuid().ToString("N");
        var tx = PaymentTransaction.Create(userId, plan.Id, PaymentProvider.Paystack, "idem-" + id, "ref-" + id, plan.AmountMinor, plan.Currency, at);
        if (reachedCheckout)
            tx.AttachCheckout("ps_" + id, "https://checkout.paystack.com/" + id, null, at);
        if (failed)
            tx.MarkFailed("Checkout session expired", at.AddMinutes(30));
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        return tx;
    }

    private static Guid Signup(TestHarness h, string email, string name)
    {
        var user = User.Create(name, email, "hash", h.Clock.UtcNow);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user.Id;
    }
}
