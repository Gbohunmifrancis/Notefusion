using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Queries;

/// <summary>
/// Returns the one regional paid offer the public website may display. Unlike the authenticated paywall,
/// this resolves the request's country because an anonymous visitor has no account country to read.
/// </summary>
public sealed record GetPublicPricingQuery : IRequest<Result<PublicPricingDto>>;

public sealed class GetPublicPricingQueryHandler : IRequestHandler<GetPublicPricingQuery, Result<PublicPricingDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICountryResolver _country;

    /// <summary>Any country of the standard dollar set; the one an unresolved visitor is priced as.</summary>
    private const string StandardPriceCountry = "US";

    public GetPublicPricingQueryHandler(IApplicationDbContext db, ICountryResolver country)
    {
        _db = db;
        _country = country;
    }

    public async Task<Result<PublicPricingDto>> Handle(GetPublicPricingQuery request, CancellationToken ct)
    {
        var country = await _country.ResolveAsync(ct);

        // The public page must never render both regional prices. A visitor whose location could not be read (a
        // VPN, a lookup that failed) is shown the standard dollar set, what most of the world pays, rather than no
        // prices at all; the country stays null, so nothing claims to know where they are. Checkout still
        // decides the account's own offer after sign-in.
        var priceAs = string.IsNullOrWhiteSpace(country) ? StandardPriceCountry : country;

        var all = await _db.Plans
            .AsNoTracking()
            .Where(p => p.IsActive && p.ChoirSeats == null)
            .OrderBy(p => p.AmountMinor)
            .Select(p => new PlanDto(p.Id, p.Code, p.Name, p.AmountMinor, p.Currency, p.Interval))
            .ToListAsync(ct);
        var offered = all.Where(p => PlanEligibility.IsOffered(p.Code, p.Currency, priceAs)).ToList();

        // The choir plans and the one-song purchase are not in Plans: the public page renders each plan there
        // as Pro Monthly or Pro Yearly. The one-song price rides apart, for the free card's wording.
        return new PublicPricingDto(
            string.IsNullOrWhiteSpace(country) ? null : country,
            offered.Where(p => p.Interval != BillingInterval.Single).ToList(),
            offered.FirstOrDefault(p => p.Interval == BillingInterval.Single));
    }
}
