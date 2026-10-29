using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Queries;

/// <summary><c>GET /api/admin/offers</c>: every offer, the newest start first.</summary>
public sealed record GetAdminOffersQuery : IRequest<Result<IReadOnlyList<AdminOfferDto>>>;

/// <summary><c>GET /api/admin/offers/templates</c>: each template's defaults for the year ahead.</summary>
public sealed record GetOfferTemplatesQuery : IRequest<Result<IReadOnlyList<OfferTemplateDto>>>;

/// <summary>
/// <c>GET /api/admin/offers/{id}/preview</c>: the email exactly as the sender renders it, for someone on
/// <see cref="Set"/> prices called <see cref="FirstName"/> ("Hello," without one). The unsubscribe link in it leads
/// nowhere, so clicking around the preview changes nothing.
/// </summary>
/// <summary>The email (or, <c>round=lastCall</c>, its last call) as it goes out.</summary>
public sealed record PreviewOfferEmailQuery(Guid Id, string? Set = null, string? FirstName = null, string? Round = null) : IRequest<Result<OfferPreviewDto>>;

/// <summary><c>GET /api/admin/offers/{id}/audience</c>: who Send would reach with these groups ticked, and the quota's pace.</summary>
public sealed record GetOfferAudienceQuery(Guid Id, bool Free = true, bool Lapsed = true, bool ProNow = false)
    : IRequest<Result<OfferAudienceDto>>;

/// <summary><c>GET /api/admin/offers/{id}/progress</c>: the email's queue, its clicks, and what the offer sold.</summary>
public sealed record GetOfferProgressQuery(Guid Id) : IRequest<Result<OfferProgressDto>>;

