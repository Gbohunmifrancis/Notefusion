using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// Everything the console shows on one account's detail page, in a single round of queries.
/// </summary>
/// <remarks>
/// One query rather than a handful of endpoints the page stitches together, because every panel on it
/// answers the same support question and a half-loaded page answers none of them. The cost is a fixed
/// handful of small reads, all bounded.
/// </remarks>
public sealed record GetUserAccountQuery(Guid UserId) : IRequest<Result<AdminUserDetailDto>>
{
    /// <summary>
    /// How many rows of each history the page carries. A support view, not an export — the full trail is
    /// the audit-log page, which pages properly.
    /// </summary>
    public const int HistoryLimit = 20;
}

public sealed class GetUserAccountQueryHandler : IRequestHandler<GetUserAccountQuery, Result<AdminUserDetailDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetUserAccountQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<AdminUserDetailDto>> Handle(GetUserAccountQuery request, CancellationToken ct)
    {
        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == request.UserId, ct);

        if (user is null)
            return UserErrors.NotFound;

        // Counted from the jobs, not from saved transcriptions, and from the same constant the paywall
        // reads — deleting a transcription does not hand the free generation back, and the number the
        // console shows must be the number that gates the user.
        // Free ones only: a job paid for with a bought transcription is charged on the same column, and
        // counting it here read as "5 of 3" for someone who bought two.
        var trialUsed = await _db.TranscriptionJobs.AsNoTracking()
            .CountAsync(j => j.UserId == request.UserId && j.TrialConsumedAtUtc != null && !j.PaidByCredit, ct);
        var boughtTotal = await TrialUsage.CountBoughtAsync(_db, request.UserId, ct);
        var boughtUsed = await TrialUsage.CountBoughtSpentAsync(_db, request.UserId, _clock.UtcNow, ct);
        var previewsUsed = await _db.TranscriptionJobs.AsNoTracking()
            .CountAsync(j => j.UserId == request.UserId && j.Kind == TranscriptionJobKind.Link
                             && !j.WasPro && j.SongCreditConsumedAtUtc != null, ct);
        // What the allowances were actually charged, next to the raw count of results below.
        var charged = await _db.TranscriptionJobs.AsNoTracking()
            .CountAsync(j => j.UserId == request.UserId
                             && (j.TrialConsumedAtUtc != null || j.SongCreditConsumedAtUtc != null), ct);

        // Every transcription that produced a result, saved or not: counting saved sheets alone missed
        // everyone who transcribes without saving. See TranscriptionCounts for what is included.
        var counts = (await TranscriptionCounts.ForUsersAsync(_db, [request.UserId], ct))
            .GetValueOrDefault(request.UserId, UserTranscriptionCounts.None);
        var transcriptionCount = counts.Transcribed;

        var sub = await _db.Subscriptions.AsNoTracking()
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == request.UserId, ct);

        AdminSubscriptionDto? subscription = null;
        if (sub is not null)
        {
            var plan = await _db.Plans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == sub.PlanId, ct);

            subscription = new AdminSubscriptionDto(
                sub.Id,
                plan?.Code,
                plan?.Name,
                sub.Status.ToString(),
                sub.IsActiveAt(_clock.UtcNow),
                sub.IsGift,
                sub.IsLifetime,
                sub.Provider?.ToString(),
                sub.CurrentPeriodStartUtc,
                sub.IsLifetime ? null : sub.CurrentPeriodEndUtc,
                sub.CanceledAtUtc,
                sub.CreatedAtUtc);
        }

        // The plan name comes from a correlated subquery because the transaction stores only a plan id, and
        // the row has to keep naming what was bought after that plan is retired and gone from the paywall.
        var payments = await _db.PaymentTransactions.AsNoTracking()
            .Where(pt => pt.UserId == request.UserId)
            .OrderByDescending(pt => pt.CreatedAtUtc)
            .ThenBy(pt => pt.Id)
            .Take(GetUserAccountQuery.HistoryLimit)
            .Select(pt => new AdminPaymentDto(
                pt.Id,
                pt.Reference,
                pt.ProviderReference,
                pt.Provider.ToString(),
                pt.Status.ToString(),
                pt.AmountMinor,
                pt.Currency,
                _db.Plans.Where(p => p.Id == pt.PlanId).Select(p => p.Name).FirstOrDefault(),
                pt.FailureReason,
                pt.CreatedAtUtc))
            .ToListAsync(ct);

        var ledger = await _db.LedgerEntries.AsNoTracking()
            .Where(le => le.UserId == request.UserId)
            .OrderByDescending(le => le.CreatedAtUtc)
            .ThenBy(le => le.Id)
            .Take(GetUserAccountQuery.HistoryLimit)
            .Select(le => new AdminLedgerEntryDto(
                le.Id,
                le.Direction.ToString(),
                le.Reason.ToString(),
                le.AmountMinor,
                le.Currency,
                le.Description,
                le.CreatedAtUtc))
            .ToListAsync(ct);

        var recentActions = await _db.AdminAuditLogs.AsNoTracking()
            .Where(a => a.TargetUserId == request.UserId)
            .OrderByDescending(a => a.OccurredAtUtc)
            .ThenBy(a => a.Id)
            .Take(GetUserAccountQuery.HistoryLimit)
            .Select(a => new AuditLogRowDto(
                a.Id,
                a.ActorUserId,
                a.ActorEmail,
                a.Action.ToString(),
                a.TargetUserId,
                a.TargetEmail,
                a.IpAddress,
                a.Summary,
                a.Note,
                a.OccurredAtUtc))
            .ToListAsync(ct);

        var recentTranscriptions = await _db.Transcriptions.AsNoTracking()
            .Where(t => t.UserId == request.UserId)
            .OrderByDescending(t => t.CreatedAtUtc)
            .ThenBy(t => t.Id)
            .Take(GetUserAccountQuery.HistoryLimit)
            .Select(t => new AdminTranscriptionSummaryDto(
                t.Id,
                t.Title,
                t.Key.ToString(),
                t.TempoBpm,
                t.OverallConfidence,
                t.Status.ToString(),
                t.CreatedAtUtc))
            .ToListAsync(ct);

        return new AdminUserDetailDto(
            user.Id,
            user.FullName,
            user.Email,
            user.PhoneNumber,
            user.ProfilePictureUrl,
            user.Role.ToString(),
            user.IsActive,
            user.GoogleId != null,
            user.PasswordHash != null,
            user.Country,
            user.CreatedAt,
            user.LastLoginAt,
            // Only reported while it is actually in force: a stale lockout date that has already passed is
            // not the reason anyone cannot sign in, and printing one sends support after the wrong thing.
            user.IsLockedOut(_clock.UtcNow) ? user.LockoutEndAt : null,
            transcriptionCount,
            trialUsed,
            // This user's ceiling, not a global one — the allowance is regional, and an admin comparing
            // "used" against the wrong total would read a spent Nigerian trial as barely touched.
            FreeTier.TrialGenerationsFor(user.Country),
            subscription,
            payments,
            ledger,
            recentActions,
            recentTranscriptions,
            counts.Saved,
            counts.Failed,
            user.IsInternal,
            user.LastSeenAtUtc,
            boughtUsed,
            boughtTotal,
            previewsUsed,
            charged);
    }
}
