using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The alert that tells an operator money needs them. Two properties carry the feature. It must fire for
/// the conditions nothing else can clear — chiefly a payment stranded at <see cref="PaymentStatus.Verified"/>,
/// which no worker sweeps and no console button finishes — and it must not fire twice for the same one,
/// because an alert that repeats every quarter of an hour is an alert that gets swiped away unread.
/// </summary>
public class AdminPaymentAlertTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 9, 30, 0, DateTimeKind.Utc);

    /// <summary>Committed defaults — a 10-minute grace window, which is the cutoff every count uses.</summary>
    private static readonly BillingSettings Settings = new();

    /// <summary>Comfortably outside the grace window; what a test means by "nothing is coming for this".</summary>
    private static readonly DateTime Overdue = Now.AddHours(-2);

    [Fact]
    public async Task Says_nothing_when_the_money_is_healthy()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);

        // Every state that resolves itself, none of which is anybody's problem: a checkout just opened,
        // one that finished, and a webhook that drained.
        Payment(h, payer, plan, "NF_fresh", PaymentStatus.Processing, Now.AddMinutes(-2));
        var done = Payment(h, payer, plan, "NF_done", PaymentStatus.Completed, Overdue);
        Credit(h, payer, done, plan.AmountMinor, Overdue);
        Processed(h, "evt_ok", "charge.success", "NF_done", Overdue);

        var result = await Check(h);

        Assert.Empty(h.Push.DeviceSends);
        Assert.Equal(0, result.Value.Total);
    }

    [Fact]
    public async Task Reports_a_payment_that_was_charged_verified_and_never_fulfilled()
    {
        using var h = new TestHarness(Now);
        var (admin, payer, plan) = Seed(h);
        Payment(h, payer, plan, "NF_stranded", PaymentStatus.Verified, Overdue);

        var result = await Check(h);

        Assert.Equal(1, result.Value.StrandedVerified);

        var (recipients, message) = Assert.Single(h.Push.DeviceSends);

        // Only the operators' phones. The customer whose payment this is must not be told their payment is broken
        // by the same notification that asks somebody to go and fix it.
        Assert.Equal([AdminPhone], recipients);
        Assert.DoesNotContain(PayerPhone, recipients);

        Assert.Equal("Paid but not fulfilled", message.Title);
        Assert.Contains("1 verified, not fulfilled", message.Body);

        // Where the Reconcile button is. A notification that opens the app and stops there is the bug
        // this data key exists to avoid.
        Assert.Equal("AdminPayments", message.Data?["screen"]);
    }

    [Fact]
    public async Task Does_not_repeat_itself_while_the_same_problem_sits_there()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        Payment(h, payer, plan, "NF_stranded", PaymentStatus.Verified, Overdue);

        var first = await Check(h);
        var second = await Check(h, first.Value);

        // The problem is still outstanding — the signature says so — and the operator has still been told
        // exactly once. This is the whole of the de-dup: the caller hands back what it was given.
        Assert.Equal(1, second.Value.StrandedVerified);
        Assert.Single(h.Push.DeviceSends);
    }

    [Fact]
    public async Task Speaks_up_again_when_a_second_payment_strands()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        Payment(h, payer, plan, "NF_one", PaymentStatus.Verified, Overdue);

        var first = await Check(h);
        Payment(h, payer, plan, "NF_two", PaymentStatus.Verified, Overdue);
        await Check(h, first.Value);

        Assert.Equal(2, h.Push.DeviceSends.Count);
        Assert.Contains("2 verified, not fulfilled", h.Push.DeviceSends[^1].Message.Body);
    }

    [Fact]
    public async Task Stays_quiet_when_a_count_only_falls()
    {
        using var h = new TestHarness(Now);
        var (admin, payer, plan) = Seed(h);
        var one = Payment(h, payer, plan, "NF_one", PaymentStatus.Verified, Overdue);
        Payment(h, payer, plan, "NF_two", PaymentStatus.Verified, Overdue);

        var first = await Check(h);
        Assert.Single(h.Push.DeviceSends);

        // The operator fixed one of the two. Structural equality on the signature would treat the
        // remaining one as news and notify about a problem they have already seen.
        one.MarkCompleted(Now);
        h.Db.SaveChanges();

        var second = await Check(h, first.Value);

        Assert.Equal(1, second.Value.StrandedVerified);
        Assert.Single(h.Push.DeviceSends);
        Assert.Equal([AdminPhone], h.Push.DeviceSends[0].Tokens);
    }

    [Fact]
    public async Task Counts_an_undrained_webhook_inbox_and_points_at_it()
    {
        using var h = new TestHarness(Now);
        Seed(h);

        // Received long ago and still Received: PaymentWebhookWorker is not running. Its own count
        // because a wedged drain breaks every payment at once, not one customer's.
        Awaiting(h, "evt_stalled", "charge.success", "NF_waiting", Overdue);

        var result = await Check(h);

        Assert.Equal(1, result.Value.WebhookBacklog);
        Assert.Equal(0, result.Value.FailedWebhooks);

        var message = Assert.Single(h.Push.DeviceSends).Message;
        Assert.Equal("Webhooks are not draining", message.Title);
        Assert.Equal("AdminWebhooks", message.Data?["screen"]);
    }

    [Fact]
    public async Task Ignores_a_webhook_that_has_only_just_arrived()
    {
        using var h = new TestHarness(Now);
        Seed(h);
        Awaiting(h, "evt_new", "charge.success", "NF_waiting", Now.AddMinutes(-1));

        var result = await Check(h);

        // Inside the grace window the drain worker has not had its turn yet, and a queue one minute deep
        // is the system working.
        Assert.Equal(0, result.Value.WebhookBacklog);
        Assert.Empty(h.Push.DeviceSends);
    }

    [Fact]
    public async Task Counts_a_parked_webhook_separately_from_a_backlog()
    {
        using var h = new TestHarness(Now);
        Seed(h);
        Parked(h, "evt_dead", "charge.success", "NF_missing", Overdue);

        var result = await Check(h);

        Assert.Equal(1, result.Value.FailedWebhooks);
        Assert.Equal(0, result.Value.WebhookBacklog);
        Assert.Contains("1 webhook failed", Assert.Single(h.Push.DeviceSends).Message.Body);
    }

    [Fact]
    public async Task Reports_a_ledger_debit_because_no_code_here_can_write_one()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        var tx = Payment(h, payer, plan, "NF_done", PaymentStatus.Completed, Overdue);
        Credit(h, payer, tx, plan.AmountMinor, Overdue);
        Debit(h, payer, tx, plan.AmountMinor, Now.AddMinutes(-30));

        var result = await Check(h);

        Assert.Equal(1, result.Value.LedgerDebits);

        // Loudest of the five, and first in the title, precisely because it should be unreachable: money
        // left the ledger by a route that does not exist in this codebase.
        Assert.Equal("Unexplained refund in the ledger", Assert.Single(h.Push.DeviceSends).Message.Title);
    }

    [Fact]
    public async Task Reports_several_conditions_as_one_notification()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        Payment(h, payer, plan, "NF_stranded", PaymentStatus.Verified, Overdue);
        Payment(h, payer, plan, "NF_stuck", PaymentStatus.Processing, Overdue);
        Parked(h, "evt_dead", "charge.success", "NF_missing", Overdue);

        await Check(h);

        // One digest, not one push per row: a provider outage strands a batch, and three hundred
        // notifications is indistinguishable from none.
        var message = Assert.Single(h.Push.DeviceSends).Message;
        Assert.Contains("1 verified, not fulfilled", message.Body);
        Assert.Contains("1 stuck in processing", message.Body);
        Assert.Contains("1 webhook failed", message.Body);

        // Nothing to say about the counts that are zero.
        Assert.DoesNotContain("0 ", message.Body);
        Assert.DoesNotContain("undelivered", message.Body);
    }

    [Fact]
    public async Task Sends_nowhere_when_there_are_no_admins()
    {
        using var h = new TestHarness(Now);
        var payer = User.Create("Pat Pro", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        h.Db.Users.Add(payer);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();

        Payment(h, payer, plan, "NF_stranded", PaymentStatus.Verified, Overdue);

        var result = await Check(h);

        // Counted, not sent, and not thrown: an unattended deployment still runs this worker every
        // quarter of an hour.
        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.StrandedVerified);
        Assert.Empty(h.Push.DeviceSends);
    }

    [Fact]
    public async Task Skips_a_suspended_operator()
    {
        using var h = new TestHarness(Now);
        var (admin, payer, plan) = Seed(h);

        var former = User.Create("Sam Former", "sam@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-100));
        former.PromoteToAdmin();
        former.Suspend();
        h.Db.Users.Add(former);
        h.Db.DeviceTokens.Add(DeviceToken.Create(former.Id, "ExponentPushToken[former]", "android", 42, Now.AddDays(-1)));
        h.Db.SaveChanges();

        Payment(h, payer, plan, "NF_stranded", PaymentStatus.Verified, Overdue);

        await Check(h);

        // Suspension takes the console away, so a notification pointing at it is a dead end.
        Assert.Equal([AdminPhone], Assert.Single(h.Push.DeviceSends).Tokens);
    }

    [Fact]
    public async Task A_phone_that_switched_problems_off_is_not_told_and_one_that_set_alerts_rings_on_its_channel()
    {
        using var h = new TestHarness(Now);
        var (admin, payer, plan) = Seed(h);
        var phone = h.Db.DeviceTokens.Single(t => t.Token == AdminPhone);
        phone.SetPaymentAlerts(true, "chime", true, false, false, problems: true, Now);
        var tablet = DeviceToken.Create(admin.Id, "ExponentPushToken[tablet]", "android", 42, Now);
        tablet.SetPaymentAlerts(true, "chime", true, false, false, problems: false, Now);
        h.Db.DeviceTokens.Add(tablet);
        h.Db.SaveChanges();
        Payment(h, payer, plan, "NF_stranded", PaymentStatus.Verified, Overdue);

        await Check(h);

        var (tokens, message) = Assert.Single(h.Push.DeviceSends);
        Assert.Equal([AdminPhone], tokens);
        Assert.Equal("payment-problems", message.ChannelId);
    }

    [Fact]
    public async Task A_fresh_process_is_told_about_what_is_already_outstanding()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        Payment(h, payer, plan, "NF_stranded", PaymentStatus.Verified, Overdue);

        // Null is what a restarted worker passes, having lost the in-memory signature. It repeats one
        // digest rather than staying silent about an unfulfilled payment — the right way round to be wrong.
        await Check(h, lastNotified: null);

        Assert.Single(h.Push.DeviceSends);
    }

    // ---------------------------------------------------------------- fixtures

    private static Task<Result<PaymentIssueSignature>> Check(
        TestHarness h, PaymentIssueSignature? lastNotified = null)
        => new NotifyAdminsOfPaymentIssuesCommandHandler(h.Db, h.Clock, Settings, h.Push)
            .Handle(new NotifyAdminsOfPaymentIssuesCommand(lastNotified), CancellationToken.None);

    private static (User Admin, User Payer, Plan Plan) Seed(TestHarness h)
    {
        var admin = User.Create("Ada Admin", "ada@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-200));
        admin.PromoteToAdmin();
        var payer = User.Create("Pat Pro", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);

        h.Db.Users.Add(admin);
        h.Db.Users.Add(payer);
        h.Db.Plans.Add(plan);
        // Each has a phone: the admin's is told, the payer's never is.
        h.Db.DeviceTokens.Add(DeviceToken.Create(admin.Id, AdminPhone, "android", 42, Now.AddDays(-1)));
        h.Db.DeviceTokens.Add(DeviceToken.Create(payer.Id, PayerPhone, "android", 42, Now.AddDays(-1)));
        h.Db.SaveChanges();

        return (admin, payer, plan);
    }

    private const string AdminPhone = "ExponentPushToken[admin]";
    private const string PayerPhone = "ExponentPushToken[payer]";

    /// <summary>
    /// A payment in the state a test needs, driven through the real transitions. <paramref name="touchedAtUtc"/>
    /// is what the grace window measures against, so it is how a test says "this one is overdue".
    /// </summary>
    private static PaymentTransaction Payment(
        TestHarness h, User payer, Plan plan, string reference, PaymentStatus status,
        DateTime createdAtUtc, DateTime? touchedAtUtc = null)
    {
        var tx = PaymentTransaction.Create(
            payer.Id, plan.Id, PaymentProvider.Bachs, $"idem:{reference}", reference,
            plan.AmountMinor, plan.Currency, createdAtUtc);

        var touched = touchedAtUtc ?? createdAtUtc;

        if (status != PaymentStatus.Pending)
            tx.AttachCheckout($"chk_{reference}", "https://pay.test/session", "{}", touched);

        if (status is PaymentStatus.Verified or PaymentStatus.Completed)
            tx.MarkVerified($"chk_{reference}", "{}", touched);

        if (status == PaymentStatus.Completed)
            tx.MarkCompleted(touched);

        if (status == PaymentStatus.Failed)
            tx.MarkFailed("Provider reports this checkout can no longer be paid.", touched);

        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();

        return tx;
    }

    private static void Credit(TestHarness h, User user, PaymentTransaction tx, long amountMinor, DateTime atUtc)
        => Entry(h, LedgerEntry.Create(
            user.Id, tx.Id, LedgerDirection.Credit, LedgerEntryReason.SubscriptionCharge,
            amountMinor, "USD", "NoteFusion Pro", atUtc));

    private static void Debit(TestHarness h, User user, PaymentTransaction tx, long amountMinor, DateTime atUtc)
        => Entry(h, LedgerEntry.Create(
            user.Id, tx.Id, LedgerDirection.Debit, LedgerEntryReason.Refund,
            amountMinor, "USD", "Refunded on request", atUtc));

    private static void Entry(TestHarness h, LedgerEntry entry)
    {
        h.Db.LedgerEntries.Add(entry);
        h.Db.SaveChanges();
    }

    private static void Awaiting(TestHarness h, string eventId, string type, string? reference, DateTime atUtc)
        => Inbox(h, eventId, type, reference, atUtc);

    /// <summary>An event whose retries ran out — parked, not queued.</summary>
    private static void Parked(TestHarness h, string eventId, string type, string? reference, DateTime atUtc)
    {
        var e = Inbox(h, eventId, type, reference, atUtc);
        e.RecordFailure("No payment matches the webhook reference.", maxAttempts: 1, atUtc);
        h.Db.SaveChanges();
    }

    private static void Processed(TestHarness h, string eventId, string type, string? reference, DateTime atUtc)
    {
        var e = Inbox(h, eventId, type, reference, atUtc);
        e.MarkProcessed(atUtc);
        h.Db.SaveChanges();
    }

    private static WebhookEvent Inbox(
        TestHarness h, string eventId, string type, string? reference, DateTime atUtc)
    {
        var e = WebhookEvent.Receive(PaymentProvider.Bachs, eventId, type, reference, "{}", atUtc);
        h.Db.WebhookEvents.Add(e);
        h.Db.SaveChanges();
        return e;
    }
}
