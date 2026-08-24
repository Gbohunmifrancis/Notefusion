using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The reconciliation console: the pages that answer "whose money is stuck, and what happened to it", plus
/// the one action on them. Two properties matter more than the rest. The console's idea of "stuck" has to be
/// the worker's idea of it, or the page explains a rule nothing follows; and a payment must never disappear
/// from the list because something else about it is missing, since the rows worth finding are exactly the
/// broken ones.
/// </summary>
public class PaymentOperationsTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 9, 30, 0, DateTimeKind.Utc);

    /// <summary>Committed defaults — a 10-minute grace window and a 15-minute sweep.</summary>
    private static readonly BillingSettings Settings = new();

    // ------------------------------------------------------------------ the payments table

    [Fact]
    public async Task The_payments_table_reads_newest_first_and_pages()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);

        for (var i = 0; i < 5; i++)
            Payment(h, payer, plan, $"NF_{i}", PaymentStatus.Pending, Now.AddHours(i - 5));

        var first = await Payments(h, new GetPaymentsQuery(Page: 1, PageSize: 2));

        Assert.Equal(5, first.TotalCount);
        Assert.Equal(3, first.TotalPages);
        Assert.Equal(new[] { "NF_4", "NF_3" }, first.Items.Select(i => i.Reference).ToArray());

        var last = await Payments(h, new GetPaymentsQuery(Page: 3, PageSize: 2));
        Assert.Equal(new[] { "NF_0" }, last.Items.Select(i => i.Reference).ToArray());
    }

    [Fact]
    public async Task A_page_size_beyond_the_cap_is_clamped_rather_than_honoured()
    {
        using var h = new TestHarness(Now);

        // One request must not be able to pull the whole payment history, and page 0 does not exist.
        var page = await Payments(h, new GetPaymentsQuery(Page: 0, PageSize: 5_000));

        Assert.Equal(1, page.Page);
        Assert.Equal(GetPaymentsQuery.MaxPageSize, page.PageSize);
    }

    [Fact]
    public async Task Stuck_means_processing_past_the_configured_grace_window()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);

        // Inside the window. The normal webhook is still expected, so flagging this would have the console
        // reporting a problem the worker has not even started looking for yet.
        Payment(h, payer, plan, "NF_fresh", PaymentStatus.Processing, Now.AddHours(-1), Now.AddMinutes(-2));
        Payment(h, payer, plan, "NF_stale", PaymentStatus.Processing, Now.AddHours(-2), Now.AddMinutes(-45));

        // Old, but settled. Age alone is not the test — the sweep only ever touches Processing rows.
        Payment(h, payer, plan, "NF_done", PaymentStatus.Completed, Now.AddDays(-3), Now.AddDays(-3));

        var all = await Payments(h, new GetPaymentsQuery());

        Assert.False(Row(all, "NF_fresh").IsStuck);
        Assert.True(Row(all, "NF_stale").IsStuck);
        Assert.False(Row(all, "NF_done").IsStuck);

        var stuck = await Payments(h, new GetPaymentsQuery(StuckOnly: true));
        Assert.Equal("NF_stale", Assert.Single(stuck.Items).Reference);

        // Stuck combines with the state filter instead of overriding it, so an impossible pair returns
        // nothing rather than quietly dropping one of the two conditions.
        var impossible = await Payments(h, new GetPaymentsQuery(Status: PaymentStatus.Completed, StuckOnly: true));
        Assert.Empty(impossible.Items);
    }

    [Fact]
    public async Task The_grace_window_is_read_from_settings_and_not_hard_coded()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        Payment(h, payer, plan, "NF_20m", PaymentStatus.Processing, Now.AddHours(-1), Now.AddMinutes(-20));

        // The same row, read twice under different configuration. This is the coupling that keeps the
        // console and PaymentReconciliationWorker describing one rule: widen the window in config and the
        // page stops calling this payment overdue, exactly as the sweep stops picking it up.
        var strict = await Payments(h, new GetPaymentsQuery(), new BillingSettings { ReconciliationGraceMinutes = 10 });
        var lenient = await Payments(h, new GetPaymentsQuery(), new BillingSettings { ReconciliationGraceMinutes = 60 });

        Assert.True(Assert.Single(strict.Items).IsStuck);
        Assert.False(Assert.Single(lenient.Items).IsStuck);
    }

    [Fact]
    public async Task The_table_finds_a_payment_by_either_reference_or_by_the_account_email()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        var other = User.Create("Sam Other", "sam@example.com", h.Hasher.Hash("password123"), Now.AddDays(-9));
        h.Db.Users.Add(other);
        h.Db.SaveChanges();

        Payment(h, payer, plan, "NF_pat", PaymentStatus.Processing, Now.AddHours(-4));
        Payment(h, other, plan, "NF_sam", PaymentStatus.Processing, Now.AddHours(-3));

        // Support threads arrive with a reference in whatever case the customer pasted it.
        var ours = await Payments(h, new GetPaymentsQuery(Search: "nf_PAT"));
        Assert.Equal("NF_pat", Assert.Single(ours.Items).Reference);

        // …or with the provider's reference, which is the only one the gateway dashboard shows.
        var theirs = await Payments(h, new GetPaymentsQuery(Search: "CHK_NF_SAM"));
        Assert.Equal("NF_sam", Assert.Single(theirs.Items).Reference);

        var byEmail = await Payments(h, new GetPaymentsQuery(Search: "SAM@Example.com"));
        Assert.Equal("NF_sam", Assert.Single(byEmail.Items).Reference);
    }

    [Fact]
    public async Task A_payment_whose_account_is_gone_still_lists()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        Payment(h, payer, plan, "NF_orphan", PaymentStatus.Verified, Now.AddDays(-2));

        h.Db.Users.Remove(payer);
        h.Db.SaveChanges();

        // Why the account is reached by a correlated subquery and not an inner join. A payment that vanishes
        // from this table is the one failure it cannot have: a Verified row is money we took, and it has to
        // stay findable under its reference after a GDPR erasure takes the name off it.
        var page = await Payments(h, new GetPaymentsQuery());

        var row = Assert.Single(page.Items);
        Assert.Equal("NF_orphan", row.Reference);
        Assert.Equal(string.Empty, row.UserEmail);
    }

    // ------------------------------------------------------------------ the summary

    [Fact]
    public async Task The_summary_counts_every_state_and_reads_zero_for_the_ones_with_no_rows()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);

        Payment(h, payer, plan, "NF_a", PaymentStatus.Pending, Now.AddHours(-1));
        Payment(h, payer, plan, "NF_b", PaymentStatus.Processing, Now.AddHours(-1), Now.AddMinutes(-3));
        Payment(h, payer, plan, "NF_c", PaymentStatus.Processing, Now.AddHours(-2), Now.AddMinutes(-90));
        Payment(h, payer, plan, "NF_d", PaymentStatus.Completed, Now.AddDays(-1), Now.AddDays(-1));

        var summary = await Summary(h);

        Assert.Equal(1, summary.PendingCount);
        Assert.Equal(2, summary.ProcessingCount);
        Assert.Equal(1, summary.CompletedCount);

        // A state with no rows is absent from the grouped count, and absent has to read as zero — a null
        // here would render as "—" on the page that exists to say the number is nothing to worry about.
        Assert.Equal(0, summary.VerifiedCount);
        Assert.Equal(0, summary.FailedCount);

        Assert.Equal(1, summary.StuckCount);
        Assert.Equal(Now.AddMinutes(-90), summary.OldestStuckSinceUtc);

        // Printed so the page can define "overdue" instead of asking the reader to trust a number.
        Assert.Equal(Settings.ReconciliationGraceMinutes, summary.GraceWindowMinutes);
        Assert.Equal(Settings.ReconciliationMinutes, summary.SweepIntervalMinutes);
    }

    [Fact]
    public async Task The_summary_nets_the_ledger_and_reports_how_the_inbox_is_draining()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        var tx = Payment(h, payer, plan, "NF_paid", PaymentStatus.Completed, Now.AddDays(-2), Now.AddDays(-2));

        Credit(h, payer, tx, 499, Now.AddDays(-2));
        Debit(h, payer, tx, 100, Now.AddDays(-1));

        Awaiting(h, "evt_wait", "charge.success", tx.Reference, Now.AddMinutes(-8));
        Processed(h, "evt_done", "charge.success", tx.Reference, Now.AddDays(-2));
        Parked(h, "evt_dead", "charge.success", "NF_ghost", Now.AddHours(-6));

        var summary = await Summary(h);

        // Summed from the entries, never from a stored balance.
        Assert.Equal(499, summary.CreditedMinor);
        Assert.Equal(100, summary.RefundedMinor);
        Assert.Equal(399, summary.NetMinor);
        Assert.Equal("USD", summary.Currency);

        Assert.Equal(1, summary.WebhooksAwaitingCount);
        Assert.Equal(1, summary.WebhooksProcessedCount);
        Assert.Equal(1, summary.WebhooksFailedCount);
        Assert.Equal(Now.AddMinutes(-8), summary.OldestAwaitingWebhookAtUtc);
    }

    [Fact]
    public async Task An_empty_ledger_sums_to_nothing_rather_than_to_an_unlabelled_figure()
    {
        using var h = new TestHarness(Now);

        var summary = await Summary(h);

        Assert.Equal(0, summary.NetMinor);
        Assert.Equal("USD", summary.Currency);
        Assert.Null(summary.OldestStuckSinceUtc);
        Assert.Null(summary.OldestAwaitingWebhookAtUtc);
    }

    // ------------------------------------------------------------------ the webhook inbox

    [Fact]
    public async Task An_event_links_to_its_payment_and_one_that_cannot_be_placed_still_lists()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        var tx = Payment(h, payer, plan, "NF_known", PaymentStatus.Processing, Now.AddHours(-3), Now.AddMinutes(-40));

        Awaiting(h, "evt_known", "charge.success", tx.Reference, Now.AddMinutes(-30));
        Parked(h, "evt_unknown", "charge.success", "NF_never_ours", Now.AddMinutes(-20));

        var page = await Webhooks(h, new GetWebhookEventsQuery());

        // An event naming a reference we cannot place is a finding, not a row to hide: it is either a
        // provider misconfiguration or somebody else's traffic arriving at our endpoint. An inner join on
        // the payment would have removed exactly the rows worth reading.
        Assert.Equal(2, page.TotalCount);
        Assert.Equal(tx.Id, page.Items.Single(e => e.ProviderEventId == "evt_known").PaymentTransactionId);
        Assert.Null(page.Items.Single(e => e.ProviderEventId == "evt_unknown").PaymentTransactionId);
    }

    [Fact]
    public async Task The_inbox_searches_the_identifiers_and_deliberately_not_the_payload()
    {
        using var h = new TestHarness(Now);
        var e = WebhookEvent.Receive(
            PaymentProvider.Bachs, "evt_body", "charge.success", "NF_body",
            """{"data":{"customer":"needle@example.com"}}""", Now.AddMinutes(-5));
        h.Db.WebhookEvents.Add(e);
        h.Db.SaveChanges();

        Assert.Single((await Webhooks(h, new GetWebhookEventsQuery(Search: "CHARGE.SUCCESS"))).Items);
        Assert.Single((await Webhooks(h, new GetWebhookEventsQuery(Search: "nf_BODY"))).Items);

        // The payload is a whole request body per row, so searching it is a table scan over the largest
        // column in the schema. Somebody will eventually expect this to match; the assertion is here so the
        // decision is visible rather than inferred from a missing clause.
        Assert.Empty((await Webhooks(h, new GetWebhookEventsQuery(Search: "needle"))).Items);
    }

    [Fact]
    public async Task One_event_carries_the_payload_the_list_leaves_out()
    {
        using var h = new TestHarness(Now);
        const string Body = """{"event":"charge.success","data":{"reference":"NF_one"}}""";
        var e = WebhookEvent.Receive(
            PaymentProvider.Paystack, "evt_one", "charge.success", "NF_one", Body, Now.AddMinutes(-5));
        h.Db.WebhookEvents.Add(e);
        h.Db.SaveChanges();

        var handler = new GetWebhookEventQueryHandler(h.Db);

        var found = await handler.Handle(new GetWebhookEventQuery(e.Id), CancellationToken.None);
        Assert.True(found.IsSuccess);
        Assert.Equal(Body, found.Value.Payload);
        Assert.Equal("Paystack", found.Value.Event.Provider);

        var missing = await handler.Handle(new GetWebhookEventQuery(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("BILLING_WEBHOOK_EVENT_NOT_FOUND", missing.Error.Code);
    }

    // ------------------------------------------------------------------ the ledger

    [Fact]
    public async Task The_ledger_lists_every_account_and_filters_by_direction_and_by_text()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        var other = User.Create("Sam Other", "sam@example.com", h.Hasher.Hash("password123"), Now.AddDays(-9));
        h.Db.Users.Add(other);
        h.Db.SaveChanges();

        var pats = Payment(h, payer, plan, "NF_pat", PaymentStatus.Completed, Now.AddDays(-2), Now.AddDays(-2));
        var sams = Payment(h, other, plan, "NF_sam", PaymentStatus.Completed, Now.AddDays(-1), Now.AddDays(-1));

        Credit(h, payer, pats, 499, Now.AddDays(-2));
        Debit(h, payer, pats, 499, Now.AddHours(-4));
        Credit(h, other, sams, 4_999, Now.AddDays(-1));

        var all = await Ledger(h, new GetLedgerEntriesQuery());
        Assert.Equal(3, all.TotalCount);
        Assert.Equal("pat@example.com", all.Items[0].UserEmail);

        var refunds = await Ledger(h, new GetLedgerEntriesQuery(Direction: LedgerDirection.Debit));
        Assert.Equal("Refund", Assert.Single(refunds.Items).Reason);

        var byEmail = await Ledger(h, new GetLedgerEntriesQuery(Search: "SAM@Example.com"));
        Assert.Equal(4_999, Assert.Single(byEmail.Items).AmountMinor);

        // Reconciling a bank statement starts from the payment reference, so the entry has to be findable
        // by it even though the reference lives on another table.
        var byReference = await Ledger(h, new GetLedgerEntriesQuery(Search: "nf_SAM"));
        Assert.Equal("NF_sam", Assert.Single(byReference.Items).PaymentReference);
    }

    // ------------------------------------------------------------------ reconciling on request

    [Fact]
    public async Task Reconciling_a_stuck_payment_completes_it_and_records_who_asked()
    {
        using var h = new TestHarness(Now);
        var (admin, payer, plan) = Seed(h);
        var tx = Payment(h, payer, plan, "NF_stuck", PaymentStatus.Processing, Now.AddHours(-2), Now.AddMinutes(-45));

        var result = await Reconcile(h, admin, tx.Id, Answer(succeeded: true), "Customer emailed support.");

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Changed);
        Assert.Equal("Processing", result.Value.PreviousStatus);
        Assert.Equal("Completed", result.Value.Status);
        Assert.Contains("subscription was applied", result.Value.Outcome);

        // The real effect, through the same command the worker runs: money on the ledger, a subscription,
        // and the receipt the missing webhook owed the customer.
        Assert.Equal(PaymentStatus.Completed, h.Db.PaymentTransactions.AsNoTracking().Single().Status);
        Assert.Single(h.Db.LedgerEntries.AsNoTracking().ToList());
        Assert.Contains("receipt", h.Email.Sent.Select(s => s.Kind));

        var entry = Assert.Single(h.Db.AdminAuditLogs);
        Assert.Equal(AdminAuditAction.ReconcilePayment, entry.Action);
        Assert.Equal(admin.Id, entry.ActorUserId);
        Assert.Equal(payer.Id, entry.TargetUserId);
        Assert.Contains("Processing → Completed", entry.Summary);
        Assert.Equal("Customer emailed support.", entry.Note);
    }

    [Fact]
    public async Task Reconciling_a_settled_payment_says_it_changed_nothing()
    {
        using var h = new TestHarness(Now);
        var (admin, payer, plan) = Seed(h);
        var tx = Payment(h, payer, plan, "NF_done", PaymentStatus.Completed, Now.AddDays(-2), Now.AddDays(-2));

        var result = await Reconcile(h, admin, tx.Id, Answer(succeeded: true));

        // The inner command reports "nothing to do" as plain success, which on its own leaves an operator
        // unable to tell a recovery from a no-op. This is the difference the console shows.
        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Changed);
        Assert.Equal("Completed", result.Value.PreviousStatus);
        Assert.Contains("already completed", result.Value.Outcome);

        Assert.Contains("No change; it was already Completed.", Assert.Single(h.Db.AdminAuditLogs).Summary);
    }

    [Fact]
    public async Task A_reconciliation_the_provider_contradicts_fails_and_is_still_audited()
    {
        using var h = new TestHarness(Now);
        var (admin, payer, plan) = Seed(h);
        var tx = Payment(h, payer, plan, "NF_odd", PaymentStatus.Processing, Now.AddHours(-2), Now.AddMinutes(-45));

        // The provider says it collected a different amount. Nothing is fulfilled on that answer.
        var result = await Reconcile(h, admin, tx.Id, Answer(succeeded: true, amountMinor: 100));

        Assert.Equal("BILLING_VERIFICATION_MISMATCH", result.Error.Code);
        Assert.Equal(PaymentStatus.Processing, h.Db.PaymentTransactions.AsNoTracking().Single().Status);
        Assert.Empty(h.Db.LedgerEntries.AsNoTracking().ToList());

        // The most important row on the page to have a trail of: somebody asked, and the answer was that
        // our record and the provider's disagree about money.
        var entry = Assert.Single(h.Db.AdminAuditLogs);
        Assert.Equal(AdminAuditAction.ReconcilePayment, entry.Action);
        Assert.Contains("could not be completed", entry.Summary);
    }

    [Fact]
    public async Task An_unpaid_checkout_the_provider_has_closed_is_failed_and_reported_as_such()
    {
        using var h = new TestHarness(Now);
        var (admin, payer, plan) = Seed(h);
        var tx = Payment(h, payer, plan, "NF_dead", PaymentStatus.Processing, Now.AddHours(-3), Now.AddMinutes(-45));

        var result = await Reconcile(h, admin, tx.Id, Answer(succeeded: false, terminal: true));

        // Closing the row is what lets the customer's next attempt open a fresh checkout instead of being
        // handed the dead one, so the sentence has to say the retry is available.
        Assert.True(result.Value.Changed);
        Assert.Equal("Failed", result.Value.Status);
        Assert.Contains("can start a new one", result.Value.Outcome);
        Assert.Empty(h.Db.LedgerEntries.AsNoTracking().ToList());
    }

    [Fact]
    public async Task Reconciling_a_payment_that_is_not_ours_is_a_not_found_and_writes_no_row()
    {
        using var h = new TestHarness(Now);
        var (admin, _, _) = Seed(h);

        var result = await Reconcile(h, admin, Guid.NewGuid(), Answer(succeeded: true));

        Assert.Equal("BILLING_TRANSACTION_NOT_FOUND", result.Error.Code);
        Assert.Empty(h.Db.AdminAuditLogs.AsNoTracking().ToList());
    }

    [Fact]
    public async Task Reconciling_outside_a_signed_in_session_is_refused()
    {
        using var h = new TestHarness(Now);
        var (_, payer, plan) = Seed(h);
        var tx = Payment(h, payer, plan, "NF_anon", PaymentStatus.Processing, Now.AddHours(-2), Now.AddMinutes(-45));

        var handler = new ReconcilePaymentAdminCommandHandler(
            h.Db,
            new HarnessSender(h, new FakeFactory(Answer(succeeded: true))),
            new StubCurrentUser(null),
            new NoteFusion.Application.Admin.Services.AuditLogger(
                h.Db, new StubCurrentUser(null), h.ClientIp, h.Clock));

        var result = await handler.Handle(
            new ReconcilePaymentAdminCommand(tx.Id), CancellationToken.None);

        // Refused before the provider is called at all: an actorless reconciliation would move money and
        // answer nobody's question about who moved it.
        Assert.Equal("ADMIN_NOT_AUTHENTICATED", result.Error.Code);
        Assert.Equal(PaymentStatus.Processing, h.Db.PaymentTransactions.AsNoTracking().Single().Status);
    }

    // ---------------------------------------------------------------- fixtures

    private static (User Admin, User Payer, Plan Plan) Seed(TestHarness h)
    {
        var admin = User.Create("Ada Admin", "ada@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-200));
        admin.PromoteToAdmin();
        var payer = User.Create("Pat Pro", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);

        h.Db.Users.Add(admin);
        h.Db.Users.Add(payer);
        h.Db.Plans.Add(plan);
        h.Db.SaveChanges();

        return (admin, payer, plan);
    }

    /// <summary>
    /// A payment in the state a test needs, driven through the real transitions rather than assigned.
    /// <paramref name="touchedAtUtc"/> is what the grace window is measured against, so it is how a test
    /// says "this one is overdue".
    /// </summary>
    private static PaymentTransaction Payment(
        TestHarness h,
        User payer,
        Plan plan,
        string reference,
        PaymentStatus status,
        DateTime createdAtUtc,
        DateTime? touchedAtUtc = null,
        PaymentProvider provider = PaymentProvider.Bachs)
    {
        var tx = PaymentTransaction.Create(
            payer.Id, plan.Id, provider, $"idem:{reference}", reference,
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

    private static void Processed(TestHarness h, string eventId, string type, string? reference, DateTime atUtc)
    {
        var e = Inbox(h, eventId, type, reference, atUtc);
        e.MarkProcessed(atUtc);
        h.Db.SaveChanges();
    }

    /// <summary>An event whose retries ran out — the state the console shows as parked.</summary>
    private static void Parked(TestHarness h, string eventId, string type, string? reference, DateTime atUtc)
    {
        var e = Inbox(h, eventId, type, reference, atUtc);
        e.RecordFailure("No payment matches the webhook reference.", maxAttempts: 1, atUtc);
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

    private static GatewayVerification Answer(
        bool succeeded, long amountMinor = 499, bool terminal = true) => new(
        succeeded, amountMinor, Currency: "USD", ProviderReference: "chk_verified",
        ProviderSubscriptionRef: null, Raw: "{}", terminal);

    private static AdminPaymentRowDto Row(PagedResultDto<AdminPaymentRowDto> page, string reference)
        => page.Items.Single(i => i.Reference == reference);

    private static async Task<PagedResultDto<AdminPaymentRowDto>> Payments(
        TestHarness h, GetPaymentsQuery query, BillingSettings? settings = null)
    {
        var result = await new GetPaymentsQueryHandler(h.Db, h.Clock, settings ?? Settings)
            .Handle(query, CancellationToken.None);

        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static async Task<PaymentOpsSummaryDto> Summary(TestHarness h)
    {
        var result = await new GetPaymentOpsSummaryQueryHandler(h.Db, h.Clock, Settings)
            .Handle(new GetPaymentOpsSummaryQuery(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static async Task<PagedResultDto<AdminWebhookEventRowDto>> Webhooks(
        TestHarness h, GetWebhookEventsQuery query)
    {
        var result = await new GetWebhookEventsQueryHandler(h.Db).Handle(query, CancellationToken.None);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static async Task<PagedResultDto<AdminLedgerRowDto>> Ledger(
        TestHarness h, GetLedgerEntriesQuery query)
    {
        var result = await new GetLedgerEntriesQueryHandler(h.Db).Handle(query, CancellationToken.None);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    /// <summary>
    /// Reconciles as <paramref name="actor"/>, with the inner command dispatched through
    /// <see cref="HarnessSender"/> so the real reconciliation runs rather than a stub of it.
    /// </summary>
    private static Task<Result<AdminReconcileResultDto>> Reconcile(
        TestHarness h, User actor, Guid paymentId, GatewayVerification answer, string? note = null)
        => new ReconcilePaymentAdminCommandHandler(
                h.Db,
                new HarnessSender(h, new FakeFactory(answer)),
                new StubCurrentUser(actor.Id, actor.Role, actor.Email, actor.FullName),
                h.AuditAs(actor))
            .Handle(new ReconcilePaymentAdminCommand(paymentId, note), CancellationToken.None);

    /// <summary>Answers verification however the test asks. Opening a checkout is not part of this path.</summary>
    private sealed class FakeFactory : IPaymentGatewayFactory, IPaymentGateway
    {
        private readonly GatewayVerification _answer;

        public FakeFactory(GatewayVerification answer) => _answer = answer;

        public PaymentProvider Provider => PaymentProvider.Bachs;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["USD"];

        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => throw new NotSupportedException("Reconciliation never opens a checkout.");

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(_answer));
    }
}