public sealed class AdminOfferQueryHandlers :
    IRequestHandler<GetAdminOffersQuery, Result<IReadOnlyList<AdminOfferDto>>>,
    IRequestHandler<GetOfferTemplatesQuery, Result<IReadOnlyList<OfferTemplateDto>>>,
    IRequestHandler<PreviewOfferEmailQuery, Result<OfferPreviewDto>>,
    IRequestHandler<GetOfferAudienceQuery, Result<OfferAudienceDto>>,
    IRequestHandler<GetOfferProgressQuery, Result<OfferProgressDto>>
{
    private const int FirstNameMaxLength = 60;

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly OfferSettings _settings;
    private readonly IOfferEmailRenderer _renderer;
    private readonly EmailQuotaSettings _quota;

    public AdminOfferQueryHandlers(
        IApplicationDbContext db, IDateTimeProvider clock, OfferSettings settings, IOfferEmailRenderer renderer,
        EmailQuotaSettings quota)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
        _renderer = renderer;
        _quota = quota;
    }

    public async Task<Result<IReadOnlyList<AdminOfferDto>>> Handle(GetAdminOffersQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var plans = await OfferEmailComposer.OfferablePlansAsync(_db, ct);
        var offers = await _db.Offers.AsNoTracking().ToListAsync(ct);
        var seasonOn = new HashSet<string>(StringComparer.Ordinal);
        foreach (var offer in offers.DistinctBy(o => o.Template))
            if (await OfferSeason.IsOnAsync(_db, offer, now, ct))
                seasonOn.Add(offer.Template);
        return offers
            .OrderByDescending(o => o.StartsAtUtc)
            .Select(o => OfferAdmin.Describe(o, plans, _settings, now, seasonOn.Contains(o.Template)))
            .ToList();
    }

    public Task<Result<IReadOnlyList<OfferTemplateDto>>> Handle(GetOfferTemplatesQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        IReadOnlyList<OfferTemplateDto> templates = OfferTemplates.All
            .Select(t =>
            {
                var lastDay = t.NextLastDay(now);
                return new OfferTemplateDto(
                    t.Template, t.NameFor(lastDay), t.Label, t.StartsAtUtcFor(lastDay), lastDay, OfferTemplates.DefaultPercentOff, t.Words);
            })
            .ToList();
        return Task.FromResult(Result.Success(templates));
    }

    public async Task<Result<OfferPreviewDto>> Handle(PreviewOfferEmailQuery request, CancellationToken ct)
    {
        if (OfferAdmin.ParseSet(request.Set) is not { } set)
            return OfferErrors.SetUnknown;
        if (OfferAdmin.ParseRound(request.Round) is not { } round)
            return OfferErrors.RoundUnknown;
        if (await _db.Offers.AsNoTracking().FirstOrDefaultAsync(o => o.Id == request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;

        var name = request.FirstName?.Trim();
        if (name is { Length: > FirstNameMaxLength })
            name = name[..FirstNameMaxLength];
        var content = OfferEmailComposer.Compose(
            offer, await OfferEmailComposer.OfferablePlansAsync(_db, ct), set, token: null,
            OfferEmailComposer.PreviewUnsubscribeUrl(_settings), _settings, round);
        var rendered = _renderer.Render(new EmailRecipient("preview@notefusion.studio", name), content);
        return new OfferPreviewDto(rendered.Subject, rendered.Preheader, rendered.Html, rendered.Text);
    }

    public async Task<Result<OfferAudienceDto>> Handle(GetOfferAudienceQuery request, CancellationToken ct)
    {
        if (await _db.Offers.AsNoTracking().FirstOrDefaultAsync(o => o.Id == request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;

        var now = _clock.UtcNow;
        var reading = await OfferAudience.ReadAsync(_db, now, ct);
        var chosen = reading.Chosen(request.Free, request.Lapsed, request.ProNow);
        var total = chosen.Count;

        var quota = await QuotaAsync(total, now, ct);

        // Days the email can still go out: from today (or the start, if later) to the last day, in UK days.
        var today = OfferWindow.UkDate(now);
        var firstDay = OfferWindow.UkDate(offer.StartsAtUtc) is var startDay && startDay > today ? startDay : today;
        var sendingDays = Math.Max(0, offer.LastDay.DayNumber - firstDay.DayNumber + 1);
        var monthRoom = _quota.MonthlyLimit is int month and > 0
            ? Math.Max(0, EmailBudget.OptionalCeiling(month, _quota.OptionalShare) - quota.MonthlyUsed)
            : int.MaxValue;
        var reached = (int)Math.Min(Math.Min(total, (long)sendingDays * quota.PerDay), monthRoom);
        int? days = total == 0 ? 0 : quota.PerDay > 0 ? (int)Math.Ceiling(total / (double)quota.PerDay) : null;

        var e = reading.Excluded;
        return new OfferAudienceDto(
            new OfferAudienceGroupsDto(
                reading.Members.Count(m => m.Group == OfferEmailGroup.Free),
                reading.Members.Count(m => m.Group == OfferEmailGroup.Lapsed),
                reading.Members.Count(m => m.Group == OfferEmailGroup.ProNow)),
            total,
            new OfferAudienceSetsDto(
                chosen.Count(m => m.Set == OfferPlans.Standard),
                chosen.Count(m => m.Set == OfferPlans.Regional)),
            new OfferAudienceExcludedDto(e.Naira, e.NoCountry, e.EmailOff, e.StoreOrChoir, e.RecentNote),
            quota,
            new OfferEstimateDto(days, reached));
    }

    /// <summary>
    /// The quota as it bears on <paramref name="total"/> offer emails: every kind of mail counts, and optional mail stops
    /// at each window's line (<see cref="EmailBudget"/>). A window with no cap leaves the rest to the others; with no cap
    /// at all, everyone can go today.
    /// </summary>
    private async Task<OfferQuotaDto> QuotaAsync(int total, DateTime now, CancellationToken ct)
    {
        var dayAfter = now - EmailBudget.Day;
        var weekAfter = now - EmailBudget.Week;
        var monthAfter = now - EmailBudget.Month;
        var dailyUsed = await _db.EmailSends.CountAsync(s => s.SentAtUtc > dayAfter, ct);
        var weeklyUsed = _quota.WeeklyLimit is > 0 ? await _db.EmailSends.CountAsync(s => s.SentAtUtc > weekAfter, ct) : 0;
        var monthlyUsed = await _db.EmailSends.CountAsync(s => s.SentAtUtc > monthAfter, ct);

        int? Line(int? limit) => limit is int l and > 0 ? EmailBudget.OptionalCeiling(l, _quota.OptionalShare) : null;
        int? dailyLimit = _quota.DailyLimit is > 0 ? _quota.DailyLimit : null;
        int? monthlyLimit = _quota.MonthlyLimit is > 0 ? _quota.MonthlyLimit : null;
        var dailyLine = Line(dailyLimit);
        var weeklyLine = Line(_quota.WeeklyLimit);
        var monthlyLine = Line(monthlyLimit);

        var dayRoom = dailyLine is int d ? Math.Max(0, d - dailyUsed) : total;
        var weekRoom = weeklyLine is int w ? Math.Max(0, w - weeklyUsed) : int.MaxValue;
        var monthRoom = monthlyLine is int m ? Math.Max(0, m - monthlyUsed) : int.MaxValue;
        var roomToday = Math.Min(dayRoom, Math.Min(weekRoom, monthRoom));

        // A full day's pace: the daily line less the day's other mail (codes, receipts, notes), so the offer's own sends
        // while it is going out do not read as the pace dropping. With no daily cap, what the other windows leave.
        int perDay;
        if (dailyLine is int line)
        {
            var otherToday = await _db.EmailSends.CountAsync(s => s.SentAtUtc > dayAfter && s.Kind != EmailKind.Offer, ct);
            perDay = Math.Max(0, line - otherToday);
        }
        else
        {
            perDay = roomToday;
        }

        return new OfferQuotaDto(dailyUsed, dailyLimit, dailyLine, monthlyUsed, monthlyLimit, monthlyLine, roomToday, perDay);
    }

    public async Task<Result<OfferProgressDto>> Handle(GetOfferProgressQuery request, CancellationToken ct)
    {
        if (await _db.Offers.AsNoTracking().FirstOrDefaultAsync(o => o.Id == request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;

        var emails = await _db.OfferEmails.AsNoTracking()
            .Where(e => e.OfferId == offer.Id)
            .Select(e => new { e.UserId, e.Round, e.Status, e.SkipReason, e.SentAtUtc, e.ClickedAtUtc, e.OpenedAtUtc })
            .ToListAsync(ct);
        var lastCalls = emails.Where(e => e.Round == OfferEmailRound.LastCall).ToList();
        emails = emails.Where(e => e.Round == OfferEmailRound.Launch).ToList();
        var payments = await _db.PaymentTransactions.AsNoTracking()
            .Where(t => t.OfferId == offer.Id)
            .Select(t => new { t.UserId, t.PlanId, t.Status, t.AmountMinor, t.Currency, t.UpdatedAtUtc })
            .ToListAsync(ct);
        var bought = payments.Where(p => p.Status == PaymentStatus.Completed).ToList();
        var planIds = bought.Select(p => p.PlanId).Distinct().ToList();
        var plans = await _db.Plans.AsNoTracking().Where(p => planIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);

        var sentAt = emails.Concat(lastCalls)
            .Where(e => e.SentAtUtc is not null)
            .GroupBy(e => e.UserId)
            .ToDictionary(g => g.Key, g => g.Min(e => e.SentAtUtc!.Value));
        var fromEmail = bought.Count(p => sentAt.TryGetValue(p.UserId, out var at) && p.UpdatedAtUtc >= at);
        int Skipped(OfferSkipReason reason) => emails.Count(e => e.Status == OfferEmailStatus.Skipped && e.SkipReason == reason);

        // By UK day, from the first day anything happened (or the start) to the last (or today, while it runs).
        var both = emails.Concat(lastCalls).ToList();
        var sentDays = both.Where(e => e.SentAtUtc is not null).Select(e => OfferWindow.UkDate(e.SentAtUtc!.Value)).ToList();
        var clickDays = both.Where(e => e.ClickedAtUtc is not null).Select(e => OfferWindow.UkDate(e.ClickedAtUtc!.Value)).ToList();
        // Opened when its image loaded or, images blocked, when its button was clicked: whichever came first.
        var openDays = both
            .Select(e => e.OpenedAtUtc is { } o && e.ClickedAtUtc is { } c ? (o < c ? o : c) : e.OpenedAtUtc ?? e.ClickedAtUtc)
            .Where(at => at is not null)
            .Select(at => OfferWindow.UkDate(at!.Value))
            .ToList();
        var boughtDays = bought.Select(p => OfferWindow.UkDate(p.UpdatedAtUtc)).ToList();
        var every = sentDays.Concat(openDays).Concat(clickDays).Concat(boughtDays).ToList();
        var byDay = new List<OfferDayDto>();
        if (every.Count > 0)
        {
            var today = OfferWindow.UkDate(_clock.UtcNow);
            var from = every.Min();
            var runsTo = today < offer.LastDay ? today : offer.LastDay;
            var to = every.Max() > runsTo ? every.Max() : runsTo;
            for (var day = from; day <= to; day = day.AddDays(1))
                byDay.Add(new OfferDayDto(
                    day, sentDays.Count(d => d == day), clickDays.Count(d => d == day), boughtDays.Count(d => d == day),
                    openDays.Count(d => d == day)));
        }

        var byPlan = bought
            .GroupBy(p => p.PlanId)
            .Select(g =>
            {
                plans.TryGetValue(g.Key, out var plan);
                return new OfferPlanSalesDto(
                    plan?.Code ?? "unknown",
                    plan is null ? "Unknown plan" : OfferPlans.ShortName(plan.Interval) + (OfferPlans.SetOf(plan) == OfferPlans.Regional ? ", regional" : string.Empty),
                    plan is null ? OfferPlans.Standard : OfferPlans.SetOf(plan),
                    g.Count(),
                    g.Sum(p => p.AmountMinor));
            })
            .OrderByDescending(p => p.RevenueMinor)
            .ToList();

        return new OfferProgressDto(
            emails.Count(e => e.Status == OfferEmailStatus.Queued),
            emails.Count(e => e.Status == OfferEmailStatus.Sent),
            new OfferSkippedDto(
                Skipped(OfferSkipReason.OptedOut),
                Skipped(OfferSkipReason.Bought),
                Skipped(OfferSkipReason.BecamePro),
                Skipped(OfferSkipReason.Ended),
                Skipped(OfferSkipReason.NoLongerEligible),
                Skipped(OfferSkipReason.LastCallInstead)),
            emails.Count(e => e.Status == OfferEmailStatus.Failed),
            emails.Count(e => e.ClickedAtUtc is not null),
            bought.Count,
            fromEmail,
            payments.Count,
            bought.Where(p => string.Equals(p.Currency, "USD", StringComparison.OrdinalIgnoreCase)).Sum(p => p.AmountMinor),
            byDay,
            byPlan,
            emails.Count(e => e.OpenedAtUtc is not null || e.ClickedAtUtc is not null),
            offer.LastCallStartedAtUtc is null && lastCalls.Count == 0
                ? null
                : new OfferLastCallProgressDto(
                    lastCalls.Count(e => e.Status == OfferEmailStatus.Queued),
                    lastCalls.Count(e => e.Status == OfferEmailStatus.Sent),
                    lastCalls.Count(e => e.Status == OfferEmailStatus.Skipped),
                    lastCalls.Count(e => e.Status == OfferEmailStatus.Failed),
                    lastCalls.Count(e => e.OpenedAtUtc is not null || e.ClickedAtUtc is not null),
                    lastCalls.Count(e => e.ClickedAtUtc is not null),
                    bought.Count(p => lastCalls.Any(e => e.UserId == p.UserId && e.SentAtUtc is { } at && p.UpdatedAtUtc >= at))));
    }
}
