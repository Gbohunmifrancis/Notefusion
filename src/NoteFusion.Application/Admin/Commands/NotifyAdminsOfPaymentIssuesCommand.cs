using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// The five payment conditions that need a human, counted at one instant. Passed back to the caller so
/// it can hand the same value in next time and be told only about what has got worse since.
/// </summary>
public sealed record PaymentIssueSignature(
    int StrandedVerified,
    int StuckProcessing,
    int FailedWebhooks,
    int WebhookBacklog,
    int LedgerDebits)
{
    public static readonly PaymentIssueSignature None = new(0, 0, 0, 0, 0);

    public int Total => StrandedVerified + StuckProcessing + FailedWebhooks + WebhookBacklog + LedgerDebits;

    /// <summary>
    /// Whether anything got worse relative to <paramref name="previous"/> — the test for "tell the
    /// operator again". Deliberately per-field and strictly greater, not inequality: an operator who has
    /// cleared two of three problems must not be notified afresh about the one still open. A count that
    /// only falls is progress, and progress is not an alert.
    /// </summary>
    public bool Escalates(PaymentIssueSignature? previous)
    {
        var last = previous ?? None;
        return StrandedVerified > last.StrandedVerified
            || StuckProcessing > last.StuckProcessing
            || FailedWebhooks > last.FailedWebhooks
            || WebhookBacklog > last.WebhookBacklog
            || LedgerDebits > last.LedgerDebits;
    }
}

/// <summary>
/// Tells the admins when money needs them. Everything here is a condition the automatic paths have
/// already failed to resolve — that is what makes it a person's problem rather than a retry.
/// </summary>
/// <remarks>
/// Detection lives in the handler rather than the worker so it is testable without a host, and the
/// worker holds nothing but the opaque <see cref="PaymentIssueSignature"/> it was handed back. Pass the
/// previous signature in <paramref name="LastNotified"/> to suppress a repeat; pass null to be told
/// about anything outstanding, which is what a fresh process does.
/// </remarks>
public sealed record NotifyAdminsOfPaymentIssuesCommand(PaymentIssueSignature? LastNotified)
    : IRequest<Result<PaymentIssueSignature>>;

public sealed class NotifyAdminsOfPaymentIssuesCommandHandler
    : IRequestHandler<NotifyAdminsOfPaymentIssuesCommand, Result<PaymentIssueSignature>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly BillingSettings _settings;
    private readonly IPushSender _push;

    public NotifyAdminsOfPaymentIssuesCommandHandler(
        IApplicationDbContext db, IDateTimeProvider clock, BillingSettings settings, IPushSender push)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
        _push = push;
    }

    public async Task<Result<PaymentIssueSignature>> Handle(
        NotifyAdminsOfPaymentIssuesCommand request, CancellationToken ct)
    {
        // The same window the console calls "stuck" and the reconciliation sweep acts on, read from the
        // one place all three can see it. A second threshold here would show up as an alert about rows
        // nothing was going to touch.
        var cutoff = PaymentOps.StuckCutoff(_clock.UtcNow, _settings);

        // Verified but never Completed, and nothing will ever pick it up: the reconciliation worker
        // sweeps Processing only, and MarkCompleted is reachable from Verified alone. The customer has
        // been charged, the charge has been verified, and they do not have Pro.
        var strandedVerified = await _db.PaymentTransactions
            .AsNoTracking()
            .CountAsync(t => t.Status == PaymentStatus.Verified && t.UpdatedAtUtc < cutoff, ct);

        // The sweep has had its turn and the row is still Processing. Reconcile is the fix.
        var stuckProcessing = await _db.PaymentTransactions
            .AsNoTracking()
            .CountAsync(t => t.Status == PaymentStatus.Processing && t.UpdatedAtUtc < cutoff, ct);

        var failedWebhooks = await _db.WebhookEvents
            .AsNoTracking()
            .CountAsync(e => e.Status == WebhookStatus.Failed, ct);

        // Still Received long after arrival means PaymentWebhookWorker is not draining. Worth its own
        // count because it is the only condition here that breaks every payment at once rather than one.
        var webhookBacklog = await _db.WebhookEvents
            .AsNoTracking()
            .CountAsync(e => e.Status == WebhookStatus.Received && e.ReceivedAtUtc < cutoff, ct);

        // An invariant alarm, not a feature watcher: no code in this system writes a debit, so one
        // existing means money left by a route nobody here can account for.
        var ledgerDebits = await _db.LedgerEntries
            .AsNoTracking()
            .CountAsync(e => e.Direction == LedgerDirection.Debit, ct);

        var signature = new PaymentIssueSignature(
            strandedVerified, stuckProcessing, failedWebhooks, webhookBacklog, ledgerDebits);

        if (!signature.Escalates(request.LastNotified))
            return signature;

        var admins = await _db.Users
            .AsNoTracking()
            .Where(u => u.Role == UserRole.Admin && u.IsActive)
            .Select(u => u.Id)
            .ToListAsync(ct);

        // Nobody to tell. The signature still goes back, so the first admin promoted afterwards is not
        // buried under everything that accumulated while there were none.
        if (admins.Count == 0)
            return signature;

        // Payment-side trouble outranks the inbox as a destination: the payments screen is where the
        // Reconcile button lives, and that is the only one of these an operator can act on from a phone.
        var paymentSide = strandedVerified + stuckProcessing > 0;

        await _push.SendAsync(
            admins,
            new PushMessage(
                Title(signature),
                Body(signature),
                new Dictionary<string, string>
                {
                    ["screen"] = paymentSide ? "AdminPayments" : "AdminWebhooks",
                }),
            ct);

        return signature;
    }

    /// <summary>
    /// Names the worst thing outstanding, rather than a count. A notification is read on a lock screen
    /// in one glance, and "1 payment verified but not fulfilled" is actionable where "5 issues" is not.
    /// </summary>
    private static string Title(PaymentIssueSignature s)
    {
        if (s.LedgerDebits > 0) return "Unexplained refund in the ledger";
        if (s.StrandedVerified > 0) return "Paid but not fulfilled";
        if (s.WebhookBacklog > 0) return "Webhooks are not draining";
        if (s.StuckProcessing > 0) return "Payments need reconciling";
        return "Failed webhooks parked";
    }

    private static string Body(PaymentIssueSignature s)
    {
        // Only the non-zero counts: a body listing four zeroes reads as noise and pushes the one figure
        // that matters off the end of the banner.
        var parts = new List<string>(5);
        if (s.StrandedVerified > 0)
            parts.Add($"{s.StrandedVerified} verified, not fulfilled");
        if (s.StuckProcessing > 0)
            parts.Add($"{s.StuckProcessing} stuck in processing");
        if (s.WebhookBacklog > 0)
            parts.Add($"{s.WebhookBacklog} webhook{Plural(s.WebhookBacklog)} undelivered");
        if (s.FailedWebhooks > 0)
            parts.Add($"{s.FailedWebhooks} webhook{Plural(s.FailedWebhooks)} failed");
        if (s.LedgerDebits > 0)
            parts.Add($"{s.LedgerDebits} ledger debit{Plural(s.LedgerDebits)}");

        return string.Join(" · ", parts);
    }

    private static string Plural(int n) => n == 1 ? "" : "s";
}
