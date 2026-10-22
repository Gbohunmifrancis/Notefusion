using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Billing;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The console's Unpaid checkouts page for a window (default the last 30 days): every checkout whose payment page was
/// handed out and that has not been paid, one row each, with the account, what the provider's page saw, the answer to
/// "What stopped you?" if one was given, and whether the account paid later. See <see cref="UnpaidCheckoutsDto"/>.
/// </summary>
/// <remarks>
/// The Growth page's "Why checkouts end unpaid" (<see cref="CheckoutExitReport"/>) is the same rows counted and kept
/// anonymous; this is the per-person list behind it, read only when an admin opens it. Most people never answer the
/// question (they close the tab), so the list is every unpaid checkout, not only the answered ones. Customers only.
/// </remarks>
public sealed record GetUnpaidCheckoutsQuery(DateTime? From = null, DateTime? To = null)
    : IRequest<Result<UnpaidCheckoutsDto>>;

public sealed class GetUnpaidCheckoutsQueryHandler : IRequestHandler<GetUnpaidCheckoutsQuery, Result<UnpaidCheckoutsDto>>
{
    private const int DefaultWindowDays = 30;

    /// <summary>Rows listed, newest first; the total says how many there were.</summary>
    public const int RowCount = 200;

    private static readonly PaymentStatus[] Unpaid = [PaymentStatus.Pending, PaymentStatus.Processing, PaymentStatus.Failed];

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetUnpaidCheckoutsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<UnpaidCheckoutsDto>> Handle(GetUnpaidCheckoutsQuery request, CancellationToken ct)
    {
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, _clock.UtcNow);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;

        var unpaid = _db.RealPayments()
            .Where(p => p.CreatedAtUtc >= range.FromUtc && p.CreatedAtUtc < range.ToUtc
                        && p.CheckoutUrl != null && Unpaid.Contains(p.Status));
        var total = await unpaid.CountAsync(ct);

        var rows = await unpaid.AsNoTracking()
            .OrderByDescending(p => p.CreatedAtUtc)
            .Take(RowCount)
            .Select(p => new
            {
                p.Id, p.UserId, p.PlanId, p.Provider, p.AmountMinor, p.Currency, p.Status, p.ProviderAttempt,
                p.Client, p.CreatedAtUtc,
            })
            .ToListAsync(ct);

        var paymentIds = rows.Select(r => r.Id).ToList();
        var userIds = rows.Select(r => r.UserId).Distinct().ToList();
        var planIds = rows.Select(r => r.PlanId).Distinct().ToList();

        var exits = await _db.CheckoutExits.AsNoTracking()
            .Where(e => paymentIds.Contains(e.PaymentTransactionId))
            .Select(e => new { e.PaymentTransactionId, e.SecondsOpen, e.ReturnedAtUtc, e.Reason, e.Note, e.AnsweredAtUtc })
            .ToDictionaryAsync(e => e.PaymentTransactionId, ct);
        // A deleted account keeps its payments (the money's record) but not its name: the row says so.
        var users = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email })
            .ToDictionaryAsync(u => u.Id, ct);
        var plans = await _db.Plans.AsNoTracking()
            .Where(p => planIds.Contains(p.Id))
            .Select(p => new { p.Id, p.Name })
            .ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        // Paid later: the account's next completed payment, any plan, opened at or after this checkout.
        var oldest = rows.Count > 0 ? rows.Min(r => r.CreatedAtUtc) : range.FromUtc;
        var paid = await _db.PaymentTransactions.AsNoTracking()
            .Where(p => userIds.Contains(p.UserId) && p.Status == PaymentStatus.Completed && p.CreatedAtUtc >= oldest)
            .Select(p => new { p.UserId, p.CreatedAtUtc, p.UpdatedAtUtc })
            .ToListAsync(ct);

        var list = rows.Select(r =>
        {
            exits.TryGetValue(r.Id, out var exit);
            users.TryGetValue(r.UserId, out var user);
            var paidLater = paid
                .Where(p => p.UserId == r.UserId && p.CreatedAtUtc >= r.CreatedAtUtc)
                .Select(p => (DateTime?)p.UpdatedAtUtc)
                .Min();
            return new UnpaidCheckoutDto(
                r.Id,
                r.UserId,
                user?.FullName,
                user?.Email,
                r.Provider.ToString().ToLowerInvariant(),
                plans.GetValueOrDefault(r.PlanId),
                r.AmountMinor,
                r.Currency,
                Utc(r.CreatedAtUtc),
                r.Status,
                r.ProviderAttempt,
                r.Client,
                exit is not null,
                exit?.SecondsOpen,
                exit?.Reason,
                exit?.Note,
                exit?.AnsweredAtUtc is { } answered ? Utc(answered) : null,
                paidLater is { } at ? Utc(at) : null);
        }).ToList();

        return new UnpaidCheckoutsDto(
            range.FromUtc, range.ToUtc, (int)AnalyticsRange.ReportingOffset.TotalMinutes,
            CheckoutExitReport.QuickSeconds, total, list);
    }

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
