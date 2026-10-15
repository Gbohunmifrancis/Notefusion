using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common.Interfaces;
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

    public GetPublicPricingQueryHandler(IApplicationDbContext db, ICountryResolver country)
    {
        _db = db;
        _country = country;
    }

    public async Task<Result<PublicPricingDto>> Handle(GetPublicPricingQuery request, CancellationToken ct)
    {
        var country = await _country.ResolveAsync(ct);

        // The public page must never render both regional prices. An unresolved geo result is an honest
        // loading/error state; checkout still determines the authoritative account offer after sign-in.
        if (string.IsNullOrWhiteSpace(country))
            return new PublicPricingDto(null, []);

        var plans = await _db.Plans
            .AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.AmountMinor)
            .Select(p => new PlanDto(p.Id, p.Code, p.Name, p.AmountMinor, p.Currency, p.Interval))
            .ToListAsync(ct);

        return new PublicPricingDto(
            country,
            plans.Where(p => PlanEligibility.IsOffered(p.Code, p.Currency, country)).ToList());
    }
}
