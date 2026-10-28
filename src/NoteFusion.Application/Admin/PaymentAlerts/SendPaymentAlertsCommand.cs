using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.PaymentAlerts;

/// <summary>What one run of the payment-alert sender did: payments announced, pushes sent, phones addressed.</summary>
public sealed record PaymentAlertRun(int Payments, int Pushes, int Devices, int Failed)
{
    public static readonly PaymentAlertRun Nothing = new(0, 0, 0, 0);
}

/// <summary>
/// Tells the admins' phones about payments that have just completed (board f-admin/08): one push per payment, or one
/// summary for several found together ("2 payments · ₦7,500 · $39.99"). The claims are written with the payments'
/// ledger credits (<see cref="AdminPaymentAlert"/>); this sends what is due, a few seconds later, from the
/// payment-alert worker.
/// </summary>
/// <remarks>
/// Only admin phones with alerts on (<see cref="AdminAlertDevices"/>), each on the channel and sound it chose, quiet
/// while muted or in its quiet hours, and without the customer's name when it asked for that. A claim is committed
/// before its send, so an admin hears about a payment at most once; a failure the push service reported is tried
/// again a minute later, up to <see cref="AdminPaymentAlert.MaxAttempts"/> tries, and an alert an hour old is no
/// longer news.
/// </remarks>
public sealed record SendPaymentAlertsCommand : IRequest<Result<PaymentAlertRun>>
{
    /// <summary>Older than this, a payment is no longer announced: Payments lists it.</summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromHours(1);

    /// <summary>A failed send waits this long before its next try.</summary>
    public static readonly TimeSpan RetryAfter = TimeSpan.FromMinutes(1);

    /// <summary>At most this many payments in one run (one summary).</summary>
    public const int MaxPerRun = 50;
}

