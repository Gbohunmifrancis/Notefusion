using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Activity.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Activity.Queries;

/// <summary>
/// The action names the website's tracker sends for each step of a checkout. The browser side
/// (<c>web-site/assets/pricing.js</c> and <c>app.js</c>) uses these exact strings; change both together.
/// </summary>
public static class CheckoutSteps
{
    public const string PlansViewed = "Plans viewed";
    public const string ChoseSignedOut = "Chose a plan signed out";
    public const string Started = "Checkout started";
    public const string Opened = "Checkout opened";
    public const string Confirmed = "Payment confirmed";
    public const string Failed = "Checkout failed";
    public const string NotConfirmed = "Payment not confirmed";
    public const string PageError = "Page error";
}

/// <summary>The checkout funnel and its problems over a window, defaulting to the last 30 days.</summary>
public sealed record GetCheckoutFunnelQuery(DateTime? From = null, DateTime? To = null) : IRequest<Result<CheckoutFunnelDto>>;

public sealed class GetCheckoutFunnelQueryHandler : IRequestHandler<GetCheckoutFunnelQuery, Result<CheckoutFunnelDto>>
{
    private const int DefaultWindowDays = 30;
    private const int TopCount = 8;
    private const int RecentProblemCount = 25;

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetCheckoutFunnelQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<CheckoutFunnelDto>> Handle(GetCheckoutFunnelQuery request, CancellationToken ct)
    {
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, _clock.UtcNow);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;

        var actions = _db.WebEvents.AsNoTracking()
            .Where(e => e.Kind == WebEvent.Action && e.OccurredAtUtc >= range.FromUtc && e.OccurredAtUtc < range.ToUtc);

        // Sessions per step, the funnel's unit: one person retrying three times is one session that got stuck.
        string[] stepNames =
        [
            CheckoutSteps.PlansViewed, CheckoutSteps.ChoseSignedOut, CheckoutSteps.Started, CheckoutSteps.Opened,
            CheckoutSteps.Confirmed, CheckoutSteps.Failed, CheckoutSteps.NotConfirmed
        ];
        var counts = await actions
            .Where(e => stepNames.Contains(e.Name!))
            .GroupBy(e => e.Name!)
            .Select(g => new { Name = g.Key, Events = g.Count(), Sessions = g.Select(e => e.SessionId).Distinct().Count() })
            .ToListAsync(ct);
        CheckoutStepDto Step(string name, string description)
        {
            var c = counts.FirstOrDefault(x => x.Name == name);
            return new CheckoutStepDto(name, description, c?.Sessions ?? 0, c?.Events ?? 0);
        }

        var steps = new List<CheckoutStepDto>
        {
            Step(CheckoutSteps.PlansViewed, "Saw the plans: the pricing section on the home page, or the upgrade sheet in the web app"),
            Step(CheckoutSteps.ChoseSignedOut, "Picked a plan while signed out and was sent to sign in first"),
            Step(CheckoutSteps.Started, "Picked a plan while signed in; the API was asked for a checkout"),
            Step(CheckoutSteps.Opened, "The API answered with a checkout page and the browser went to the payment provider"),
            Step(CheckoutSteps.Confirmed, "Came back from the provider and the payment was confirmed"),
            Step(CheckoutSteps.Failed, "The checkout request failed before the provider's page opened"),
            Step(CheckoutSteps.NotConfirmed, "Came back from the provider but the payment was never confirmed"),
        };

        var errorCodes = await Ranked(actions.Where(e => e.Name == CheckoutSteps.Failed).GroupBy(e => e.Detail ?? "unknown"), ct);
        var pageErrors = await Ranked(actions.Where(e => e.Name == CheckoutSteps.PageError).GroupBy(e => e.Detail ?? "unknown"), ct);

        // Payment rows are small and their enums are folded in memory, the same reason the overview does it.
        var payments = await _db.PaymentTransactions.AsNoTracking()
            .Where(p => p.CreatedAtUtc >= range.FromUtc && p.CreatedAtUtc < range.ToUtc)
            .Select(p => new { p.Status, p.Provider, p.FailureReason, p.CreatedAtUtc, p.UpdatedAtUtc, p.UserId, p.Reference })
            .ToListAsync(ct);
        IReadOnlyList<CategoryCountDto> Fold<T>(IEnumerable<T> keys) => [.. keys
            .GroupBy(k => k?.ToString() ?? "none")
            .Select(g => new CategoryCountDto(g.Key, g.Count()))
            .OrderByDescending(c => c.Count).ThenBy(c => c.Label, StringComparer.Ordinal)];

        var failedPayments = payments.Where(p => p.Status == PaymentStatus.Failed).ToList();
        var failureReasons = Fold(failedPayments.Select(p => p.FailureReason ?? "no reason recorded")).Take(TopCount).ToList();

        var browserProblems = await actions
            .Where(e => e.Name == CheckoutSteps.Failed || e.Name == CheckoutSteps.NotConfirmed || e.Name == CheckoutSteps.PageError)
            .OrderByDescending(e => e.OccurredAtUtc)
            .Take(RecentProblemCount)
            .Select(e => new { e.OccurredAtUtc, e.Name, e.Detail, e.Path, e.UserId, e.VisitorId })
            .ToListAsync(ct);

        var problemUserIds = browserProblems.Select(p => p.UserId).OfType<Guid>()
            .Concat(failedPayments.Select(p => p.UserId)).Distinct().ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => problemUserIds.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email })
            .ToDictionaryAsync(u => u.Id, ct);

        var problems = browserProblems
            .Select(p =>
            {
                var u = p.UserId is { } id ? users.GetValueOrDefault(id) : null;
                return new CheckoutProblemDto(
                    p.OccurredAtUtc, "browser", p.Name!, p.Detail is null ? p.Path : $"{p.Detail} (on {p.Path})",
                    p.UserId, u?.FullName, u?.Email, p.VisitorId, null);
            })
            .Concat(failedPayments.Select(p =>
            {
                var u = users.GetValueOrDefault(p.UserId);
                return new CheckoutProblemDto(
                    p.UpdatedAtUtc, "provider", $"{p.Provider} payment failed", p.FailureReason,
                    p.UserId, u?.FullName, u?.Email, null, p.Reference);
            }))
            .OrderByDescending(p => p.AtUtc)
            .Take(RecentProblemCount)
            .ToList();

        return new CheckoutFunnelDto(
            range.FromUtc, range.ToUtc, steps, errorCodes,
            Fold(payments.Select(p => p.Status)),
            Fold(payments.Select(p => p.Provider)),
            failureReasons, pageErrors, problems);
    }

    /// <summary>Top-N groups by count, ties broken by label so the order is stable between refreshes.</summary>
    private static async Task<IReadOnlyList<CategoryCountDto>> Ranked(IQueryable<IGrouping<string, WebEvent>> groups, CancellationToken ct)
    {
        var rows = await groups.Select(g => new { Label = g.Key, Count = g.Count() }).ToListAsync(ct);
        return [.. rows.OrderByDescending(r => r.Count).ThenBy(r => r.Label, StringComparer.Ordinal)
                       .Take(TopCount).Select(r => new CategoryCountDto(r.Label, r.Count))];
    }
}
