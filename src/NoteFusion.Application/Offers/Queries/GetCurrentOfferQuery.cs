using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Queries;

/// <summary>
/// <c>GET /api/offers/current</c>: the offer live for the caller, with each of their plans' usual and offer price, and
/// whether the offer <see cref="Key"/> names (the email's link) has ended for them.
/// </summary>
/// <remarks>
/// <para>
/// Signed in: the account's country picks the price set, as checkout does (no country: the standard dollars), and the
/// account's time zone its end (else the request's <c>X-Time-Zone</c>, else the UK's). Anonymous: the request's country
/// (<see cref="ICountryResolver"/>; unresolved is priced as the standard dollars, as the public pricing is) and
/// <c>X-Time-Zone</c>.
/// </para>
/// <para>
/// Nothing is live for an account on naira prices, a Google Play member (Google renews it; the website's checkout
/// refuses them) or lifetime access, outside the window, or while the offer or its season (<see cref="OfferSeason"/>)
/// is switched off. The same rule as the
/// checkout's (<c>InitiateCheckoutCommand</c>), so a price shown is a price charged.
/// </para>
/// </remarks>
public sealed record GetCurrentOfferQuery(string? Key = null) : IRequest<Result<CurrentOfferDto>>;

public sealed class GetCurrentOfferQueryHandler : IRequestHandler<GetCurrentOfferQuery, Result<CurrentOfferDto>>
{
    /// <summary>Any country of the standard dollar set; the one an unresolved visitor is priced as.</summary>
    private const string StandardPriceCountry = "US";

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly ICountryResolver _country;
    private readonly IClientTimeZone _timeZone;
    private readonly IDateTimeProvider _clock;

    public GetCurrentOfferQueryHandler(
        IApplicationDbContext db, ICurrentUser caller, ICountryResolver country, IClientTimeZone timeZone, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _country = country;
        _timeZone = timeZone;
        _clock = clock;
    }

    public async Task<Result<CurrentOfferDto>> Handle(GetCurrentOfferQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var none = new CurrentOfferDto(null, null);

        // Every offer that has started; there are a few a year.
        var offers = await _db.Offers.AsNoTracking().Where(o => o.StartsAtUtc <= now).ToListAsync(ct);
        var key = request.Key?.Trim().ToLowerInvariant();
        var named = string.IsNullOrEmpty(key) ? null : offers.FirstOrDefault(o => o.Key == key);
        if (offers.Count == 0)
            return none;

        var buyer = await OfferBuyer.ReadAsync(_db, _caller, _country, _timeZone, now, ct);
        if (buyer is null)
            return none;

        var seasonOn = new HashSet<string>(StringComparer.Ordinal);
        foreach (var offer in offers.DistinctBy(o => o.Template))
            if (await OfferSeason.IsOnAsync(_db, offer, now, ct))
                seasonOn.Add(offer.Template);

        var plans = await OfferEmailComposer.OfferablePlansAsync(_db, ct);
        List<Plan> PlansIn(Offer offer)
            => plans.Where(p => OfferPlans.Includes(offer, p) && PlanEligibility.IsOffered(p.Code, p.Currency, buyer.PriceAs)).ToList();

        LiveOfferDto? Live(Offer offer)
        {
            if (!seasonOn.Contains(offer.Template) || !OfferWindow.IsLiveFor(offer, buyer.Zone, now))
                return null;
            var mine = PlansIn(offer);
            return mine.Count == 0
                ? null
                : new LiveOfferDto(
                    offer.Key,
                    offer.Name,
                    offer.Template,
                    OfferTemplates.LabelOf(offer.Template),
                    offer.PercentOff,
                    offer.LastDay,
                    OfferWindow.EndsAtUtc(offer, buyer.Zone),
                    mine.OrderBy(p => p.Interval)
                        .Select(p => new OfferPlanPriceDto(
                            p.Id, p.Code, p.Interval.ToString(), p.Currency, p.AmountMinor,
                            OfferPricing.Price(p.AmountMinor, offer.PercentOff)))
                        .ToList());
        }

        var live = (named is null ? null : Live(named))
                   ?? offers.Where(o => o.Enabled).OrderBy(o => o.StartsAtUtc).Select(Live).FirstOrDefault(l => l is not null);

        // "The Halloween offer has ended." only for someone it was ever for: it started, it is over where they are (or
        // its season was switched off), and it covered plans they could buy.
        var ended = named is not null && live?.Key != named.Key
                    && (OfferWindow.HasEndedFor(named, buyer.Zone, now) || !seasonOn.Contains(named.Template))
                    && PlansIn(named).Count > 0
            ? new EndedOfferDto(named.Key, OfferTemplates.LabelOf(named.Template))
            : null;

        return new CurrentOfferDto(live, ended);
    }
}

/// <summary>
/// Who is asking for an offer price, read the same way by the offer endpoint and the checkout: the country the price
/// set comes from (<see cref="PriceAs"/>, as <see cref="PlanEligibility.IsOffered"/> reads it) and the zone their
/// midnight is in. Null for an account that cannot buy at an offer price at all (gone, a Google Play member, lifetime).
/// </summary>
public sealed record OfferBuyer(string? PriceAs, TimeZoneInfo Zone)
{
    public static async Task<OfferBuyer?> ReadAsync(
        IApplicationDbContext db, ICurrentUser caller, ICountryResolver country, IClientTimeZone timeZone, DateTime utcNow,
        CancellationToken ct)
    {
        if (caller.UserId is not { } userId)
        {
            var resolved = await country.ResolveAsync(ct);
            return new OfferBuyer(
                string.IsNullOrWhiteSpace(resolved) ? "US" : resolved,
                OfferWindow.Resolve(timeZone.Current));
        }

        var user = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId && u.IsActive)
            .Select(u => new { u.Country, u.TimeZone })
            .FirstOrDefaultAsync(ct);
        if (user is null)
            return null;

        return await CanBuyAsync(db, userId, utcNow, ct)
            ? new OfferBuyer(user.Country, OfferWindow.Resolve(user.TimeZone, timeZone.Current))
            : null;
    }

    /// <summary>
    /// False for a running Google Play membership (Google renews it; the website's checkout refuses it) and for lifetime
    /// access (nothing left to buy).
    /// </summary>
    public static async Task<bool> CanBuyAsync(IApplicationDbContext db, Guid userId, DateTime utcNow, CancellationToken ct)
    {
        var sub = await db.Subscriptions.AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(ct);
        return sub is null || !sub.IsActiveAt(utcNow) || (sub.Provider != PaymentProvider.GooglePlay && !sub.IsLifetime);
    }
}
