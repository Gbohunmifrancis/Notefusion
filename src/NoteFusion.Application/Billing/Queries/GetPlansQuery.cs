using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Queries;

/// <summary>
/// Lists the plans this caller may buy, cheapest first. Filtered by region, so a Nigerian account sees the
/// naira subscriptions and everyone else sees the dollar plans — an account with no known country is
/// offered the dollar plans too. Hiding is only half of it; <see cref="Commands.InitiateCheckoutCommandHandler"/> re-checks the same
/// rule, because this list is advice and the checkout is the decision.
/// </summary>
public sealed record GetPlansQuery : IRequest<Result<IReadOnlyList<PlanDto>>>;

public sealed class GetPlansQueryHandler : IRequestHandler<GetPlansQuery, Result<IReadOnlyList<PlanDto>>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public GetPlansQueryHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<PlanDto>>> Handle(GetPlansQuery request, CancellationToken ct)
    {
        // The account's stored country, not the country of whoever is asking right now: the offer must stay
        // put when a user travels. Null for an anonymous caller, which is offered the dollar tier — the same
        // answer an account with no resolved country gets.
        var country = _currentUser.UserId is { } userId
            ? await _db.Users.Where(u => u.Id == userId).Select(u => u.Country).FirstOrDefaultAsync(ct)
            : null;

        var plans = await _db.Plans
            .Where(p => p.IsActive)
            .OrderBy(p => p.AmountMinor)
            .Select(p => new PlanDto(p.Id, p.Code, p.Name, p.AmountMinor, p.Currency, p.Interval))
            .ToListAsync(ct);

        // Filtered here rather than in the query: the rule is a shared predicate the checkout handler also
        // calls, and duplicating it as EF-translatable SQL is how the two ends drift apart. The plans table
        // holds a handful of rows.
        return plans.Where(p => PlanEligibility.IsOffered(p.Currency, country)).ToList();
    }
}
