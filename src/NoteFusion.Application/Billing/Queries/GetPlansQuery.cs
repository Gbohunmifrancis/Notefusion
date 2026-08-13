using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Queries;

/// <summary>Lists the active plans for the paywall, cheapest first.</summary>
public sealed record GetPlansQuery : IRequest<Result<IReadOnlyList<PlanDto>>>;

public sealed class GetPlansQueryHandler : IRequestHandler<GetPlansQuery, Result<IReadOnlyList<PlanDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetPlansQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<IReadOnlyList<PlanDto>>> Handle(GetPlansQuery request, CancellationToken ct)
    {
        var plans = await _db.Plans
            .Where(p => p.IsActive)
            .OrderBy(p => p.AmountMinor)
            .Select(p => new PlanDto(p.Id, p.Code, p.Name, p.AmountMinor, p.Currency, p.Interval))
            .ToListAsync(ct);

        return plans;
    }
}
