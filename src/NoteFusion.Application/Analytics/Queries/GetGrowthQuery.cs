using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Billing;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The console's Growth page for a window (default the last 30 days): renewals, free-to-paid by price set,
/// transcription failures by kind, and app versions on phones. What the overview and Insights already show is linked
/// from the page rather than repeated here.
/// </summary>
public sealed record GetGrowthQuery(DateTime? From = null, DateTime? To = null) : IRequest<Result<GrowthDto>>;

/// <remarks>
/// Payments, memberships and devices are small tables and are read in narrow columns and folded in memory, as the
/// overview's membership section does; transcription outcomes are counted per kind in the database.
/// </remarks>
public sealed class GetGrowthQueryHandler : IRequestHandler<GetGrowthQuery, Result<GrowthDto>>
{
    private const int DefaultWindowDays = 30;

    /// <summary>A member who pays again within this many days after their period ended has renewed.</summary>
    public const int RenewalGraceDays = 7;

    /// <summary>Rows on the "ending soon" list.</summary>
    public const int EndingSoonCount = 25;

    private const int TopProblemCount = 8;

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly AppReleaseSettings _release;

    public GetGrowthQueryHandler(IApplicationDbContext db, IDateTimeProvider clock, AppReleaseSettings release)
    {
        _db = db;
        _clock = clock;
        _release = release;
    }

    public async Task<Result<GrowthDto>> Handle(GetGrowthQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, now);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;