public sealed class SendPaymentAlertsCommandHandler : IRequestHandler<SendPaymentAlertsCommand, Result<PaymentAlertRun>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPushSender _push;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<SendPaymentAlertsCommandHandler> _logger;
    private readonly IWebPushSender? _webPush;

    public SendPaymentAlertsCommandHandler(
        IApplicationDbContext db, IPushSender push, IDateTimeProvider clock, ILogger<SendPaymentAlertsCommandHandler> logger,
        IWebPushSender? webPush = null)
    {
        _db = db;
        _push = push;
        _clock = clock;
        _logger = logger;
        _webPush = webPush;
    }

    public async Task<Result<PaymentAlertRun>> Handle(SendPaymentAlertsCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var since = now - SendPaymentAlertsCommand.StaleAfter;
        var retryBefore = now - SendPaymentAlertsCommand.RetryAfter;

        var due = (await _db.AdminPaymentAlerts
                .Where(a => a.SentAtUtc == null && a.CreatedAtUtc >= since)
                .OrderBy(a => a.CreatedAtUtc)
                .ThenBy(a => a.Id)
                .Take(SendPaymentAlertsCommand.MaxPerRun * 2)
                .ToListAsync(ct))
            .Where(a => a.IsDue && (a.Attempts == 0 || a.LastAttemptAtUtc <= retryBefore))
            .Take(SendPaymentAlertsCommand.MaxPerRun)
            .ToList();

        if (due.Count == 0)
            return PaymentAlertRun.Nothing;

        // The console is told once per payment, on the first try only (a phone retry is not news there).
        var firstTry = due.Where(a => a.Attempts == 0).Select(a => a.PaymentTransactionId).ToList();

        // Claimed before anything is sent: a crash after the push service took it cannot become a second push.
        foreach (var alert in due)
            alert.BeginAttempt(now);
        await _db.SaveChangesAsync(ct);

        if (_webPush is not null && firstTry.Count > 0)
        {
            var paid = await FactsAsync(firstTry, now, ct);
            if (paid.Count > 0)
                await ConsoleAlerts.AdminConsolePush.SendToAdminsAsync(_db, _webPush, ConsoleAlerts.AdminConsoleAlertCopy.Payment(paid), ct);
        }

        var devices = await AdminAlertDevices.PaymentAlertsAsync(_db, ct);
        if (devices.Count == 0)
        {
            // Nobody to tell is not a failure to retry: the payment is on the Payments page.
            foreach (var alert in due)
                alert.MarkSent(0, 0, 0, now);
            await _db.SaveChangesAsync(ct);
            return new PaymentAlertRun(due.Count, 0, 0, 0);
        }

        var facts = await FactsAsync(due.Select(a => a.PaymentTransactionId).ToList(), now, ct);
        if (facts.Count == 0)
        {
            foreach (var alert in due)
                alert.MarkSent(0, 0, 0, now);
            await _db.SaveChangesAsync(ct);
            return new PaymentAlertRun(due.Count, 0, 0, 0);
        }

        // One push per way of ringing: phones that chose the same channel, sound and names share a message.
        int accepted = 0, refused = 0, pushes = 0;
        string? error = null;
        foreach (var group in devices
                     .Select(d => (Device: d, Ring: PaymentAlertChannels.For(
                         d.Sound, d.Vibrate, d.QuietAtNight, d.MutedUntilUtc, d.TimeZone, now, d.ChannelVersion)))
                     .GroupBy(x => (x.Ring.Channel, x.Ring.Sound, x.Device.HideNames)))
        {
            var words = PaymentPushCopy.Summary(facts, group.Key.HideNames);
            var data = facts.Count == 1
                ? new Dictionary<string, string> { ["screen"] = "AdminPayment", ["paymentId"] = facts[0].PaymentId.ToString() }
                : new Dictionary<string, string> { ["screen"] = "AdminPayments" };

            var delivery = await _push.SendToDevicesAsync(
                group.Select(x => x.Device.Token).ToList(),
                new PushMessage(
                    words.Title, words.Body, data, group.Key.Sound, group.Key.Channel,
                    PaymentAlertChannels.TimeToLiveSeconds, PaymentAlertChannels.Category),
                ct);

            pushes++;
            accepted += delivery.Accepted;
            refused += delivery.Refused;
            if (!delivery.Delivered)
                error ??= delivery.Error;
        }

        foreach (var alert in due)
        {
            if (accepted > 0 || error is null)
                alert.MarkSent(devices.Count, accepted, refused, now);
            else
                alert.MarkFailed(devices.Count, refused, error);
        }
        await _db.SaveChangesAsync(ct);

        if (accepted == 0 && error is not null)
            _logger.LogWarning("Payment alert for {Count} payment(s) not delivered: {Error}", due.Count, error);

        return new PaymentAlertRun(due.Count, pushes, devices.Count, accepted == 0 && error is not null ? due.Count : 0);
    }

    /// <summary>What each payment's push says, read now that its fulfilment has committed.</summary>
    private async Task<List<PaymentAlertFacts>> FactsAsync(List<Guid> ids, DateTime now, CancellationToken ct)
    {
        var rows = await _db.PaymentTransactions
            .AsNoTracking()
            .Where(t => ids.Contains(t.Id) && t.Status == PaymentStatus.Completed)
            .Select(t => new
            {
                t.Id,
                t.UserId,
                t.AmountMinor,
                t.Currency,
                t.CreatedAtUtc,
                t.UpdatedAtUtc,
                Plan = _db.Plans.Where(p => p.Id == t.PlanId)
                    .Select(p => new { p.Name, p.Interval, p.ChoirSeats })
                    .FirstOrDefault(),
                User = _db.Users.Where(u => u.Id == t.UserId)
                    .Select(u => new { u.FullName, u.Country })
                    .FirstOrDefault(),
                Earlier = _db.PaymentTransactions.Any(o =>
                    o.UserId == t.UserId && o.Id != t.Id && o.Status == PaymentStatus.Completed
                    && o.CreatedAtUtc < t.CreatedAtUtc),
                ProUntil = _db.Subscriptions.Where(s => s.UserId == t.UserId)
                    .Select(s => (DateTime?)s.CurrentPeriodEndUtc)
                    .FirstOrDefault(),
            })
            .ToListAsync(ct);

        // In the order the payments completed (the claims' order), so a summary names the first payer first.
        return rows
            .OrderBy(r => ids.IndexOf(r.Id))
            .Select(r => new PaymentAlertFacts(
                r.Id,
                r.AmountMinor,
                r.Currency,
                r.Plan?.Name,
                r.Plan?.Interval,
                r.Plan?.ChoirSeats,
                r.User?.FullName,
                r.User?.Country,
                // A payment found with an earlier one of the same account in this run is not its first.
                FirstPayment: !r.Earlier,
                ProUntilUtc: r.Plan is { Interval: not BillingInterval.Single, ChoirSeats: null } ? r.ProUntil : null,
                PaidAtUtc: r.UpdatedAtUtc))
            .ToList();
    }
}