        return new GrowthDto(
            range.FromUtc,
            range.ToUtc,
            (int)AnalyticsRange.ReportingOffset.TotalMinutes,
            await BuildRenewals(range, now, ct),
            await BuildFreeToPaid(range, ct),
            await BuildTranscriptionHealth(range, ct),
            await BuildAppVersions(now, ct));
    }

    // ── Renewals ────────────────────────────────────────────────────────────

    private async Task<RenewalsDto> BuildRenewals(AnalyticsRange range, DateTime now, CancellationToken ct)
    {
        // Ending soon: the current rows, so gifts and console extensions are in (they end too).
        var in30 = now.AddDays(30);
        var subs = await _db.RealSubscriptions().AsNoTracking()
            .Where(s => (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
                        && s.CurrentPeriodEndUtc > now && s.CurrentPeriodEndUtc <= in30)
            .Join(_db.Users, s => s.UserId, u => u.Id, (s, u) => new { u.Id, u.FullName, u.Email, s.PlanId, Paid = s.Provider != null, s.CurrentPeriodEndUtc })
            .ToListAsync(ct);
        var choirs = await _db.RealChoirs().AsNoTracking()
            .Where(c => c.CurrentPeriodEndUtc > now && c.CurrentPeriodEndUtc <= in30)
            .Join(_db.Users, c => c.OwnerId, u => u.Id, (c, u) => new { u.Id, u.FullName, u.Email, c.PlanId, Paid = c.Provider != null, c.CurrentPeriodEndUtc })
            .ToListAsync(ct);
        var planNames = await _db.Plans.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name, ct);
        var ending = subs.Select(s => new EndingMembershipDto(s.Id, s.FullName, s.Email, "pro", planNames.GetValueOrDefault(s.PlanId) ?? "Pro", s.Paid, Utc(s.CurrentPeriodEndUtc)))
            .Concat(choirs.Select(c => new EndingMembershipDto(c.Id, c.FullName, c.Email, "choir", planNames.GetValueOrDefault(c.PlanId) ?? "Choir", c.Paid, Utc(c.CurrentPeriodEndUtc))))
            .OrderBy(e => e.EndsAtUtc).ThenBy(e => e.UserId)
            .ToList();
        var in7 = now.AddDays(7);

        // Due ends: every paid period rebuilt from the membership charges, in the order they were paid. A payment
        // stacks after the time left, exactly as PaymentFulfillment applies it.
        var charges = await _db.RealLedger().AsNoTracking()
            .Where(e => e.Reason == LedgerEntryReason.SubscriptionCharge && e.Direction == LedgerDirection.Credit)
            .Join(_db.PaymentTransactions, e => e.PaymentTransactionId, p => p.Id, (e, p) => new { e.UserId, e.CreatedAtUtc, p.PlanId })
            .Join(_db.Plans, x => x.PlanId, p => p.Id, (x, p) => new { x.UserId, x.CreatedAtUtc, p.Interval, Choir = p.ChoirSeats != null })
            .ToListAsync(ct);

        var dueUntil = range.ToUtc < now ? range.ToUtc : now;
        int due = 0, early = 0, late = 0, lapsed = 0, deciding = 0;
        foreach (var member in charges.Where(c => c.Interval != BillingInterval.Single).GroupBy(c => (c.UserId, c.Choir)))
        {
            var paid = member.OrderBy(c => c.CreatedAtUtc).ToList();
            DateTime? end = null;
            for (var i = 0; i <= paid.Count; i++)
            {
                DateTime? next = i < paid.Count ? Utc(paid[i].CreatedAtUtc) : null;
                if (end is { } e && e >= range.FromUtc && e < dueUntil)
                {
                    due++;
                    if (next is { } n && n <= e)
                        early++;
                    else if (next is { } m && m <= e.AddDays(RenewalGraceDays))
                        late++;
                    else if (e.AddDays(RenewalGraceDays) <= now)
                        lapsed++;
                    else
                        deciding++;
                }
                if (next is { } at)
                {
                    var start = end is { } current && current > at ? current : at;
                    end = BillingPeriod.Advance(start, paid[i].Interval);
                }
            }
        }

        var renewed = early + late;
        return new RenewalsDto(
            RenewalGraceDays,
            ending.Count(e => e.EndsAtUtc <= in7),
            ending.Count,
            [
                new CategoryCountDto("Pro, paid", ending.Count(e => e.Kind == "pro" && e.Paid)),
                new CategoryCountDto("Pro, gift", ending.Count(e => e.Kind == "pro" && !e.Paid)),
                new CategoryCountDto("Choir", ending.Count(e => e.Kind == "choir")),
            ],
            [.. ending.Take(EndingSoonCount)],
            due,
            early,
            late,
            lapsed,
            deciding,
            renewed + lapsed == 0 ? null : Math.Round(renewed / (double)(renewed + lapsed), 4));
    }

    private static DateTime Utc(DateTime at) => DateTime.SpecifyKind(at, DateTimeKind.Utc);

    // ── Free to paid, by price set ──────────────────────────────────────────

    private static readonly string[] Sets = ["naira", "regional", "standard", "unknown"];

    private static string SetOf(string? country)
        => string.IsNullOrWhiteSpace(country)
            ? "unknown"
            : PlanEligibility.TierFor(country) switch
            {
                PlanEligibility.Tier.Naira => "naira",
                PlanEligibility.Tier.RegionalDollar => "regional",
                _ => "standard"
            };

    private async Task<IReadOnlyList<PriceSetFunnelDto>> BuildFreeToPaid(AnalyticsRange range, CancellationToken ct)
    {
        var cohortQuery = _db.RealUsers().Where(u => u.CreatedAt >= range.FromUtc && u.CreatedAt < range.ToUtc);
        var cohortIds = cohortQuery.Select(u => u.Id);
        var cohort = await cohortQuery.AsNoTracking()
            .Select(u => new { u.Id, u.CreatedAt, u.Country })
            .ToListAsync(ct);

        // The cohort's jobs, and every job on a handset one of them submitted from (the free week is per device too).
        var devices = _db.RealJobs().Where(j => cohortIds.Contains(j.UserId) && j.DeviceFingerprint != null).Select(j => j.DeviceFingerprint);
        var jobs = await _db.RealJobs().AsNoTracking()
            .Where(j => cohortIds.Contains(j.UserId) || (j.DeviceFingerprint != null && devices.Contains(j.DeviceFingerprint)))
            .Select(j => new { j.UserId, j.CreatedAtUtc, Done = j.ResultJson != null, Charged = j.TrialConsumedAtUtc != null, j.DeviceFingerprint })
            .ToListAsync(ct);
        var reached = FreeLimitReach.Over(
            [.. jobs.Select(j => new FreeLimitReach.JobTrace(j.UserId, j.CreatedAtUtc, j.Charged, j.DeviceFingerprint))]);
        var transcribed = jobs.Where(j => j.Done).Select(j => j.UserId).ToHashSet();

        var checkout = (await _db.RealPayments().AsNoTracking()
                .Where(p => cohortIds.Contains(p.UserId))
                .Select(p => p.UserId).Distinct().ToListAsync(ct))
            .ToHashSet();
        var firstPaid = (await _db.RealLedger().AsNoTracking()
                .Where(e => cohortIds.Contains(e.UserId) && e.Direction == LedgerDirection.Credit
                            && (e.Reason == LedgerEntryReason.SubscriptionCharge || e.Reason == LedgerEntryReason.TranscriptionPurchase))
                .Select(e => new { e.UserId, e.CreatedAtUtc })
                .ToListAsync(ct))
            .GroupBy(e => e.UserId)
            .ToDictionary(g => g.Key, g => g.Min(e => e.CreatedAtUtc));

        return [.. Sets.Select(set =>
        {
            var people = cohort.Where(u => SetOf(u.Country) == set).ToList();
            var payers = people.Where(u => firstPaid.ContainsKey(u.Id)).ToList();
            var waits = payers.Select(u => Math.Max(0, (firstPaid[u.Id] - u.CreatedAt).TotalDays)).Order().ToList();
            return new PriceSetFunnelDto(
                set,
                people.Count,
                people.Count(u => transcribed.Contains(u.Id)),
                people.Count(u => reached(u.Id)),
                people.Count(u => checkout.Contains(u.Id)),
                payers.Count,
                people.Count == 0 ? null : Math.Round(payers.Count / (double)people.Count, 4),
                Median(waits));
        })];
    }

    private static double? Median(IReadOnlyList<double> sorted)
    {
        if (sorted.Count == 0)
            return null;
        var mid = sorted.Count / 2;
        var value = sorted.Count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        return Math.Round(value, 1);
    }

    // ── Transcription health ────────────────────────────────────────────────

    private async Task<TranscriptionHealthDto> BuildTranscriptionHealth(AnalyticsRange range, CancellationToken ct)
    {
        static double? FailureRate(int failed, int succeeded)
            => failed + succeeded == 0 ? null : Math.Round(failed / (double)(failed + succeeded), 4);

        var jobs = await _db.RealJobs().AsNoTracking()
            .Where(j => j.CreatedAtUtc >= range.FromUtc && j.CreatedAtUtc < range.ToUtc)
            .GroupBy(j => j.Kind)
            .Select(g => new
            {
                Kind = g.Key,
                Started = g.Count(),
                Done = g.Count(j => j.ResultJson != null),
                Failed = g.Count(j => j.ResultJson == null && j.SettledAtUtc != null),
            })
            .ToListAsync(ct);
        KindHealthDto Row(string name, TranscriptionJobKind kind)
        {
            var r = jobs.FirstOrDefault(j => j.Kind == kind);
            int started = r?.Started ?? 0, done = r?.Done ?? 0, failed = r?.Failed ?? 0;
            return new KindHealthDto(name, started, done, failed, started - done - failed, FailureRate(failed, done));
        }

        var previews = _db.RealPreviews().AsNoTracking().Where(p => p.CreatedAtUtc >= range.FromUtc && p.CreatedAtUtc < range.ToUtc);
        var previewStarted = await previews.CountAsync(ct);
        var previewDone = await previews.CountAsync(p => p.Succeeded, ct);
        var previewFailed = await previews.CountAsync(p => p.CompletedAtUtc != null && !p.Succeeded, ct);

        var links = _db.RealLogs().AsNoTracking()
            .Where(l => l.Kind == "link" && l.CreatedAtUtc >= range.FromUtc && l.CreatedAtUtc < range.ToUtc);
        var problems = await links
            .Where(l => l.Status == TranscriptionLog.Failed || l.Status == TranscriptionLog.Refused)
            .GroupBy(l => l.FailureReason ?? "No reason recorded")
            .Select(g => new { Reason = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return new TranscriptionHealthDto(
            [
                Row("recording", TranscriptionJobKind.Upload),
                Row("song", TranscriptionJobKind.Song),
                Row("link", TranscriptionJobKind.Link),
                new KindHealthDto("preview", previewStarted, previewDone, previewFailed,
                    previewStarted - previewDone - previewFailed, FailureRate(previewFailed, previewDone)),
            ],
            await links.CountAsync(ct),
            await links.CountAsync(l => l.Status == TranscriptionLog.Refused, ct),
            await links.CountAsync(l => l.Status == TranscriptionLog.Failed, ct),
            [.. problems.OrderByDescending(p => p.Count).ThenBy(p => p.Reason, StringComparer.Ordinal)
                .Take(TopProblemCount).Select(p => new CategoryCountDto(p.Reason, p.Count))]);
    }

    // ── App versions ────────────────────────────────────────────────────────

    /// <summary>Customers' phones by the native build they last registered with: a snapshot of now, not windowed.</summary>
    private async Task<AppVersionsDto> BuildAppVersions(DateTime now, CancellationToken ct)
    {
        var recentFrom = now.AddDays(-30);
        var rows = await _db.RealDeviceTokens().AsNoTracking()
            .Where(d => d.Platform != "web")
            .GroupBy(d => new { d.AppBuild, d.Platform, d.ServerReminders, Recent = d.UpdatedAt >= recentFrom })
            .Select(g => new { g.Key.AppBuild, g.Key.Platform, g.Key.ServerReminders, g.Key.Recent, Count = g.Count() })
            .ToListAsync(ct);

        var builds = rows.GroupBy(r => r.AppBuild)
            .OrderByDescending(g => g.Key)
            .Select(g => new AppBuildRowDto(
                g.Key,
                g.Sum(r => r.Count),
                g.Where(r => r.Recent).Sum(r => r.Count),
                g.Where(r => r.Platform == "android").Sum(r => r.Count),
                g.Where(r => r.Platform == "ios").Sum(r => r.Count),
                g.Where(r => r.ServerReminders).Sum(r => r.Count)))
            .ToList();

        return new AppVersionsDto(
            _release.LatestBuild,
            builds.Sum(b => b.Phones),
            builds.Sum(b => b.Recent),
            _release.LatestBuild <= 0 ? 0 : builds.Where(b => b.Build >= _release.LatestBuild).Sum(b => b.Phones),
            builds.Sum(b => b.ServerReminders),
            builds);
    }
}
